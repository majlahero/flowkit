import logging
import shutil
from pathlib import Path

import aiohttp
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from agent.models.video import Video, VideoCreate, VideoUpdate
from agent.sdk.persistence.sqlite_repository import SQLiteRepository
from agent.config import OUTPUT_DIR
from agent.utils.slugify import slugify
from agent.db import crud
from agent.services.post_process import merge_videos
from dataclasses import asdict

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/videos", tags=["videos"])

_repo = SQLiteRepository()


def _video_to_flat(sdk_video) -> dict:
    """Convert SDK Video domain model to flat dict matching API response shape."""
    return {
        "id": sdk_video.id,
        "project_id": sdk_video.project_id,
        "title": sdk_video.title,
        "description": sdk_video.description,
        "display_order": sdk_video.display_order,
        "status": sdk_video.status,
        "orientation": sdk_video.orientation,
        "vertical_url": sdk_video.vertical_url,
        "horizontal_url": sdk_video.horizontal_url,
        "thumbnail_url": sdk_video.thumbnail_url,
        "duration": sdk_video.duration,
        "resolution": sdk_video.resolution,
        "youtube_id": sdk_video.youtube_id,
        "privacy": sdk_video.privacy,
        "tags": sdk_video.tags,
        "created_at": sdk_video.created_at,
        "updated_at": sdk_video.updated_at,
    }


@router.post("", response_model=Video)
async def create(body: VideoCreate):
    sdk_video = await _repo.create_video(**body.model_dump(exclude_none=True))
    return _video_to_flat(sdk_video)


@router.get("", response_model=list[Video])
async def list_by_project(project_id: str):
    videos = await _repo.list_videos(project_id)
    return [_video_to_flat(v) for v in videos]


@router.get("/{vid}", response_model=Video)
async def get(vid: str):
    sdk_video = await _repo.get_video(vid)
    if not sdk_video:
        raise HTTPException(404, "Video not found")
    return _video_to_flat(sdk_video)


@router.patch("/{vid}", response_model=Video)
async def update(vid: str, body: VideoUpdate):
    row = await _repo.update("video", vid, **body.model_dump(exclude_unset=True))
    if not row:
        raise HTTPException(404, "Video not found")
    sdk_video = _repo._row_to_video(row)
    return _video_to_flat(sdk_video)


@router.delete("/{vid}")
async def delete(vid: str):
    if not await _repo.delete("video", vid):
        raise HTTPException(404, "Video not found")
    return {"ok": True}


# ---- concat: merge all scene videos into one final file (Phase B) ----

class ConcatRequest(BaseModel):
    with_tts: bool = False


class ConcatResponse(BaseModel):
    success: bool
    output_path: str
    scene_count: int


async def _download_url(session: aiohttp.ClientSession, url: str, dest: Path) -> None:
    """Download a signed URL to dest, raising HTTPException on failure."""
    try:
        async with session.get(url) as resp:
            if resp.status != 200:
                raise HTTPException(502, f"Không tải được video (HTTP {resp.status}): {url[:80]}")
            dest.write_bytes(await resp.read())
    except aiohttp.ClientError as e:
        raise HTTPException(502, f"Không tải được video: {e}") from e


@router.post("/{vid}/concat", response_model=ConcatResponse)
async def concat_video(vid: str, body: ConcatRequest):
    """Ghép tất cả video từng cảnh của 1 video thành 1 file hoàn chỉnh (cần ffmpeg trên máy).

    Với mỗi cảnh, chọn nguồn theo orientation của video:
      1. File 4K local đã tải trước (output/{slug}/4k/scene_{IDX3}_{sid}.mp4)
      2. <ori>_upscale_url (bản nâng 4K)
      3. <ori>_video_url (bản thường)
    Nếu with_tts=True và đã có bản lồng tiếng (output/{slug}/narrated/scene_{IDX3}_{sid}_mixed.mp4)
    thì ưu tiên dùng bản đó cho cảnh tương ứng.
    """
    # ffmpeg is required by merge_videos — fail fast with a clear install hint
    if shutil.which("ffmpeg") is None:
        raise HTTPException(503, "ffmpeg chưa cài — cài bằng: winget install Gyan.FFmpeg rồi thử lại.")

    video = await crud.get_video(vid)
    if not video:
        raise HTTPException(404, "Không tìm thấy video")

    project = await crud.get_project(video["project_id"])
    if not project:
        raise HTTPException(404, "Không tìm thấy project")

    scenes = await crud.list_scenes(vid)
    if not scenes:
        raise HTTPException(400, "Video chưa có cảnh nào")
    scenes = sorted(scenes, key=lambda s: s.get("display_order", 0))

    orientation = (video.get("orientation") or "VERTICAL").upper()
    prefix = orientation.lower()  # "vertical" | "horizontal"

    slug = slugify(project.get("name") or "project")
    out_dir = OUTPUT_DIR / slug
    fourk_dir = out_dir / "4k"
    narrated_dir = out_dir / "narrated"
    fourk_dir.mkdir(parents=True, exist_ok=True)

    # Build the ordered list of source files, downloading remote URLs as needed
    video_paths: list[str] = []
    connector = aiohttp.TCPConnector(ssl=False)
    async with aiohttp.ClientSession(connector=connector) as session:
        for scene in scenes:
            order = scene.get("display_order", 0)
            sid = scene["id"]
            idx3 = f"{order:03d}"
            human_no = scenes.index(scene) + 1

            # Prefer the TTS-narrated (mixed) file when requested and present
            if body.with_tts:
                mixed = narrated_dir / f"scene_{idx3}_{sid}_mixed.mp4"
                if mixed.exists():
                    video_paths.append(str(mixed))
                    continue

            # Otherwise pick the best available video source
            local_4k = fourk_dir / f"scene_{idx3}_{sid}.mp4"
            upscale_url = scene.get(f"{prefix}_upscale_url")
            video_url = scene.get(f"{prefix}_video_url")

            if local_4k.exists():
                video_paths.append(str(local_4k))
            elif upscale_url or video_url:
                await _download_url(session, upscale_url or video_url, local_4k)
                video_paths.append(str(local_4k))
            else:
                raise HTTPException(400, f"cảnh {human_no} chưa có video, hãy tạo video trước")

    output_path = out_dir / f"{slug}_final.mp4"
    ok = merge_videos(video_paths, str(output_path))
    if not ok:
        raise HTTPException(500, "Ghép video thất bại (ffmpeg lỗi). Kiểm tra log agent để xem chi tiết.")

    logger.info("concat_video: merged %d scenes -> %s", len(video_paths), output_path)
    return ConcatResponse(success=True, output_path=str(output_path), scene_count=len(video_paths))
