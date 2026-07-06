"""AI script generation + LLM config (OpenAI-compatible via httpx).

Người dùng nhập cấu hình LLM (base_url + api_key + model) của một dịch vụ
OpenAI-compatible; AI dùng cấu hình đó để tự viết kịch bản chia phân cảnh.

Không thêm dependency mới:
  - Gọi LLM bằng httpx (đã có sẵn trong venv) tới {base_url}/chat/completions.
  - `cryptography` KHÔNG được cài trong venv (đã kiểm tra), nên api_key được
    OBFUSCATE bằng XOR + base64 thay vì mã hóa mạnh. Đây CHỈ là obfuscation nhẹ
    để KHÔNG lưu key dạng plaintext trong DB — không phải mã hóa an toàn tuyệt đối.
  - Secret obfuscation lấy từ env LLM_CONFIG_SECRET; nếu env trống, tự sinh một
    secret ngẫu nhiên (1 lần) và lưu vào app_settings dưới key '_llm_secret'.

api_key KHÔNG BAO GIỜ được log; khi trả về frontend chỉ trả dạng masked "sk-...abcd".
"""
import base64
import json
import logging
import os
import re
import secrets
from typing import Optional

import httpx
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent.db.crud import get_setting, set_setting

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/ai", tags=["ai"])

# app_settings keys
_KEY_BASE_URL = "llm_base_url"
_KEY_MODEL = "llm_model"
_KEY_API_KEY_ENC = "llm_api_key_enc"
_KEY_SECRET = "_llm_secret"


# ─── Obfuscation helpers (XOR + base64) ──────────────────────

async def _get_or_create_secret() -> str:
    """Return the obfuscation secret: env LLM_CONFIG_SECRET, else a persisted random one."""
    env = os.environ.get("LLM_CONFIG_SECRET", "").strip()
    if env:
        return env
    stored = await get_setting(_KEY_SECRET)
    if stored:
        return stored
    generated = secrets.token_urlsafe(32)
    await set_setting(_KEY_SECRET, generated)
    return generated


def _xor(data: bytes, key: bytes) -> bytes:
    return bytes(b ^ key[i % len(key)] for i, b in enumerate(data))


def _encrypt(plain: str, secret: str) -> str:
    raw = _xor(plain.encode("utf-8"), secret.encode("utf-8"))
    return base64.urlsafe_b64encode(raw).decode("ascii")


def _decrypt(enc: str, secret: str) -> str:
    raw = base64.urlsafe_b64decode(enc.encode("ascii"))
    return _xor(raw, secret.encode("utf-8")).decode("utf-8")


def _mask(key: str) -> str:
    """Mask an API key for display: 'sk-...abcd'. Never expose the full key."""
    if not key:
        return ""
    if len(key) <= 8:
        return "****"
    return f"{key[:3]}...{key[-4:]}"


async def _load_config() -> tuple[str, str, str]:
    """Load (base_url, model, api_key) or raise 400 if not fully configured."""
    base_url = await get_setting(_KEY_BASE_URL)
    model = await get_setting(_KEY_MODEL)
    enc = await get_setting(_KEY_API_KEY_ENC)
    if not (base_url and model and enc):
        raise HTTPException(400, "LLM chưa được cấu hình. Vui lòng lưu Base URL + API key + Model.")
    secret = await _get_or_create_secret()
    try:
        api_key = _decrypt(enc, secret)
    except Exception:
        raise HTTPException(500, "Không giải mã được API key đã lưu (secret có thể đã đổi). Vui lòng nhập lại API key.")
    return base_url, model, api_key


# ─── Config endpoints ────────────────────────────────────────

class LlmConfigIn(BaseModel):
    base_url: str
    api_key: str = ""   # rỗng => giữ key cũ, chỉ update base_url/model
    model: str


@router.get("/llm-config")
async def get_llm_config():
    base_url = await get_setting(_KEY_BASE_URL) or ""
    model = await get_setting(_KEY_MODEL) or ""
    enc = await get_setting(_KEY_API_KEY_ENC)
    masked = ""
    if enc:
        try:
            secret = await _get_or_create_secret()
            masked = _mask(_decrypt(enc, secret))
        except Exception:
            masked = "****"
    return {
        "base_url": base_url,
        "model": model,
        "api_key_masked": masked,
        "configured": bool(base_url and model and enc),
    }


@router.post("/llm-config")
async def set_llm_config(body: LlmConfigIn):
    base_url = body.base_url.strip().rstrip("/")
    model = body.model.strip()
    if not base_url or not model:
        raise HTTPException(400, "Base URL và Model là bắt buộc.")
    await set_setting(_KEY_BASE_URL, base_url)
    await set_setting(_KEY_MODEL, model)

    api_key = body.api_key.strip()
    if api_key:
        secret = await _get_or_create_secret()
        await set_setting(_KEY_API_KEY_ENC, _encrypt(api_key, secret))
    elif not await get_setting(_KEY_API_KEY_ENC):
        raise HTTPException(400, "Chưa có API key — vui lòng nhập API key.")

    return {"configured": True}


@router.post("/test")
async def test_llm():
    """Gửi 1 request nhỏ để xác nhận base_url/api_key/model đúng."""
    base_url, model, api_key = await _load_config()
    try:
        async with httpx.AsyncClient(timeout=20.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [{"role": "user", "content": "ping"}],
                    "max_tokens": 5,
                },
            )
        if resp.status_code >= 400:
            return {"ok": False, "error": f"HTTP {resp.status_code}: {resp.text[:200]}"}
        return {"ok": True}
    except httpx.HTTPError as e:
        return {"ok": False, "error": str(e)[:200]}


# ─── Script generation ───────────────────────────────────────

class GenerateScriptIn(BaseModel):
    brief: str
    num_scenes: Optional[int] = None
    material: Optional[str] = None
    language: str = "vi"


def _build_system_prompt(language: str, num_scenes: Optional[int], material: Optional[str]) -> str:
    scenes_rule = (
        f"Số cảnh: đúng {num_scenes} cảnh."
        if num_scenes and num_scenes > 0
        else "Số cảnh: tự quyết định hợp lý, từ 4 đến 8 cảnh."
    )
    material_rule = f'Phong cách hình ảnh (material): "{material}".' if material else ""
    return (
        "Bạn là biên kịch AI cho công cụ tạo video ngắn bằng AI (mỗi cảnh là 1 ảnh + 1 video ~8 giây).\n"
        "Nhiệm vụ: từ YÊU CẦU của người dùng, viết kịch bản chia thành các PHÂN CẢNH.\n\n"
        "QUY TẮC BẮT BUỘC:\n"
        "- CHỈ trả về JSON hợp lệ, KHÔNG kèm lời giải thích, KHÔNG bọc trong markdown.\n"
        "- Cấu trúc JSON chính xác như sau:\n"
        "{\n"
        '  "project_name": "tên dự án ngắn gọn",\n'
        '  "story": "tóm tắt câu chuyện tổng thể",\n'
        '  "entities": [\n'
        '    {"name": "tên", "entity_type": "character | visual_asset", "description": "ngoại hình ngắn gọn"}\n'
        "  ],\n"
        '  "scenes": [\n'
        "    {\n"
        '      "prompt": "mô tả HÀNH ĐỘNG, bối cảnh, góc máy của cảnh",\n'
        '      "video_prompt": "mô tả CHUYỂN ĐỘNG trong 8 giây (camera + chủ thể)",\n'
        '      "character_names": ["tên entity xuất hiện trong cảnh"],\n'
        '      "narrator_text": "lời dẫn chuyện (có thể để chuỗi rỗng)"\n'
        "    }\n"
        "  ]\n"
        "}\n\n"
        "- scenes[].prompt: mô tả hành động/bối cảnh/góc máy. TUYỆT ĐỐI KHÔNG mô tả ngoại hình nhân vật hay đồ vật "
        "(đã có ảnh tham chiếu riêng đảm nhiệm việc giữ ngoại hình nhất quán).\n"
        "- scenes[].character_names: phải khớp với entities[].name; để [] nếu cảnh không có entity nào.\n"
        "- entities: tách rõ nhân vật (entity_type=\"character\") và đồ vật (entity_type=\"visual_asset\"); "
        "description chỉ tả NGOẠI HÌNH ngắn gọn.\n"
        f"- Ngôn ngữ cho story và narrator_text: {language}.\n"
        f"- {scenes_rule}\n"
        + (f"- {material_rule}\n" if material_rule else "")
    )


def _parse_json(text: str) -> Optional[dict]:
    """Parse JSON that may be wrapped in ```json fences or surrounded by prose."""
    t = (text or "").strip()
    if t.startswith("```"):
        t = re.sub(r"^```[a-zA-Z0-9]*\s*", "", t)
        t = re.sub(r"\s*```$", "", t).strip()
    try:
        return json.loads(t)
    except Exception:
        pass
    start, end = t.find("{"), t.rfind("}")
    if 0 <= start < end:
        try:
            return json.loads(t[start:end + 1])
        except Exception:
            return None
    return None


@router.post("/generate-script")
async def generate_script(body: GenerateScriptIn):
    """Sinh kịch bản nháp (chưa tạo gì trong DB) cho user xem/sửa trước khi chạy."""
    if not body.brief.strip():
        raise HTTPException(400, "Vui lòng nhập yêu cầu (ý tưởng video).")

    base_url, model, api_key = await _load_config()
    system_prompt = _build_system_prompt(body.language, body.num_scenes, body.material)

    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            resp = await client.post(
                f"{base_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": model,
                    "messages": [
                        {"role": "system", "content": system_prompt},
                        {"role": "user", "content": body.brief.strip()},
                    ],
                    "temperature": 0.8,
                },
            )
    except httpx.HTTPError as e:
        raise HTTPException(502, f"Không gọi được LLM: {e}")

    if resp.status_code >= 400:
        raise HTTPException(502, f"LLM lỗi HTTP {resp.status_code}: {resp.text[:300]}")

    try:
        content = resp.json()["choices"][0]["message"]["content"]
    except (KeyError, IndexError, TypeError, ValueError) as e:
        raise HTTPException(502, f"Phản hồi LLM không đúng định dạng OpenAI: {e}. Raw: {resp.text[:500]}")

    parsed = _parse_json(content)
    if parsed is None:
        raise HTTPException(502, f"Không phân tích được JSON từ LLM. Raw: {content[:1000]}")

    # Chuẩn hóa nhẹ để frontend dùng an toàn (không tạo gì trong DB ở bước này)
    parsed.setdefault("project_name", "")
    parsed.setdefault("story", "")
    parsed.setdefault("entities", [])
    parsed.setdefault("scenes", [])
    return parsed
