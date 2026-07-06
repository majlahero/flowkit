import { useState, useEffect, useRef, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAPI, postAPI, patchAPI, uploadImageData } from '../api/client'
import type { Project, Video, Scene, Character, Material, EntityType } from '../types'
import { useWebSocket } from '../api/useWebSocket'
import {
  Wand2, Sparkles, ChevronDown, ChevronRight, Plus, Trash2, ArrowUp, ArrowDown,
  UploadCloud, X, Image as ImageIcon, Film, Users, Mic, Combine, AlertTriangle,
  CheckCircle, ArrowLeft, ArrowRight, Check,
} from 'lucide-react'
import { StatusDot, ProgressBar, FlowBanner, STATUS_VN } from '../components/studio'
import type { BatchStatus } from '../components/studio'
import { ORIENT, imgStatus, imgUrl, vidStatus, vidUrl, upStatus } from '../lib/sceneMedia'
import type { Ori } from '../lib/sceneMedia'

// ---- shared styled primitives (match CreatePage / StudioPage / AiCreatePage) ----

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

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---- step status log (same shape as CreatePage / AiCreatePage) ----

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

// ---- image dropzone (copied small from CreatePage so the wizard is self-contained) ----

interface ImagePick { file: File; previewUrl: string }

function ImageDropzone({ image, onPick, onClear }: { image: ImagePick | null; onPick: (f: File) => void; onClear: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)

  function handleFiles(files: FileList | null) {
    const f = files?.[0]
    if (f && f.type.startsWith('image/')) onPick(f)
  }

  if (image) {
    return (
      <div className="rounded-lg p-2 flex items-center gap-3" style={cardStyle}>
        <img src={image.previewUrl} alt="preview" className="rounded object-cover" style={{ width: 56, height: 56, border: '1px solid var(--border)' }} />
        <div className="flex flex-col gap-0.5 min-w-0 flex-1">
          <span className="text-xs truncate" style={{ color: 'var(--text)' }}>{image.file.name}</span>
          <span className="text-xs" style={{ color: 'var(--muted)' }}>{Math.round(image.file.size / 1024)} KB</span>
        </div>
        <button
          type="button"
          onClick={onClear}
          className="flex items-center gap-1 px-2 py-1 rounded text-xs"
          style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--muted)' }}
        >
          <X size={12} /> Xóa
        </button>
      </div>
    )
  }

  return (
    <div
      onClick={() => inputRef.current?.click()}
      onDragOver={e => { e.preventDefault(); setDragOver(true) }}
      onDragLeave={() => setDragOver(false)}
      onDrop={e => { e.preventDefault(); setDragOver(false); handleFiles(e.dataTransfer.files) }}
      className="rounded-lg p-4 flex flex-col items-center gap-1.5 cursor-pointer transition-colors"
      style={{
        background: 'var(--surface)',
        border: `1px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
        color: 'var(--muted)',
      }}
    >
      <UploadCloud size={20} />
      <span className="text-xs text-center">Kéo-thả ảnh hoặc bấm để chọn (tùy chọn)</span>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFiles(e.target.files)} />
    </div>
  )
}

// ---- draft data shapes (match backend /api/ai/generate-script) ----

interface WizardEntity {
  name: string
  entity_type: EntityType
  description: string
  image: ImagePick | null
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

interface VoiceTemplate {
  name: string
  audio_path: string
  duration: number | null
}

interface NarrateResult {
  scenes_narrated: number
  scenes_skipped: number
  scenes_failed: number
}

interface ConcatResult {
  success: boolean
  output_path: string
  scene_count: number
}

// ---- stepper ----

const STEPS = [
  'Ý tưởng & AI',
  'Nhân vật & Đồ vật',
  'Phân cảnh',
  'Tạo hình ảnh & video',
  'Hoàn thiện & Xuất',
]

function Stepper({ step, onJump }: { step: number; onJump: (n: number) => void }) {
  return (
    <div className="flex items-center gap-1 flex-wrap">
      {STEPS.map((title, i) => {
        const n = i + 1
        const done = n < step
        const active = n === step
        const bg = active ? 'var(--accent)' : done ? 'var(--green)' : 'var(--surface)'
        const fg = active || done ? '#fff' : 'var(--muted)'
        return (
          <div key={n} className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => { if (n <= step) onJump(n) }}
              className="flex items-center gap-1.5 px-2.5 py-1.5 rounded text-xs font-semibold"
              style={{
                background: bg, color: fg, border: '1px solid var(--border)',
                cursor: n <= step ? 'pointer' : 'default',
              }}
              title={title}
            >
              <span
                className="inline-flex items-center justify-center rounded-full"
                style={{ width: 16, height: 16, background: 'rgba(255,255,255,0.25)', fontSize: 10 }}
              >
                {done ? <Check size={11} /> : n}
              </span>
              <span className="hidden sm:inline">{title}</span>
            </button>
            {n < STEPS.length && <ChevronRight size={13} style={{ color: 'var(--muted)' }} />}
          </div>
        )
      })}
    </div>
  )
}

// ---- page ----

export default function WizardPage() {
  const navigate = useNavigate()
  const { lastEvent } = useWebSocket()

  const [step, setStep] = useState(1)

  // ---- LLM config ----
  const [cfgOpen, setCfgOpen] = useState(true)
  const [baseUrl, setBaseUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const [model, setModel] = useState('')
  const [cfg, setCfg] = useState<LlmConfig | null>(null)
  const [savingCfg, setSavingCfg] = useState(false)
  const [testing, setTesting] = useState(false)
  const [testResult, setTestResult] = useState<{ ok: boolean; error?: string } | null>(null)
  const [cfgMsg, setCfgMsg] = useState<string | null>(null)

  // ---- brief + generation ----
  const [brief, setBrief] = useState('')
  const [materials, setMaterials] = useState<Material[]>([])
  const [material, setMaterial] = useState('')
  const [numScenes, setNumScenes] = useState('')
  const [language, setLanguage] = useState('vi')
  const [ori, setOri] = useState<Ori>('vertical')
  const [generating, setGenerating] = useState(false)
  const [genError, setGenError] = useState<string | null>(null)

  // ---- draft (editable) ----
  const [hasDraft, setHasDraft] = useState(false)
  const [projectName, setProjectName] = useState('')
  const [story, setStory] = useState('')
  const [entities, setEntities] = useState<WizardEntity[]>([])
  const [scenes, setScenes] = useState<DraftScene[]>([])

  // ---- build (step 3) ----
  const [building, setBuilding] = useState(false)
  const [buildSteps, setBuildSteps] = useState<Step[]>([])
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)
  const [createdVideoId, setCreatedVideoId] = useState<string | null>(null)

  // ---- flow status ----
  const [connected, setConnected] = useState<boolean | null>(null)
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null)

  // ---- steps 4/5: loaded scenes + entities from server ----
  const [srvScenes, setSrvScenes] = useState<Scene[]>([])
  const [srvEntities, setSrvEntities] = useState<Character[]>([])

  const [charProg, setCharProg] = useState<BatchStatus | null>(null)
  const [imgProg, setImgProg] = useState<BatchStatus | null>(null)
  const [vidProg, setVidProg] = useState<BatchStatus | null>(null)
  const [upProg, setUpProg] = useState<BatchStatus | null>(null)

  // ---- step 5: finishing ----
  const [templates, setTemplates] = useState<VoiceTemplate[]>([])
  const [selectedTemplate, setSelectedTemplate] = useState('')
  const [ttsRunning, setTtsRunning] = useState(false)
  const [ttsResult, setTtsResult] = useState<string | null>(null)
  const [withTts, setWithTts] = useState(false)
  const [concatRunning, setConcatRunning] = useState(false)
  const [concatResult, setConcatResult] = useState<string | null>(null)
  const [ffmpegMissing, setFfmpegMissing] = useState(false)

  const [actionError, setActionError] = useState<string | null>(null)

  const pollRef = useRef<Record<string, number>>({})
  const activePollsRef = useRef(0)

  // ---- initial loads ----
  useEffect(() => {
    fetchAPI<Material[]>('/api/materials')
      .then(m => { setMaterials(m); if (m.length) setMaterial(prev => prev || m[0].id) })
      .catch(console.error)
    fetchAPI<LlmConfig>('/api/ai/llm-config')
      .then(c => {
        setCfg(c)
        setBaseUrl(c.base_url || '')
        setModel(c.model || '')
        if (c.configured) setCfgOpen(false)
      })
      .catch(console.error)
    fetchAPI<VoiceTemplate[]>('/api/tts/templates').then(setTemplates).catch(() => setTemplates([]))
    refreshFlowStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const refreshFlowStatus = useCallback(() => {
    fetchAPI<{ connected: boolean; flow_key_present: boolean }>('/api/flow/status')
      .then(s => { setConnected(!!s.connected); setKeyPresent(!!s.flow_key_present) })
      .catch(() => { setConnected(false); setKeyPresent(false) })
  }, [])

  // ---- loaders for steps 4/5 ----
  const loadScenes = useCallback(() => {
    if (!createdVideoId) return
    fetchAPI<Scene[]>(`/api/scenes?video_id=${createdVideoId}`)
      .then(ss => setSrvScenes([...ss].sort((a, b) => a.display_order - b.display_order)))
      .catch(console.error)
  }, [createdVideoId])

  const loadEntities = useCallback(() => {
    if (!createdProjectId) return
    fetchAPI<Character[]>(`/api/projects/${createdProjectId}/characters`).then(setSrvEntities).catch(console.error)
  }, [createdProjectId])

  // load scenes + entities once we reach the media steps
  useEffect(() => {
    if (step >= 4 && createdVideoId) { loadScenes(); loadEntities() }
  }, [step, createdVideoId, loadScenes, loadEntities])

  // WS: while something is generating, refresh scenes early on any event
  useEffect(() => {
    if (lastEvent && activePollsRef.current > 0 && createdVideoId) loadScenes()
  }, [lastEvent, createdVideoId, loadScenes])

  // cleanup polls on unmount
  useEffect(() => {
    const polls = pollRef.current
    return () => { Object.values(polls).forEach(clearInterval) }
  }, [])

  // ---- polling helpers (mirror StudioPage) ----
  function stopPoll(key: string) {
    const t = pollRef.current[key]
    if (t) {
      clearInterval(t)
      delete pollRef.current[key]
      activePollsRef.current = Math.max(0, activePollsRef.current - 1)
    }
  }

  function startPoll(
    key: string,
    query: string,
    setProg: (b: BatchStatus) => void,
    reload: () => void,
  ) {
    stopPoll(key)
    activePollsRef.current += 1
    const tick = async () => {
      try {
        const st = await fetchAPI<BatchStatus>(`/api/requests/batch-status?${query}`)
        setProg(st)
        reload()
        if (st.done) { stopPoll(key); reload() }
      } catch (e) {
        console.error(e)
      }
    }
    void tick()
    pollRef.current[key] = window.setInterval(tick, 3500)
  }

  async function ensureFlow(): Promise<boolean> {
    try {
      const s = await fetchAPI<{ connected: boolean; flow_key_present: boolean }>('/api/flow/status')
      setConnected(!!s.connected)
      setKeyPresent(!!s.flow_key_present)
      return !!s.connected && !!s.flow_key_present
    } catch {
      setConnected(false)
      setKeyPresent(false)
      return false
    }
  }

  // ---- LLM config actions ----
  async function handleSaveConfig() {
    setSavingCfg(true)
    setCfgMsg(null)
    setTestResult(null)
    try {
      await postAPI('/api/ai/llm-config', { base_url: baseUrl.trim(), api_key: apiKey.trim(), model: model.trim() })
      setApiKey('')
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

  // ---- step 1: generate script ----
  async function handleGenerate() {
    if (!cfg?.configured) {
      setGenError('Chưa cấu hình LLM. Nhập Base URL + API key + Model rồi bấm "Lưu" trước.')
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
        entities: { name: string; entity_type: EntityType; description: string }[]
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
        image: null,
      })))
      setScenes((draft.scenes || []).map(s => ({
        prompt: s.prompt || '',
        video_prompt: s.video_prompt || '',
        character_names: Array.isArray(s.character_names) ? s.character_names : [],
        narrator_text: s.narrator_text || '',
      })))
      setHasDraft(true)
      setStep(2)
    } catch (e) {
      setGenError(errMsg(e))
    } finally {
      setGenerating(false)
    }
  }

  // ---- entity editing (step 2) ----
  function updateEntity(i: number, patch: Partial<WizardEntity>) {
    setEntities(prev => prev.map((e, idx) => (idx === i ? { ...e, ...patch } : e)))
  }
  function addEntity() {
    setEntities(prev => [...prev, { name: '', entity_type: 'character', description: '', image: null }])
  }
  function removeEntity(i: number) {
    setEntities(prev => prev.filter((_, idx) => idx !== i))
  }

  // ---- scene editing (step 3) ----
  function updateScene(i: number, patch: Partial<DraftScene>) {
    setScenes(prev => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  function addSceneDraft() {
    setScenes(prev => [...prev, { prompt: '', video_prompt: '', character_names: [], narrator_text: '' }])
  }
  function removeSceneDraft(i: number) {
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

  const entityNames = entities.map(e => e.name.trim()).filter(Boolean)

  // ---- step 3: build project + entities + video + scenes ----
  function setBuildStep(idx: number, patch: Partial<Step>) {
    setBuildSteps(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  async function handleBuild() {
    setActionError(null)
    const withImages = entities.filter(e => e.name.trim() && e.image)
    const stepDefs: Step[] = [
      { label: 'Kiểm tra extension + Flow key', state: 'pending' },
      { label: 'Tạo project trên Google Flow', state: 'pending' },
    ]
    if (withImages.length) stepDefs.push({ label: `Upload + gắn ${withImages.length} ảnh reference`, state: 'pending' })
    stepDefs.push({ label: 'Tạo video', state: 'pending' })
    stepDefs.push({ label: `Tạo ${scenes.length} phân cảnh`, state: 'pending' })
    setBuildSteps(stepDefs)
    setBuilding(true)

    let si = 0
    try {
      // B1: extension + Flow key
      setBuildStep(si, { state: 'running' })
      const flowStatus = await fetchAPI<{ connected: boolean; flow_key_present: boolean }>('/api/flow/status')
      setConnected(!!flowStatus.connected)
      setKeyPresent(!!flowStatus.flow_key_present)
      if (!flowStatus.connected) {
        setBuildStep(si, { state: 'error', detail: 'Extension chưa kết nối. Load extension trong Chrome rồi thử lại.' })
        setBuilding(false); return
      }
      if (!flowStatus.flow_key_present) {
        setBuildStep(si, { state: 'error', detail: 'Chưa có Flow key. Mở tab https://labs.google/fx/tools/flow và đăng nhập, rồi thử lại.' })
        setBuilding(false); return
      }
      setBuildStep(si, { state: 'done' }); si++

      // B2: create project (with edited entities as characters)
      setBuildStep(si, { state: 'running' })
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
      setBuildStep(si, { state: 'done', detail: `project.id = ${project.id}` }); si++

      // B3: upload reference images (optional) + link to entities
      if (withImages.length) {
        setBuildStep(si, { state: 'running' })
        try {
          const uploaded: { name: string; media_id: string }[] = []
          for (const e of withImages) {
            const res = await uploadImageData(e.image!.file, project.id)
            if (res.media_id) uploaded.push({ name: e.name.trim(), media_id: res.media_id })
          }
          const chars = await fetchAPI<Character[]>(`/api/projects/${project.id}/characters`)
          let linked = 0
          for (const up of uploaded) {
            const ent = chars.find(c => c.name === up.name)
            if (!ent) continue
            await patchAPI(`/api/characters/${ent.id}`, { media_id: up.media_id })
            linked++
          }
          setBuildStep(si, { state: 'done', detail: `Đã gắn ${linked}/${withImages.length} ảnh reference` })
        } catch (e) {
          setBuildStep(si, { state: 'error', detail: `Project đã tạo nhưng upload/gắn ảnh thất bại: ${errMsg(e)}` })
          setBuilding(false); return
        }
        si++
      }

      // B4: create video
      setBuildStep(si, { state: 'running' })
      const video = await postAPI<Video>('/api/videos', {
        project_id: project.id,
        title: projectName.trim(),
        orientation: ORIENT(ori),
      })
      setCreatedVideoId(video.id)
      setBuildStep(si, { state: 'done', detail: `video.id = ${video.id}` }); si++

      // B5: create scenes
      setBuildStep(si, { state: 'running' })
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
        setBuildStep(si, { state: 'running', detail: `Đã tạo ${made}/${scenes.length} cảnh` })
      }
      setBuildStep(si, { state: 'done', detail: `Đã tạo ${made} cảnh` })

      setBuilding(false)
      setStep(4)
    } catch (e) {
      setBuildStep(si, { state: 'error', detail: errMsg(e) })
      setBuilding(false)
    }
  }

  // ---- step 4: media generation ----
  const flowOk = connected === true && keyPresent === true
  const missingEntities = srvEntities.filter(e => !e.media_id)
  const allImagesReady = srvScenes.length > 0 && srvScenes.every(s => imgStatus(s, ori) === 'COMPLETED')
  const allVideosReady = srvScenes.length > 0 && srvScenes.every(s => vidStatus(s, ori) === 'COMPLETED')
  const all4kReady = srvScenes.length > 0 && srvScenes.every(s => upStatus(s, ori) === 'COMPLETED')
  const scenesWithNarration = srvScenes.filter(s => (s.narrator_text ?? '').trim() !== '')

  const charBusy = !!pollRef.current['char']
  const imgBusy = !!pollRef.current['img']
  const vidBusy = !!pollRef.current['vid']
  const upBusy = !!pollRef.current['up']

  async function genCharImages() {
    if (!createdProjectId || missingEntities.length === 0) return
    setActionError(null)
    if (!(await ensureFlow())) return
    try {
      await postAPI('/api/requests/batch', {
        requests: missingEntities.map(e => ({
          type: 'GENERATE_CHARACTER_IMAGE',
          character_id: e.id,
          project_id: createdProjectId,
        })),
      })
      startPoll('char', `project_id=${createdProjectId}&type=GENERATE_CHARACTER_IMAGE`, setCharProg, loadEntities)
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  async function genAllImages() {
    if (!createdProjectId || !createdVideoId || srvScenes.length === 0) return
    setActionError(null)
    if (!(await ensureFlow())) return
    try {
      await postAPI('/api/requests/batch', {
        requests: srvScenes.map(s => ({
          type: 'GENERATE_IMAGE',
          scene_id: s.id,
          project_id: createdProjectId,
          video_id: createdVideoId,
          orientation: ORIENT(ori),
        })),
      })
      startPoll('img', `video_id=${createdVideoId}&type=GENERATE_IMAGE&orientation=${ORIENT(ori)}`, setImgProg, loadScenes)
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  async function genAllVideos() {
    if (!createdProjectId || !createdVideoId || !allImagesReady) return
    setActionError(null)
    if (!(await ensureFlow())) return
    try {
      await postAPI('/api/requests/batch', {
        requests: srvScenes.map(s => ({
          type: 'GENERATE_VIDEO',
          scene_id: s.id,
          project_id: createdProjectId,
          video_id: createdVideoId,
          orientation: ORIENT(ori),
        })),
      })
      startPoll('vid', `video_id=${createdVideoId}&type=GENERATE_VIDEO&orientation=${ORIENT(ori)}`, setVidProg, loadScenes)
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  // ---- step 5: finishing ----
  async function genAll4K() {
    if (!createdProjectId || !createdVideoId || srvScenes.length === 0) return
    setActionError(null)
    if (!(await ensureFlow())) return
    try {
      await postAPI('/api/requests/batch', {
        requests: srvScenes.map(s => ({
          type: 'UPSCALE_VIDEO',
          scene_id: s.id,
          project_id: createdProjectId,
          video_id: createdVideoId,
          orientation: ORIENT(ori),
        })),
      })
      startPoll('up', `video_id=${createdVideoId}&type=UPSCALE_VIDEO&orientation=${ORIENT(ori)}`, setUpProg, loadScenes)
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  async function runNarrate() {
    if (!createdProjectId || !createdVideoId) return
    setActionError(null)
    setTtsResult(null)
    setTtsRunning(true)
    try {
      const r = await postAPI<NarrateResult>(`/api/videos/${createdVideoId}/narrate`, {
        project_id: createdProjectId,
        orientation: ORIENT(ori),
        ...(selectedTemplate ? { template: selectedTemplate } : {}),
      })
      setTtsResult(`Đã lồng tiếng ${r.scenes_narrated} cảnh (bỏ qua ${r.scenes_skipped}, lỗi ${r.scenes_failed}).`)
    } catch (e) {
      setActionError(errMsg(e))
    } finally {
      setTtsRunning(false)
    }
  }

  async function runConcat() {
    if (!createdVideoId) return
    setActionError(null)
    setConcatResult(null)
    setFfmpegMissing(false)
    setConcatRunning(true)
    try {
      const r = await postAPI<ConcatResult>(`/api/videos/${createdVideoId}/concat`, { with_tts: withTts })
      setConcatResult(r.output_path)
    } catch (e) {
      const m = errMsg(e)
      if (m.includes('503') || m.toLowerCase().includes('ffmpeg')) setFfmpegMissing(true)
      else setActionError(m)
    } finally {
      setConcatRunning(false)
    }
  }

  // ---- navigation gating ----
  const canNext =
    step === 1 ? hasDraft :
    step === 2 ? true :
    step === 3 ? !!createdVideoId :
    step === 4 ? allVideosReady :
    false

  function goNext() { if (step < 5 && canNext) setStep(step + 1) }
  function goBack() { if (step > 1) setStep(step - 1) }

  // primary button styling helper
  function btnStyle(enabled: boolean, color = 'var(--accent)') {
    return {
      background: enabled ? color : 'var(--card)',
      color: enabled ? '#fff' : 'var(--muted)',
      border: '1px solid var(--border)',
      cursor: enabled ? 'pointer' : 'not-allowed',
    } as const
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {/* intro */}
      <div className="rounded-lg p-4 flex flex-col gap-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div className="flex items-center gap-2 font-bold text-sm" style={{ color: 'var(--text)' }}>
          <Wand2 size={16} style={{ color: 'var(--accent)' }} /> Tạo video theo 5 bước
        </div>
        <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
          Trình hướng dẫn dẫn bạn đi tuần tự từ <b>ý tưởng</b> đến <b>video hoàn chỉnh</b>. Cần thao tác nâng cao?
          Dùng các trang <b>AI Tạo video</b> / <b>Create</b> / <b>Studio</b>.
        </div>
      </div>

      <Stepper step={step} onJump={setStep} />

      <FlowBanner connected={connected} keyPresent={keyPresent} onRecheck={refreshFlowStatus} />

      {actionError && (
        <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', color: 'var(--red)' }}>
          {actionError}
        </div>
      )}

      {/* ===================== BƯỚC 1 ===================== */}
      {step === 1 && (
        <>
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
                <Field label="BASE URL" hint="Ví dụ: https://api.openai.com/v1">
                  <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle} placeholder="https://api.openai.com/v1" />
                </Field>
                <Field label="API KEY" hint={cfg?.configured ? `Đã có key (${cfg.api_key_masked}). Để trống nếu không đổi.` : undefined}>
                  <input type="password" value={apiKey} onChange={e => setApiKey(e.target.value)} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle} placeholder={cfg?.configured ? '•••••••• (giữ key cũ)' : 'sk-...'} />
                </Field>
                <Field label="MODEL" hint="Ví dụ: gpt-4o-mini, claude-3-5-sonnet...">
                  <input value={model} onChange={e => setModel(e.target.value)} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle} placeholder="gpt-4o-mini" />
                </Field>
                <div className="flex items-center gap-3 flex-wrap">
                  <button type="button" onClick={handleSaveConfig} disabled={savingCfg || !baseUrl.trim() || !model.trim()} className="px-3 py-1.5 rounded text-xs font-semibold" style={{ background: 'var(--accent)', color: '#fff', border: '1px solid var(--border)', opacity: savingCfg ? 0.6 : 1 }}>
                    {savingCfg ? 'Đang lưu…' : 'Lưu'}
                  </button>
                  <button type="button" onClick={handleTestConfig} disabled={testing || !cfg?.configured} className="px-3 py-1.5 rounded text-xs font-semibold" style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)', opacity: testing || !cfg?.configured ? 0.6 : 1 }}>
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

          {/* brief */}
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Yêu cầu của bạn</div>
            <Field label="Ý TƯỞNG VIDEO (bắt buộc)" hint="Tả ý tưởng, chủ đề, thông điệp... AI sẽ tự chia phân cảnh.">
              <textarea value={brief} onChange={e => setBrief(e.target.value)} rows={5} className="rounded px-2 py-1.5 text-xs outline-none resize-y" style={inputStyle} placeholder="Ví dụ: Một video ngắn kể về hành trình của chú robot nhỏ đi tìm ánh sáng mặt trời trong thành phố tương lai." />
            </Field>
            <div className="grid grid-cols-2 gap-3">
              <Field label="MATERIAL (phong cách)">
                <select value={material} onChange={e => setMaterial(e.target.value)} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle}>
                  {materials.length === 0 && <option value="">Đang tải…</option>}
                  {materials.map(m => <option key={m.id} value={m.id}>{m.name}</option>)}
                </select>
              </Field>
              <Field label="HƯỚNG KHUNG HÌNH">
                <div className="flex gap-2">
                  {(['vertical', 'horizontal'] as Ori[]).map(o => {
                    const on = ori === o
                    return (
                      <button key={o} type="button" onClick={() => setOri(o)} className="text-xs px-3 py-1.5 rounded font-semibold flex-1" style={{ background: on ? 'var(--accent)' : 'var(--surface)', color: on ? '#fff' : 'var(--muted)', border: '1px solid var(--border)' }}>
                        {o === 'vertical' ? 'Dọc 9:16' : 'Ngang 16:9'}
                      </button>
                    )
                  })}
                </div>
              </Field>
              <Field label="SỐ CẢNH (tùy chọn)" hint="Để trống → AI tự quyết">
                <input value={numScenes} onChange={e => setNumScenes(e.target.value.replace(/[^0-9]/g, ''))} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle} placeholder="tự động" />
              </Field>
              <Field label="NGÔN NGỮ">
                <input value={language} onChange={e => setLanguage(e.target.value)} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle} placeholder="vi" />
              </Field>
            </div>
            <div className="flex items-center gap-3">
              <button type="button" onClick={handleGenerate} disabled={generating || brief.trim() === ''} className="flex items-center gap-2 px-4 py-2 rounded text-xs font-semibold" style={btnStyle(!generating && brief.trim() !== '')}>
                <Wand2 size={14} /> {generating ? 'AI đang viết kịch bản…' : 'AI viết kịch bản'}
              </button>
              {genError && <span className="text-xs" style={{ color: 'var(--red)' }}>{genError}</span>}
            </div>
            {!hasDraft && <div className="text-xs" style={{ color: 'var(--muted)' }}>Cần AI viết kịch bản (có draft) trước khi sang bước tiếp theo.</div>}
          </div>
        </>
      )}

      {/* ===================== BƯỚC 2 ===================== */}
      {step === 2 && (
        <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Users size={15} style={{ color: 'var(--accent)' }} />
              <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Nhân vật / Đồ vật ({entities.length})</div>
            </div>
            <button type="button" onClick={addEntity} className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
              <Plus size={12} /> Thêm
            </button>
          </div>
          <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
            Đây là nhân vật/đồ vật AI giữ <b>cố định</b> xuyên suốt video. Bạn có thể <b>tự upload ảnh mẫu</b> ngay bây giờ,
            hoặc để trống — AI sẽ <b>tự vẽ ảnh</b> ở Bước 4.
          </div>
          {entities.length === 0 && <div className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có nhân vật nào. Bấm "Thêm" nếu cần, hoặc bỏ qua bước này.</div>}
          {entities.map((e, i) => (
            <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
              <div className="grid gap-2" style={{ gridTemplateColumns: '1fr 140px auto' }}>
                <input value={e.name} onChange={ev => updateEntity(i, { name: ev.target.value })} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle} placeholder="Tên" />
                <select value={e.entity_type} onChange={ev => updateEntity(i, { entity_type: ev.target.value as EntityType })} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle}>
                  <option value="character">character</option>
                  <option value="visual_asset">visual_asset</option>
                  <option value="location">location</option>
                  <option value="creature">creature</option>
                </select>
                <button type="button" onClick={() => removeEntity(i)} className="px-2 rounded text-xs" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--red)' }}>
                  <Trash2 size={12} />
                </button>
              </div>
              <textarea value={e.description} onChange={ev => updateEntity(i, { description: ev.target.value })} rows={2} className="rounded px-2 py-1.5 text-xs outline-none resize-y" style={inputStyle} placeholder="Mô tả ngoại hình ngắn gọn" />
              <Field label="ẢNH THAM CHIẾU (tùy chọn)">
                <ImageDropzone
                  image={e.image}
                  onPick={f => updateEntity(i, { image: { file: f, previewUrl: URL.createObjectURL(f) } })}
                  onClear={() => updateEntity(i, { image: null })}
                />
              </Field>
            </div>
          ))}
        </div>
      )}

      {/* ===================== BƯỚC 3 ===================== */}
      {step === 3 && (
        <>
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Thông tin & kịch bản</div>
            <Field label="TÊN PROJECT (bắt buộc)">
              <input value={projectName} onChange={e => setProjectName(e.target.value)} className="rounded px-2 py-1.5 text-xs outline-none" style={inputStyle} />
            </Field>
            <Field label="STORY / TÓM TẮT">
              <textarea value={story} onChange={e => setStory(e.target.value)} rows={3} className="rounded px-2 py-1.5 text-xs outline-none resize-y" style={inputStyle} />
            </Field>
          </div>

          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Film size={15} style={{ color: 'var(--accent)' }} />
                <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Phân cảnh ({scenes.length})</div>
              </div>
              <button type="button" onClick={addSceneDraft} className="flex items-center gap-1 px-2 py-1 rounded text-xs" style={{ background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)' }}>
                <Plus size={12} /> Thêm cảnh
              </button>
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              Mỗi cảnh ~<b>8 giây</b>. Tả <b>HÀNH ĐỘNG</b>, đừng tả ngoại hình (ảnh nhân vật đã lo phần đó).
            </div>
            {scenes.map((s, i) => (
              <div key={i} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold" style={{ color: 'var(--accent)' }}>Cảnh {i + 1}</span>
                  <div className="flex items-center gap-1">
                    <button type="button" onClick={() => moveScene(i, -1)} disabled={i === 0} className="px-1.5 py-1 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', opacity: i === 0 ? 0.4 : 1 }}><ArrowUp size={12} /></button>
                    <button type="button" onClick={() => moveScene(i, 1)} disabled={i === scenes.length - 1} className="px-1.5 py-1 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--muted)', opacity: i === scenes.length - 1 ? 0.4 : 1 }}><ArrowDown size={12} /></button>
                    <button type="button" onClick={() => removeSceneDraft(i)} className="px-1.5 py-1 rounded" style={{ background: 'var(--card)', border: '1px solid var(--border)', color: 'var(--red)' }}><Trash2 size={12} /></button>
                  </div>
                </div>
                <Field label="MÔ TẢ HÀNH ĐỘNG CẢNH">
                  <textarea value={s.prompt} onChange={ev => updateScene(i, { prompt: ev.target.value })} rows={2} className="rounded px-2 py-1.5 text-xs outline-none resize-y" style={inputStyle} placeholder="VD: Nhân vật chạy qua khu rừng, ánh nắng xuyên qua tán cây" />
                </Field>
                <Field label="CHUYỂN ĐỘNG VIDEO 8s (video_prompt)">
                  <textarea value={s.video_prompt} onChange={ev => updateScene(i, { video_prompt: ev.target.value })} rows={2} className="rounded px-2 py-1.5 text-xs outline-none resize-y" style={inputStyle} placeholder="VD: Máy quay đi theo nhân vật, lá cây rung nhẹ trong gió" />
                </Field>
                {entityNames.length > 0 && (
                  <Field label="NHÂN VẬT / ĐỒ VẬT TRONG CẢNH">
                    <div className="flex flex-wrap gap-1.5">
                      {entityNames.map(name => {
                        const active = s.character_names.includes(name)
                        return (
                          <button key={name} type="button" onClick={() => toggleSceneEntity(i, name)} className="px-2 py-1 rounded text-xs font-semibold" style={{ background: active ? 'var(--accent)' : 'var(--card)', color: active ? '#fff' : 'var(--muted)', border: '1px solid var(--border)' }}>
                            {name}
                          </button>
                        )
                      })}
                    </div>
                  </Field>
                )}
                <Field label="LỜI DẪN / THUYẾT MINH (narrator_text)">
                  <textarea value={s.narrator_text} onChange={ev => updateScene(i, { narrator_text: ev.target.value })} rows={2} className="rounded px-2 py-1.5 text-xs outline-none resize-y" style={inputStyle} placeholder="VD: Giữa khu rừng cổ, nhân vật của chúng ta bắt đầu cuộc hành trình…" />
                </Field>
              </div>
            ))}
          </div>

          {/* build action */}
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            {createdVideoId ? (
              <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid var(--green)', color: 'var(--green)' }}>
                <CheckCircle size={13} className="mt-0.5 shrink-0" />
                <span>Đã tạo dự án + video + cảnh. Bấm <b>Tiếp</b> để sang bước tạo hình ảnh &amp; video.</span>
              </div>
            ) : (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                Bấm "Tạo dự án" để tạo project trên Google Flow (cần extension kết nối + Flow key).
              </div>
            )}
            <div>
              <button
                type="button"
                onClick={handleBuild}
                disabled={building || projectName.trim() === '' || material === '' || scenes.length === 0 || !!createdVideoId}
                className="px-4 py-2 rounded text-xs font-semibold"
                style={btnStyle(!building && projectName.trim() !== '' && material !== '' && scenes.length > 0 && !createdVideoId)}
              >
                {building ? 'Đang tạo…' : createdVideoId ? 'Đã tạo dự án ✓' : 'Tạo dự án'}
              </button>
            </div>
            {buildSteps.length > 0 && (
              <div className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>TIẾN TRÌNH</div>
                {buildSteps.map((s, i) => <StepRow key={i} step={s} />)}
              </div>
            )}
          </div>
        </>
      )}

      {/* ===================== BƯỚC 4 ===================== */}
      {step === 4 && (
        <>
          {/* character images */}
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="flex items-center gap-2">
              <Users size={15} style={{ color: 'var(--accent)' }} />
              <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>1) Ảnh nhân vật</div>
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Ảnh nhân vật là "bản gốc" để AI giữ đúng thiết kế ở mọi cảnh. {missingEntities.length === 0 ? 'Tất cả entity đã có ảnh.' : `${missingEntities.length} entity chưa có ảnh.`}
            </div>
            {srvEntities.length > 0 && (
              <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(120px, 1fr))' }}>
                {srvEntities.map(e => (
                  <div key={e.id} className="rounded-lg p-2 flex flex-col gap-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="rounded overflow-hidden flex items-center justify-center" style={{ width: '100%', aspectRatio: '1/1', background: 'var(--bg)', border: '1px solid var(--border)' }}>
                      {e.reference_image_url ? <img src={e.reference_image_url} alt={e.name} className="w-full h-full object-cover" /> : <span className="text-xs" style={{ color: 'var(--muted)' }}>{e.entity_type}</span>}
                    </div>
                    <div className="font-bold text-xs truncate" style={{ color: 'var(--text)' }}>{e.name}</div>
                    {e.media_id
                      ? <span className="text-xs" style={{ color: 'var(--green)' }}>✓ Đã có ảnh</span>
                      : <span className="text-xs" style={{ color: 'var(--red)' }}>Chưa có ảnh</span>}
                  </div>
                ))}
              </div>
            )}
            {missingEntities.length > 0 && (
              <div className="flex flex-col gap-2">
                <button type="button" onClick={genCharImages} disabled={charBusy || !flowOk} className="text-xs px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 self-start" style={btnStyle(!charBusy && flowOk)} title={!flowOk ? 'Cần extension kết nối + Flow key' : undefined}>
                  <ImageIcon size={13} /> {charBusy ? 'Đang tạo ảnh nhân vật…' : `Tạo ảnh cho ${missingEntities.length} nhân vật chưa có`}
                </button>
                <ProgressBar label="Ảnh nhân vật" prog={charProg} />
              </div>
            )}
          </div>

          {/* scene images + videos */}
          <div className="rounded-lg p-4 flex flex-col gap-4" style={cardStyle}>
            <div className="flex items-center gap-2">
              <Film size={15} style={{ color: 'var(--accent)' }} />
              <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Các cảnh ({srvScenes.length})</div>
              <span className="text-xs px-2 py-0.5 rounded ml-auto" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>{ori === 'horizontal' ? 'Ngang 16:9' : 'Dọc 9:16'}</span>
            </div>

            {/* per-scene status */}
            <div className="grid gap-2" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
              {srvScenes.map((s, i) => {
                const iUrl = imgUrl(s, ori)
                const vUrl = vidUrl(s, ori)
                return (
                  <div key={s.id} className="rounded-lg p-2 flex flex-col gap-1.5" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div className="rounded overflow-hidden flex items-center justify-center" style={{ width: '100%', aspectRatio: ori === 'horizontal' ? '16/9' : '9/16', maxHeight: 140, background: 'var(--bg)', border: '1px solid var(--border)' }}>
                      {vUrl ? <video src={vUrl} controls className="w-full h-full object-cover" /> : iUrl ? <img src={iUrl} alt={`Cảnh ${i + 1}`} className="w-full h-full object-cover" /> : <span className="text-xs" style={{ color: 'var(--muted)' }}>Cảnh {i + 1}</span>}
                    </div>
                    <div className="flex items-center justify-between text-xs" style={{ color: 'var(--muted)' }}>
                      <span className="font-bold" style={{ color: 'var(--accent)' }}>#{i + 1}</span>
                      <span className="flex items-center gap-1"><StatusDot status={imgStatus(s, ori)} /> {STATUS_VN[imgStatus(s, ori)]}</span>
                      <span className="flex items-center gap-1"><StatusDot status={vidStatus(s, ori)} /> {STATUS_VN[vidStatus(s, ori)]}</span>
                    </div>
                  </div>
                )
              })}
            </div>

            {/* step: images */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={genAllImages} disabled={imgBusy || srvScenes.length === 0 || !flowOk} className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5" style={btnStyle(!imgBusy && srvScenes.length > 0 && flowOk)}>
                  <ImageIcon size={13} /> {imgBusy ? 'Đang tạo ảnh…' : `2) Tạo ảnh tất cả cảnh (${srvScenes.length})`}
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>{!flowOk ? 'Cần extension kết nối + Flow key.' : 'Tạo ảnh nền cho từng cảnh.'}</span>
              </div>
              <ProgressBar label="Ảnh cảnh" prog={imgProg} />
            </div>

            {/* step: videos */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button type="button" onClick={genAllVideos} disabled={vidBusy || !allImagesReady || !flowOk} className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5" style={btnStyle(!vidBusy && allImagesReady && flowOk)}>
                  <Film size={13} /> {vidBusy ? 'Đang tạo video…' : `3) Tạo video tất cả cảnh (${srvScenes.length})`}
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {!allImagesReady ? 'Chỉ bật khi TẤT CẢ cảnh đã có ảnh (COMPLETED).' : !flowOk ? 'Cần extension kết nối + Flow key.' : 'Mỗi cảnh mất 2–5 phút — hãy để cửa sổ mở.'}
                </span>
              </div>
              <ProgressBar label="Video cảnh" prog={vidProg} />
            </div>

            {allVideosReady && (
              <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid var(--green)', color: 'var(--green)' }}>
                <CheckCircle size={13} className="mt-0.5 shrink-0" />
                <span>Đã có video cho mọi cảnh. Bấm <b>Tiếp</b> để hoàn thiện &amp; xuất video.</span>
              </div>
            )}
          </div>
        </>
      )}

      {/* ===================== BƯỚC 5 ===================== */}
      {step === 5 && (
        <div className="rounded-lg p-4 flex flex-col gap-5" style={cardStyle}>
          <div>
            <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Hoàn thiện &amp; Xuất</div>
            <div className="text-xs mt-1" style={{ color: 'var(--muted)' }}>
              Có thể nâng 4K và lồng tiếng (đều tùy chọn), rồi ghép thành 1 video hoàn chỉnh.
            </div>
          </div>

          {/* 4K */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={genAll4K} disabled={upBusy || !flowOk || all4kReady} className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5" style={btnStyle(!upBusy && flowOk && !all4kReady)} title={!flowOk ? 'Cần extension kết nối + Flow key' : undefined}>
                <Sparkles size={13} /> {all4kReady ? 'Đã nâng 4K tất cả cảnh' : upBusy ? 'Đang nâng 4K…' : `Nâng 4K tất cả cảnh (${srvScenes.length})`}
              </button>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{!flowOk ? 'Cần extension kết nối + Flow key.' : 'Nâng độ phân giải lên 4K (không bắt buộc, tốn thời gian).'}</span>
            </div>
            <ProgressBar label="4K" prog={upProg} />
          </div>

          {/* TTS */}
          <div className="flex flex-col gap-2">
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={runNarrate} disabled={ttsRunning || scenesWithNarration.length === 0} className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5" style={btnStyle(!ttsRunning && scenesWithNarration.length > 0)} title={scenesWithNarration.length === 0 ? 'Điền LỜI DẪN cho ít nhất 1 cảnh ở Bước 3 trước' : undefined}>
                <Mic size={13} /> {ttsRunning ? 'Đang lồng tiếng…' : `Lồng tiếng (TTS) — ${scenesWithNarration.length} cảnh có lời dẫn`}
              </button>
              {templates.length > 0 && (
                <select value={selectedTemplate} onChange={e => setSelectedTemplate(e.target.value)} className="text-xs px-2 py-1.5 rounded outline-none" style={inputStyle} title="Chọn giọng đọc">
                  <option value="">Giọng mặc định của project</option>
                  {templates.map(t => <option key={t.name} value={t.name}>{t.name}</option>)}
                </select>
              )}
            </div>
            <span className="text-xs" style={{ color: 'var(--muted)' }}>
              {scenesWithNarration.length === 0 ? 'Chưa cảnh nào có LỜI DẪN. Quay lại Bước 3 điền “LỜI DẪN” trước.' : 'Tạo giọng đọc lời dẫn (không bắt buộc).'}
            </span>
            {ttsResult && <div className="text-xs" style={{ color: 'var(--green)' }}>{ttsResult}</div>}
          </div>

          {/* concat */}
          <div className="flex flex-col gap-2 pt-1" style={{ borderTop: '1px solid var(--border)' }}>
            <label className="flex items-center gap-2 text-xs mt-2" style={{ color: 'var(--muted)' }}>
              <input type="checkbox" checked={withTts} onChange={e => setWithTts(e.target.checked)} />
              Kèm lồng tiếng (dùng bản đã tạo ở bước Lồng tiếng nếu có)
            </label>
            <div className="flex items-center gap-3 flex-wrap">
              <button type="button" onClick={runConcat} disabled={concatRunning || !allVideosReady} className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5" style={btnStyle(!concatRunning && allVideosReady, 'var(--green)')} title={!allVideosReady ? 'Cần tạo video tất cả cảnh trước' : undefined}>
                <Combine size={13} /> {concatRunning ? 'Đang ghép…' : 'GHÉP thành video hoàn chỉnh'}
              </button>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>cần ffmpeg trên máy</span>
            </div>
            {ffmpegMissing && (
              <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid var(--yellow)', color: 'var(--yellow)' }}>
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                <span>Chưa cài ffmpeg. Cài bằng: <code>winget install Gyan.FFmpeg</code> rồi thử lại.</span>
              </div>
            )}
            {concatResult && (
              <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid var(--green)', color: 'var(--green)' }}>
                <CheckCircle size={13} className="mt-0.5 shrink-0" />
                <span>Xong! File: <b style={{ wordBreak: 'break-all' }}>{concatResult}</b></span>
              </div>
            )}
          </div>

          {createdProjectId && (
            <div className="pt-1" style={{ borderTop: '1px solid var(--border)' }}>
              <button type="button" onClick={() => navigate(`/projects/${createdProjectId}/studio`)} className="text-xs px-4 py-2 rounded font-semibold mt-2" style={{ background: 'var(--card)', color: 'var(--accent)', border: '1px solid var(--border)' }}>
                Xem trong Studio →
              </button>
            </div>
          )}
        </div>
      )}

      {/* ===================== NAV ===================== */}
      <div className="flex items-center justify-between sticky bottom-0 py-3" style={{ background: 'var(--bg)' }}>
        <button type="button" onClick={goBack} disabled={step === 1} className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5" style={btnStyle(step > 1, 'var(--card)')}>
          <ArrowLeft size={13} /> Quay lại
        </button>
        {step < 5 && (
          <button type="button" onClick={goNext} disabled={!canNext} className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5" style={btnStyle(canNext)}>
            Tiếp <ArrowRight size={13} />
          </button>
        )}
      </div>
    </div>
  )
}
