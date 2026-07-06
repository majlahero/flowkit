import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAPI, postAPI } from '../api/client'
import type { Project, Video, Material, EntityType } from '../types'
import { Sparkles, ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown, Wand2 } from 'lucide-react'

// ---- styled primitives (match CreatePage / StudioPage) ----

const cardStyle = { background: 'var(--card)', border: '1px solid var(--border)' } as const
const inputStyle = {
  background: 'var(--surface)',
  border: '1px solid var(--border)',
  color: 'var(--text)',
} as const

function Field({ label, children, hint }: { label: string; children: React.ReactNode; hint?: string }) {
  return (
    <div className="flex flex-col gap-1">
      <label className="text-xs font-bold" style={{ color: 'var(--muted)' }}>{label}</label>
      {children}
      {hint && <span className="text-xs" style={{ color: 'var(--muted)' }}>{hint}</span>}
    </div>
  )
}

// ---- step status log (same shape as CreatePage) ----

type StepState = 'pending' | 'running' | 'done' | 'error'
interface Step { label: string; state: StepState; detail?: string }

function StepRow({ step }: { step: Step }) {
  const color =
    step.state === 'done' ? 'var(--green)' :
    step.state === 'error' ? 'var(--red)' :
    step.state === 'running' ? 'var(--yellow)' : 'var(--muted)'
  const glyph = step.state === 'done' ? '✓' : step.state === 'error' ? '✕' : step.state === 'running' ? '…' : '•'
  return (
    <div className="flex items-start gap-2 text-xs">
      <span style={{ color }}>{glyph}</span>
      <div className="flex flex-col">
        <span style={{ color: step.state === 'pending' ? 'var(--muted)' : 'var(--text)' }}>{step.label}</span>
        {step.detail && <span style={{ color: step.state === 'error' ? 'var(--red)' : 'var(--muted)' }}>{step.detail}</span>}
      </div>
    </div>
  )
}

// ---- draft data shapes (match backend /api/ai/generate-script) ----

interface DraftEntity {
  name: string
  entity_type: EntityType
  description: string
}

interface DraftScene {
  prompt: string
  video_prompt: string
  character_names: string[]
  narrator_text: string
}

interface LlmConfig {
  base_url: string
  model: string
  api_key_masked: string
  configured: boolean
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---- page ----

export default function AiCreatePage() {
  const navigate = useNavigate()

  // LLM config
  const [cfgOpen, setCfgOpen] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [cfg, setCfg] = useState<LlmConfig | null>(null)
  const [savingCfg, setSavingCfg] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [cfgMsg, setCfgMsg] = useState<string | null>(null)

  // brief + generation
  const [brief, setBrief] = useState('')
  const [materials, setMaterials] = useState<Material[]>([])
  const [material, setMaterial] = useState('')
  const [numScenes, setNumScenes] = useState<string>('')
  const [language, setLanguage] = useState('vi')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // draft (editable)
  const [projectName, setProjectName] = useState('')
  const [story, setStory] = useState('')
  const [entities, setEntities] = useState<DraftEntity[]>([])
  const [scenes, setScenes] = useState<DraftScene[]>([])
  const [hasDraft, setHasDraft] = useState(false)
  const [orientation, setOrientation] = useState<'VERTICAL' | 'HORIZONTAL'>('VERTICAL')

  // build (project/video/scenes)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)

  useEffect(() => {
    fetchAPI<Material[]>('/api/materials')
      .then(m => { setMaterials(m); if (m.length && !material) setMaterial(m[0].id) })
      .catch(console.error)
    fetchAPI<LlmConfig>('/api/ai/llm-config')
      .then(c => {
        setCfg(c)
        setBaseUrl(c.base_url || '')
        setModel(c.model || '')
        if (c.configured) setCfgOpen(false)
      })
      .catch(console.error)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setStep(idx: number, patch: Partial<Step>) {
    setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  async function handleSaveConfig() {
    setSavingCfg(true)
    setCfgMsg(null)
    setTestResult(null)
    try {
      await postAPI('/api/ai/llm-config', { base_url: baseUrl.trim(), api_key: apiKey.trim(), model: model.trim() })
      setApiKey('')  // clear from UI after saving
      const c = await fetchAPI<LlmConfig>('/api/ai/llm-config')
      setCfg(c)
      setCfgMsg('Đã lưu cấu hình.')
    } catch (e) {
      setCfgMsg(`Lưu thất bại: ${errMsg(e)}`)
    } finally {
      setSavingCfg(false)
    }
  }

  async function handleTestConfig() {
    setTesting(true)
    setTestResult(null)
    try {
      const r = await postAPI<{ ok: boolean; error?: string }>('/api/ai/test', {})
      setTestResult(r)
    } catch (e) {
      setTestResult({ ok: false, error: errMsg(e) })
    } finally {
      setTesting(false)
    }
  }

  async function handleGenerate() {
    if (!cfg?.configured) {
      setGenError('Chưa cấu hình LLM. Hãy nhập Base URL + API key + Model rồi bấm "Lưu" trước.')
      setCfgOpen(true)
      return
    }
    setGenerating(true)
    setGenError(null)
    try {
      const n = parseInt(numScenes, 10)
      const draft = await postAPI<{
        project_name: string
        story: string
        entities: DraftEntity[]
        scenes: DraftScene[]
      }>('/api/ai/generate-script', {
        brief: brief.trim(),
        num_scenes: Number.isFinite(n) && n > 0 ? n : undefined,
        material: material || undefined,
        language: language.trim() || 'vi',
      })
      setProjectName(draft.project_name || '')
      setStory(draft.story || '')
      setEntities((draft.entities || []).map(e => ({
        name: e.name || '',
        entity_type: (e.entity_type || 'character') as EntityType,
        description: e.description || '',
      })))
      setScenes((draft.scenes || []).map(s => ({
        prompt: s.prompt || '',
        video_prompt: s.video_prompt || '',
        character_names: Array.isArray(s.character_names) ? s.character_names : [],
        narrator_text: s.narrator_text || '',
      })))
      setHasDraft(true)
    } catch (e) {
      setGenError(errMsg(e))
    } finally {
      setGenerating(false)
    }
  }

  // ---- entity editing ----
  function updateEntity(i: number, patch: Partial<DraftEntity>) {
    setEntities(prev => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  function addEntity() {
    setEntities(prev => [...prev, { name: '', entity_type: 'character', description: '' }])
  }
  function removeEntity(i: number) {
    setEntities(prev => prev.filter((_, idx) => idx !== i))
  }

  // ---- scene editing ----
  function updateScene(i: number, patch: Partial<DraftScene>) {
    setScenes(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addScene() {
    setScenes(prev => [...prev, { prompt: '', video_prompt: '', character_names: [], narrator_text: '' }])
  }
  function removeScene(i: number) {
    setScenes(prev => prev.filter((_, idx) => idx !== i))
  }
  function moveScene(i: number, dir: -1 | 1) {
    setScenes(prev => {
      const j = i + dir
      if (j < 0 || j >= prev.length) return prev
      const next = [...prev]
      ;[next[i], next[j]] = [next[j], next[i]]
      return next
    })
  }
  function toggleSceneEntity(i: number, name: string) {
    setScenes(prev => prev.map((s, idx) => {
      if (idx !== i) return s
      const has = s.character_names.includes(name)
      return { ...s, character_names: has ? s.character_names.filter(n => n !== name) : [...s.character_names, name] }
    }))
  }

  const canBuild = hasDraft && projectName.trim() !== '' && material !== '' && scenes.length > 0 && !running

  async function handleBuild() {
    setCreatedProjectId(null)
    const stepDefs: Step[] = [
      { label: 'Kiểm tra extension + Flow key', state: 'pending' },
      { label: 'Tạo project trên Google Flow', state: 'pending' },
      { label: 'Tạo video', state: 'pending' },
      { label: `Tạo ${scenes.length} phân cảnh`, state: 'pending' },
    ]
    setSteps(stepDefs)
    setRunning(true)

    let si = 0
    try {
      // B1: extension + Flow key
      setStep(si, { state: 'running' })
      const flowStatus = await fetchAPI<{ connected: boolean; flow_key_present: boolean }>('/api/flow/status')
      if (!flowStatus.connected) {
        setStep(si, { state: 'error', detail: 'Extension chưa kết nối. Load extension trong Chrome rồi thử lại.' })
        setRunning(false); return
      }
      if (!flowStatus.flow_key_present) {
        setStep(si, { state: 'error', detail: 'Chưa có Flow key. Mở tab https://labs.google/fx/tools/flow và đăng nhập, rồi thử lại.' })
        setRunning(false); return
      }
      setStep(si, { state: 'done' }); si++

      // B2: create project (with edited entities as characters)
      setStep(si, { state: 'running' })
      const characters = entities
        .filter(e => e.name.trim())
        .map(e => ({
          name: e.name.trim(),
          entity_type: e.entity_type,
          description: e.description.trim() || undefined,
        }))
      const project = await postAPI<Project>('/api/projects', {
        name: projectName.trim(),
        story: story.trim() || undefined,
        language: language.trim() || 'vi',
        material,
        characters: characters.length ? characters : undefined,
      })
      setCreatedProjectId(project.id)
      setStep(si, { state: 'done', detail: `project.id = ${project.id}` }); si++

      // B3: create video
      setStep(si, { state: 'running' })
      const video = await postAPI<Video>('/api/videos', {
        project_id: project.id,
        title: projectName.trim(),
        orientation,
      })
      setStep(si, { state: 'done', detail: `video.id = ${video.id}` }); si++

      // B4: create scenes
      setStep(si, { state: 'running' })
      let made = 0
      for (let idx = 0; idx < scenes.length; idx++) {
        const s = scenes[idx]
        await postAPI('/api/scenes', {
          video_id: video.id,
          display_order: idx,
          prompt: s.prompt.trim() || `Cảnh ${idx + 1}`,
          video_prompt: s.video_prompt.trim() || undefined,
          character_names: s.character_names.length ? s.character_names : undefined,
          narrator_text: s.narrator_text.trim() || undefined,
        })
        made++
        setStep(si, { state: 'running', detail: `Đã tạo ${made}/${scenes.length} cảnh` })
      }
      setStep(si, { state: 'done', detail: `Đã tạo ${made} cảnh` })

      setRunning(false)
      navigate(`/projects/${project.id}/studio`)
    } catch (e) {
      setStep(si, { state: 'error', detail: errMsg(e) })
      setRunning(false)
    }
  }

  const entityNames = entities.map(e => e.name.trim()).filter(Boolean)

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* Intro */}
      <div className="rounded-lg p-4 flex flex-col gap-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 font-bold text-sm" style={{ color: 'var(--text)' }}>
          <Sparkles size={16} style={{ color: 'var(--accent)' }} /> AI tự tạo kịch bản + phân cảnh
        </div>
        <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Chỉ cần nhập <b>ý tưởng video</b>, AI sẽ viết toàn bộ kịch bản chia thành các <b>phân cảnh</b>.
          Bạn xem/sửa phân cảnh rồi bấm "Bắt đầu tạo video" — hệ thống tạo project + video + cảnh,
          sau đó chuyển sang Studio để tạo ảnh &amp; video.
        </div>
      </div>

      {/* LLM config */}
      <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
        <button
          type="button"
          onClick={() => setCfgOpen(o => !o)}
          className="flex items-center gap-2 text-sm font-bold"
          style={{ color: 'var(--text)' }}
        >
          {cfgOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
          Cấu hình AI
          {cfg?.configured && !cfgOpen && (
            <span className="text-xs font-normal" style={{ color: 'var(--green)' }}>
              (Đã cấu hình{cfg.api_key_masked ? ` — key: ${cfg.api_key_masked}` : ''})
            </span>
          )}
        </button>
        {cfgOpen && (
          <>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              Nhập endpoint + API key của dịch vụ AI (OpenAI-compatible) để AI viết kịch bản.
              Key được lưu <b>mã hóa</b> trên máy, không hiển thị lại đầy đủ.
            </div>
            <Field label="BASE URL" hint="Ví dụ: https://api.openai.com/v1 (endpoint gọi sẽ là {base_url}/chat/completions)">
              <input
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                className="rounded px-2 py-1.5 text-xs outline-none"
                style={inputStyle}
                placeholder="https://api.openai.com/v1"
              />
            </Field>
            <Field label="API KEY" hint={cfg?.configured ? `Đã có key (${cfg.api_key_masked}). Để trống nếu không muốn đổi.` : undefined}>
              <input
                type="password"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                className="rounded px-2 py-1.5 text-xs outline-none"
                style={inputStyle}
                placeholder={cfg?.configured ? '•••••••• (giữ key cũ)' : 'sk-...'}
              />
            </Field>
            <Field label="MODEL" hint="Ví dụ: gpt-4o-mini, claude-3-5-sonnet... (tùy dịch vụ)">
              <input
                value={model}
                onChange={e => setModel(e.target.value)}
                className="rounded px-2 py-1.5 text-xs outline-none"
                style={inputStyle}
                placeholder="gpt-4o-mini"
              />
            </Field>
            <div className="flex items-center gap-3 flex-wrap">
              <button
                type="button"
                onClick={handleSaveConfig}
                disabled={savingCfg || !baseUrl.trim() || !model.trim()}
                className="px-3 py-1.5 rounded text-xs font-semibold"
                style={{ background: 'var(--accent)', color: '#fff', border: '1px solid var(--border)', opacity: savingCfg ? 0.6 : 1 }}
              >
                {savingCfg ? 'Đang lưu…' : 'Lưu'}
              </button>
              <button
                type="button"
                onClick={handleTestConfig}
                disabled={testing || !cfg?.configured}
                className="px-3 py-1.5 rounded text-xs font-semibold"
                style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', opacity: testing || !cfg?.configured ? 0.6 : 1 }}
              >
                {testing ? 'Đang kiểm tra…' : 'Kiểm tra kết nối'}
              </button>
              {cfgMsg && <span className="text-xs" style={{ color: 'var(--muted)' }}>{cfgMsg}</span>}
              {testResult && (
                <span className="text-xs" style={{ color: testResult.ok ? 'var(--green)' : 'var(--red)' }}>
                  {testResult.ok ? '✓ Kết nối OK' : `✕ ${testResult.error || 'Lỗi'}`}
                </span>
              )}
            </div>
          </>
        )}
      </div>

      {/* Brief */}
      <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
        <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Yêu cầu của bạn</div>
        <Field label="Ý TƯỞNG VIDEO (bắt buộc)" hint="Tả ý tưởng, chủ đề, thông điệp... AI sẽ tự chia phân cảnh.">
          <textarea
            value={brief}
            onChange={e => setBrief(e.target.value)}
            rows={5}
            className="rounded px-2 py-1.5 text-xs outline-none resize-y"
            style={inputStyle}
            placeholder="Ví dụ: Một video ngắn kể về hành trình của chú robot nhỏ đi tìm ánh sáng mặt trời trong thành phố tương lai."
          />
        </Field>
        <div className="grid grid-cols-3 gap-3">
          <Field label="MATERIAL">
            <select
              value={material}
              onChange={e => setMaterial(e.target.value)}
              className="rounded px-2 py-1.5 text-xs outline-none"
              style={inputStyle}
            >
              {materials.length === 0 && <option value="">Đang tải…</option>}
              {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
            </select>
          </Field>
          <Field label="SỐ CẢNH (tùy chọn)" hint="Để trống → AI tự quyết">
            <input
              value={numScenes}
              onChange={e => setNumScenes(e.target.value.replace(/[^0-9]/g, ''))}
              className="rounded px-2 py-1.5 text-xs outline-none"
              style={inputStyle}
              placeholder="tự động"
            />
          </Field>
          <Field label="NGÔN NGỮ">
            <input
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="rounded px-2 py-1.5 text-xs outline-none"
              style={inputStyle}
              placeholder="vi"
            />
          </Field>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleGenerate}
            disabled={generating || brief.trim() === ''}
            className="flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold"
            style={{
              background: generating || brief.trim() === '' ? 'var(--card)' : 'var(--accent)',
              color: generating || brief.trim() === '' ? 'var(--muted)' : '#fff',
              border: '1px solid var(--border)',
              cursor: generating || brief.trim() === '' ? 'not-allowed' : 'pointer',
            }}
          >
            <Wand2 size={14} /> {generating ? 'AI đang viết kịch bản…' : 'AI sinh kịch bản'}
          </button>
          {genError && <span className="text-xs" style={{ color: 'var(--red)' }}>{genError}</span>}
        </div>
      </div>

      {/* Draft editor */}
      {hasDraft && (
        <>
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Kịch bản nháp — sửa trước khi chạy</div>
            <Field label="TÊN PROJECT (bắt buộc)">
              <input
                value={projectName}
                onChange={e => setProjectName(e.target.value)}
                className="rounded px-2 py-1.5 text-xs outline-none"
                style={inputStyle}
              />
            </Field>
            <Field label="STORY / TÓM TẮT">
              <textarea
                value={story}
                onChange={e => setStory(e.target.value)}
                rows={3}
                className="rounded px-2 py-1.5 text-xs outline-none resize-y"
                style={inputStyle}
              />
            </Field>
            <Field label="HƯỚNG VIDEO">
              <select
                value={orientation}
                onChange={e => setOrientation(e.target.value as 'VERTICAL' | 'HORIZONTAL')}
                className="rounded px-2 py-1.5 text-xs outline-none"
                style={inputStyle}
              >
                <option value="VERTICAL">Dọc (VERTICAL)</option>
                <option value="HORIZONTAL">Ngang (HORIZONTAL)</option>
              </select>
            </Field>
          </div>

          {/* Entities */}
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Nhân vật / Đồ vật ({entities.length})</div>
              <button type="button" onClick={addEntity} className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <Plus size={12} /> Thêm
              </button>
            </div>
            {entities.map((e, i) => (
              <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 140px auto' }}>
                  <input
                    value={e.name}
                    onChange={ev => updateEntity(i, { name: ev.target.value })}
                    className="rounded px-2 py-1.5 text-xs outline-none"
                    style={inputStyle}
                    placeholder="Tên"
                  />
                  <select
                    value={e.entity_type}
                    onChange={ev => updateEntity(i, { entity_type: ev.target.value as EntityType })}
                    className="rounded px-2 py-1.5 text-xs outline-none"
                    style={inputStyle}
                  >
                    <option value="character">character</option>
                    <option value="visual_asset">visual_asset</option>
                    <option value="location">location</option>
                    <option value="creature">creature</option>
                  </select>
                  <button type="button" onClick={() => removeEntity(i)} className="px-2 rounded text-xs" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--red)' }}>
                    <Trash2 size={12} />
                  </button>
                </div>
                <textarea
                  value={e.description}
                  onChange={ev => updateEntity(i, { description: ev.target.value })}
                  rows={2}
                  className="rounded px-2 py-1.5 text-xs outline-none resize-y"
                  style={inputStyle}
                  placeholder="Mô tả ngoại hình ngắn gọn"
                />
              </div>
            ))}
          </div>

          {/* Scenes */}
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="flex items-center justify-between">
              <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Phân cảnh ({scenes.length})</div>
              <button type="button" onClick={addScene} className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <Plus size={12} /> Thêm cảnh
              </button>
            </div>
            {scenes.map((s, i) => (
              <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Cảnh {i + 1}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => moveScene(i, -1)} disabled={i === 0} className="px-1.5 py-1 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', opacity: i === 0 ? 0.4 : 1 }}><ArrowUp size={12} /></button>
                    <button type="button" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1} className="px-1.5 py-1 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', opacity: i === scenes.length - 1 ? 0.4 : 1 }}><ArrowDown size={12} /></button>
                    <button type="button" onClick={() => removeScene(i)} className="px-1.5 py-1 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--red)' }}><Trash2 size={12} /></button>
                  </div>
                </div>
                <Field label="MÔ TẢ CẢNH (hành động / bối cảnh)">
                  <textarea
                    value={s.prompt}
                    onChange={ev => updateScene(i, { prompt: ev.target.value })}
                    rows={2}
                    className="rounded px-2 py-1.5 text-xs outline-none resize-y"
                    style={inputStyle}
                  />
                </Field>
                <Field label="CHUYỂN ĐỘNG 8 GIÂY (video_prompt)">
                  <textarea
                    value={s.video_prompt}
                    onChange={ev => updateScene(i, { video_prompt: ev.target.value })}
                    rows={2}
                    className="rounded px-2 py-1.5 text-xs outline-none resize-y"
                    style={inputStyle}
                  />
                </Field>
                {entityNames.length > 0 && (
                  <Field label="ENTITY TRONG CẢNH">
                    <div className="flex flex-wrap gap-1.5">
                      {entityNames.map(name => {
                        const active = s.character_names.includes(name)
                        return (
                          <button
                            key={name}
                            type="button"
                            onClick={() => toggleSceneEntity(i, name)}
                            className="px-2 py-1 rounded text-xs"
                            style={{
                              background: active ? 'var(--accent)' : 'var(--card)',
                              color: active ? '#fff' : 'var(--muted)',
                              border: '1px solid var(--border)',
                            }}
                          >
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  </Field>
                )}
                <Field label="LỜI DẪN (narrator_text)">
                  <textarea
                    value={s.narrator_text}
                    onChange={ev => updateScene(i, { narrator_text: ev.target.value })}
                    rows={2}
                    className="rounded px-2 py-1.5 text-xs outline-none resize-y"
                    style={inputStyle}
                  />
                </Field>
              </div>
            ))}
          </div>

          {/* Build actions */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleBuild}
              disabled={!canBuild}
              className="px-4 py-2 rounded text-xs font-semibold"
              style={{
                background: canBuild ? 'var(--accent)' : 'var(--card)',
                color: canBuild ? '#fff' : 'var(--muted)',
                border: '1px solid var(--border)',
                cursor: canBuild ? 'pointer' : 'not-allowed',
              }}
            >
              {running ? 'Đang tạo…' : 'Bắt đầu tạo video'}
            </button>
            {createdProjectId && !running && (
              <button
                type="button"
                onClick={() => navigate(`/projects/${createdProjectId}/studio`)}
                className="px-4 py-2 rounded text-xs font-semibold"
                style={{ background: 'var(--card)', color: 'var(--accent)', border: '1px solid var(--border)' }}
              >
                Sang Studio để tạo ảnh &amp; video →
              </button>
            )}
          </div>

          {steps.length > 0 && (
            <div className="rounded-lg p-4 flex flex-col gap-2" style={cardStyle}>
              <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>TIẾN TRÌNH</div>
              {steps.map((s, i) => <StepRow key={i} step={s} />)}
            </div>
          )}
        </>
      )}
    </div>
  )
}
