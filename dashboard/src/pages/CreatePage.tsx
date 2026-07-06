import { useState, useEffect, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { fetchAPI, patchAPI, postAPI, uploadImageData } from '../api/client'
import type { Project, Character, Material, EntityType } from '../types'
import { UploadCloud, X, ImagePlus } from 'lucide-react'

// ---- small styled primitives (match ProjectsPage / ProjectDetailPage) ----

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

interface ImagePick {
  file: File
  previewUrl: string
}

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
        <img src={image.previewUrl} alt="preview" className="rounded object-cover" style={{ width: 64, height: 64, border: '1px solid var(--border)' }} />
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
      className="rounded-lg p-6 flex flex-col items-center gap-2 cursor-pointer transition-colors"
      style={{
        background: 'var(--surface)',
        border: `1px dashed ${dragOver ? 'var(--accent)' : 'var(--border)'}`,
        color: 'var(--muted)',
      }}
    >
      <UploadCloud size={22} />
      <span className="text-xs text-center">Kéo-thả ảnh vào đây hoặc bấm để chọn</span>
      <span className="text-xs" style={{ color: 'var(--muted)' }}>Khuyến nghị ảnh dọc (portrait), image/*</span>
      <input ref={inputRef} type="file" accept="image/*" className="hidden" onChange={e => handleFiles(e.target.files)} />
    </div>
  )
}

// ---- one entity block (Main Character / Main Object) ----

interface EntityForm {
  name: string
  description: string
  image: ImagePick | null
}

function EntityBlock({
  title, subtitle, form, onChange,
}: { title: string; subtitle: string; form: EntityForm; onChange: (f: EntityForm) => void }) {
  return (
    <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
      <div className="flex items-center gap-2">
        <ImagePlus size={16} style={{ color: 'var(--accent)' }} />
        <div>
          <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>{title}</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>{subtitle}</div>
        </div>
      </div>
      <Field label="TÊN">
        <input
          value={form.name}
          onChange={e => onChange({ ...form, name: e.target.value })}
          className="rounded px-2 py-1.5 text-xs outline-none"
          style={inputStyle}
          placeholder="Ví dụ: Anh hùng Aria"
        />
      </Field>
      <Field label="MÔ TẢ NGẮN (tùy chọn)">
        <textarea
          value={form.description}
          onChange={e => onChange({ ...form, description: e.target.value })}
          rows={2}
          className="rounded px-2 py-1.5 text-xs outline-none resize-y"
          style={inputStyle}
          placeholder="Đặc điểm nhận dạng nổi bật"
        />
      </Field>
      <Field label="ẢNH THAM CHIẾU (reference image)">
        <ImageDropzone
          image={form.image}
          onPick={f => onChange({ ...form, image: { file: f, previewUrl: URL.createObjectURL(f) } })}
          onClear={() => onChange({ ...form, image: null })}
        />
      </Field>
    </div>
  )
}

// ---- step status log ----

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

// ---- page ----

export default function CreatePage() {
  const navigate = useNavigate()

  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [story, setStory] = useState('')
  const [language, setLanguage] = useState('en')
  const [material, setMaterial] = useState('')
  const [materials, setMaterials] = useState<Material[]>([])

  const [character, setCharacter] = useState<EntityForm>({ name: '', description: '', image: null })
  const [object, setObject] = useState<EntityForm>({ name: '', description: '', image: null })

  const [extensionConnected, setExtensionConnected] = useState<boolean | null>(null)
  const [flowKeyPresent, setFlowKeyPresent] = useState<boolean | null>(null)
  const [running, setRunning] = useState(false)
  const [steps, setSteps] = useState<Step[]>([])
  const [createdProjectId, setCreatedProjectId] = useState<string | null>(null)

  function refreshFlowStatus() {
    fetchAPI<{ connected: boolean; flow_key_present: boolean }>('/api/flow/status')
      .then(s => { setExtensionConnected(!!s.connected); setFlowKeyPresent(!!s.flow_key_present) })
      .catch(() => { setExtensionConnected(false); setFlowKeyPresent(false) })
  }

  useEffect(() => {
    fetchAPI<Material[]>('/api/materials')
      .then(m => { setMaterials(m); if (m.length && !material) setMaterial(m[0].id) })
      .catch(console.error)
    refreshFlowStatus()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function setStep(idx: number, patch: Partial<Step>) {
    setSteps(prev => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)))
  }

  const canSubmit = name.trim() !== '' && material !== '' && !running

  async function handleCreate() {
    setCreatedProjectId(null)
    const hasObject = object.name.trim() !== ''

    // Build step list
    const stepDefs: Step[] = [
      { label: 'Kiểm tra extension + Flow key', state: 'pending' },
      { label: 'Tạo project trên Google Flow', state: 'pending' },
    ]
    if (character.image) stepDefs.push({ label: `Upload ảnh nhân vật "${character.name || 'nhân vật'}"`, state: 'pending' })
    if (hasObject && object.image) stepDefs.push({ label: `Upload ảnh đồ vật "${object.name}"`, state: 'pending' })
    if (character.image || (hasObject && object.image)) stepDefs.push({ label: 'Gắn media_id vào entity (reference)', state: 'pending' })
    setSteps(stepDefs)
    setRunning(true)

    let si = 0
    try {
      // B1: extension + Flow key check
      setStep(si, { state: 'running' })
      const flowStatus = await fetchAPI<{ connected: boolean; flow_key_present: boolean }>('/api/flow/status')
      setExtensionConnected(!!flowStatus.connected)
      setFlowKeyPresent(!!flowStatus.flow_key_present)
      if (!flowStatus.connected) {
        setStep(si, { state: 'error', detail: 'Extension chưa kết nối. Load extension trong Chrome rồi thử lại.' })
        setRunning(false)
        return
      }
      if (!flowStatus.flow_key_present) {
        setStep(si, { state: 'error', detail: 'Chưa có Flow key. Mở tab https://labs.google/fx/tools/flow và đăng nhập, rồi thử lại.' })
        setRunning(false)
        return
      }
      setStep(si, { state: 'done' })
      si++

      // B2: create project
      setStep(si, { state: 'running' })
      const characters: Array<{ name: string; entity_type: EntityType; description?: string }> = []
      if (character.name.trim()) {
        characters.push({ name: character.name.trim(), entity_type: 'character', description: character.description.trim() || undefined })
      }
      if (hasObject) {
        characters.push({ name: object.name.trim(), entity_type: 'visual_asset', description: object.description.trim() || undefined })
      }
      const project = await postAPI<Project>('/api/projects', {
        name: name.trim(),
        description: description.trim() || undefined,
        story: story.trim() || undefined,
        language: language.trim() || 'en',
        material,
        characters: characters.length ? characters : undefined,
      })
      setCreatedProjectId(project.id)
      setStep(si, { state: 'done', detail: `project.id = ${project.id}` })
      si++

      // B3: upload images
      const uploads: Array<{ entityName: string; mediaId: string | null }> = []
      if (character.image) {
        setStep(si, { state: 'running' })
        try {
          const res = await uploadImageData(character.image.file, project.id)
          uploads.push({ entityName: character.name.trim(), mediaId: res.media_id })
          setStep(si, { state: 'done', detail: `media_id = ${res.media_id ?? '(none)'}` })
        } catch (e) {
          setStep(si, { state: 'error', detail: `Project đã tạo nhưng upload ảnh nhân vật thất bại: ${errMsg(e)}` })
          setRunning(false)
          return
        }
        si++
      }
      if (hasObject && object.image) {
        setStep(si, { state: 'running' })
        try {
          const res = await uploadImageData(object.image.file, project.id)
          uploads.push({ entityName: object.name.trim(), mediaId: res.media_id })
          setStep(si, { state: 'done', detail: `media_id = ${res.media_id ?? '(none)'}` })
        } catch (e) {
          setStep(si, { state: 'error', detail: `Project đã tạo nhưng upload ảnh đồ vật thất bại: ${errMsg(e)}` })
          setRunning(false)
          return
        }
        si++
      }

      // B4: link media_id to entities
      if (uploads.length) {
        setStep(si, { state: 'running' })
        try {
          const entities = await fetchAPI<Character[]>(`/api/projects/${project.id}/characters`)
          let linked = 0
          for (const up of uploads) {
            if (!up.mediaId) continue
            const ent = entities.find(e => e.name === up.entityName)
            if (!ent) continue
            await patchAPI(`/api/characters/${ent.id}`, { media_id: up.mediaId })
            linked++
          }
          setStep(si, { state: 'done', detail: `Đã gắn ${linked}/${uploads.length} ảnh reference` })
        } catch (e) {
          setStep(si, { state: 'error', detail: `Project + ảnh đã tạo nhưng gắn media_id thất bại: ${errMsg(e)}` })
          setRunning(false)
          return
        }
        si++
      }

      setRunning(false)
    } catch (e) {
      setStep(si, { state: 'error', detail: errMsg(e) })
      setRunning(false)
    }
  }

  return (
    <div className="flex flex-col gap-4 max-w-3xl">
      {extensionConnected === false && (
        <div className="rounded-lg p-3 text-xs flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', color: 'var(--red)' }}>
          <span className="flex-1">Extension chưa kết nối. Load extension trong Chrome (chrome://extensions → Load unpacked → thư mục extension\) trước khi tạo project.</span>
          <button type="button" onClick={refreshFlowStatus} className="px-2 py-1 rounded font-semibold shrink-0" style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}>Kiểm tra lại</button>
        </div>
      )}
      {extensionConnected === true && flowKeyPresent === false && (
        <div className="rounded-lg p-3 text-xs flex items-center gap-3" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid var(--yellow)', color: 'var(--yellow)' }}>
          <span className="flex-1">Chưa có Flow key. Mở tab https://labs.google/fx/tools/flow và đăng nhập để extension bắt được token, rồi bấm "Kiểm tra lại". (Nếu không sẽ lỗi NO_FLOW_KEY khi upload/generate.)</span>
          <button type="button" onClick={refreshFlowStatus} className="px-2 py-1 rounded font-semibold shrink-0" style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}>Kiểm tra lại</button>
        </div>
      )}

      {/* Project info */}
      <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
        <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Thông tin project</div>
        <Field label="TÊN PROJECT (bắt buộc)">
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            className="rounded px-2 py-1.5 text-xs outline-none"
            style={inputStyle}
            placeholder="Tên video / project"
          />
        </Field>
        <Field label="MÔ TẢ (tùy chọn)">
          <input
            value={description}
            onChange={e => setDescription(e.target.value)}
            className="rounded px-2 py-1.5 text-xs outline-none"
            style={inputStyle}
          />
        </Field>
        <Field label="STORY / NỘI DUNG (tùy chọn)">
          <textarea
            value={story}
            onChange={e => setStory(e.target.value)}
            rows={4}
            className="rounded px-2 py-1.5 text-xs outline-none resize-y"
            style={inputStyle}
          />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="NGÔN NGỮ">
            <input
              value={language}
              onChange={e => setLanguage(e.target.value)}
              className="rounded px-2 py-1.5 text-xs outline-none"
              style={inputStyle}
              placeholder="en"
            />
          </Field>
          <Field label="MATERIAL (bắt buộc)">
            <select
              value={material}
              onChange={e => setMaterial(e.target.value)}
              className="rounded px-2 py-1.5 text-xs outline-none"
              style={inputStyle}
            >
              {materials.length === 0 && <option value="">Đang tải…</option>}
              {materials.map(m => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </select>
          </Field>
        </div>
      </div>

      {/* Entities */}
      <div className="grid grid-cols-1 gap-4" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))' }}>
        <EntityBlock
          title="Nhân vật chính"
          subtitle="AI giữ nguyên thiết kế qua mọi scene"
          form={character}
          onChange={setCharacter}
        />
        <EntityBlock
          title="Đồ vật chính (tùy chọn)"
          subtitle="Để trống nếu không cần"
          form={object}
          onChange={setObject}
        />
      </div>

      {/* Actions */}
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={handleCreate}
          disabled={!canSubmit}
          className="px-4 py-2 rounded text-xs font-semibold transition-opacity"
          style={{
            background: canSubmit ? 'var(--accent)' : 'var(--card)',
            color: canSubmit ? '#fff' : 'var(--muted)',
            border: '1px solid var(--border)',
            cursor: canSubmit ? 'pointer' : 'not-allowed',
          }}
        >
          {running ? 'Đang tạo…' : 'Tạo project'}
        </button>
        {createdProjectId && !running && (
          <button
            type="button"
            onClick={() => navigate(`/projects/${createdProjectId}`)}
            className="px-4 py-2 rounded text-xs font-semibold"
            style={{ background: 'var(--card)', color: 'var(--accent)', border: '1px solid var(--border)' }}
          >
            Mở project →
          </button>
        )}
      </div>

      {/* Progress */}
      {steps.length > 0 && (
        <div className="rounded-lg p-4 flex flex-col gap-2" style={cardStyle}>
          <div className="text-xs font-bold" style={{ color: 'var(--muted)' }}>TIẾN TRÌNH</div>
          {steps.map((s, i) => <StepRow key={i} step={s} />)}
        </div>
      )}
    </div>
  )
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}
