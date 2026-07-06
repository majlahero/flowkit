import { useState, useEffect, useRef, useCallback } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { fetchAPI, postAPI, patchAPI } from '../api/client'
import type { Project, Character, Video, Scene, StatusType, Orientation } from '../types'
import { useWebSocket } from '../api/useWebSocket'
import { ArrowLeft, Plus, Trash2, Image as ImageIcon, Film, Users, RefreshCw } from 'lucide-react'

// ---- shared styled primitives (match CreatePage / ProjectDetailPage) ----

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

const STATUS_VN: Record<StatusType, string> = {
  PENDING: 'Chưa làm',
  PROCESSING: 'Đang xử lý',
  COMPLETED: 'Xong',
  FAILED: 'Lỗi',
}

function StatusDot({ status }: { status: StatusType }) {
  const colors: Record<StatusType, string> = {
    COMPLETED: 'var(--green)',
    PROCESSING: 'var(--yellow)',
    PENDING: 'var(--muted)',
    FAILED: 'var(--red)',
  }
  return (
    <span
      className="inline-block w-2 h-2 rounded-full"
      style={{ background: colors[status] ?? 'var(--muted)' }}
      title={STATUS_VN[status] ?? status}
    />
  )
}

// ---- orientation-aware accessors (never hardcode: follow the video's orientation) ----

type Ori = 'vertical' | 'horizontal'
function oriOf(video: Video | null): Ori {
  return video?.orientation === 'HORIZONTAL' ? 'horizontal' : 'vertical'
}
function ORIENT(ori: Ori): Orientation {
  return ori === 'horizontal' ? 'HORIZONTAL' : 'VERTICAL'
}
function imgStatus(s: Scene, o: Ori): StatusType {
  return o === 'horizontal' ? s.horizontal_image_status : s.vertical_image_status
}
function imgUrl(s: Scene, o: Ori): string | null {
  return o === 'horizontal' ? s.horizontal_image_url : s.vertical_image_url
}
function vidStatus(s: Scene, o: Ori): StatusType {
  return o === 'horizontal' ? s.horizontal_video_status : s.vertical_video_status
}
function vidUrl(s: Scene, o: Ori): string | null {
  return o === 'horizontal' ? s.horizontal_video_url : s.vertical_video_url
}

function normalizeCharNames(raw: string[] | string | null): string[] {
  if (!raw) return []
  if (Array.isArray(raw)) return raw
  try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch { return [] }
}

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

// ---- batch status (mirrors GET /api/requests/batch-status) ----

interface BatchStatus {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  done: boolean
  all_succeeded: boolean
  orientation: string | null
}

function ProgressBar({ label, prog }: { label: string; prog: BatchStatus | null }) {
  if (!prog || prog.total === 0) return null
  const pct = Math.round((prog.completed / prog.total) * 100)
  return (
    <div className="flex flex-col gap-1">
      <div className="text-xs" style={{ color: 'var(--muted)' }}>
        {label}: <b style={{ color: 'var(--text)' }}>{prog.completed}/{prog.total}</b>
        {' '}(đang xử lý {prog.processing}, lỗi {prog.failed})
      </div>
      <div className="h-2 rounded-full overflow-hidden" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
        <div
          className="h-full transition-all"
          style={{ width: `${pct}%`, background: prog.failed > 0 ? 'var(--yellow)' : 'var(--green)' }}
        />
      </div>
    </div>
  )
}

// ---- flow status warning banner (same behaviour as CreatePage) ----

function FlowBanner({
  connected, keyPresent, onRecheck,
}: { connected: boolean | null; keyPresent: boolean | null; onRecheck: () => void }) {
  if (connected === false) {
    return (
      <div className="rounded-lg p-3 text-xs flex items-center gap-3" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', color: 'var(--red)' }}>
        <span className="flex-1">Extension chưa kết nối. Load extension trong Chrome (chrome://extensions → Load unpacked → thư mục extension\) trước khi tạo ảnh/video.</span>
        <button type="button" onClick={onRecheck} className="px-2 py-1 rounded font-semibold shrink-0" style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}>Kiểm tra lại</button>
      </div>
    )
  }
  if (connected === true && keyPresent === false) {
    return (
      <div className="rounded-lg p-3 text-xs flex items-center gap-3" style={{ background: 'rgba(245,158,11,0.12)', border: '1px solid var(--yellow)', color: 'var(--yellow)' }}>
        <span className="flex-1">Chưa có Flow key. Mở tab https://labs.google/fx/tools/flow và đăng nhập để extension bắt được token, rồi bấm "Kiểm tra lại". (Nếu không sẽ lỗi NO_FLOW_KEY khi tạo ảnh/video.)</span>
        <button type="button" onClick={onRecheck} className="px-2 py-1 rounded font-semibold shrink-0" style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}>Kiểm tra lại</button>
      </div>
    )
  }
  return null
}

// ---- one scene card (editable prompt / video_prompt / character selection) ----

function SceneCard({
  scene, index, entityNames, ori, onReload,
}: {
  scene: Scene
  index: number
  entityNames: string[]
  ori: Ori
  onReload: () => void
}) {
  const [prompt, setPrompt] = useState(scene.prompt ?? '')
  const [videoPrompt, setVideoPrompt] = useState(scene.video_prompt ?? '')
  const [names, setNames] = useState<string[]>(normalizeCharNames(scene.character_names))
  const [saving, setSaving] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Re-sync local drafts if the scene reloads from server (e.g. after generation)
  useEffect(() => {
    setPrompt(scene.prompt ?? '')
    setVideoPrompt(scene.video_prompt ?? '')
    setNames(normalizeCharNames(scene.character_names))
  }, [scene.id, scene.prompt, scene.video_prompt, scene.character_names])

  const dirty =
    prompt !== (scene.prompt ?? '') ||
    videoPrompt !== (scene.video_prompt ?? '') ||
    JSON.stringify(names) !== JSON.stringify(normalizeCharNames(scene.character_names))

  function toggleName(n: string) {
    setNames(prev => (prev.includes(n) ? prev.filter(x => x !== n) : [...prev, n]))
  }

  async function save() {
    setSaving(true)
    setError(null)
    try {
      await patchAPI(`/api/scenes/${scene.id}`, {
        prompt,
        video_prompt: videoPrompt,
        character_names: names,
      })
      onReload()
    } catch (e) {
      setError(errMsg(e))
    } finally {
      setSaving(false)
    }
  }

  async function remove() {
    if (!window.confirm(`Xóa cảnh #${index + 1}? Không thể hoàn tác.`)) return
    setDeleting(true)
    setError(null)
    try {
      await fetchAPI(`/api/scenes/${scene.id}`, { method: 'DELETE' })
      onReload()
    } catch (e) {
      setError(errMsg(e))
      setDeleting(false)
    }
  }

  const iStatus = imgStatus(scene, ori)
  const vStatus = vidStatus(scene, ori)
  const iUrl = imgUrl(scene, ori)
  const vUrl = vidUrl(scene, ori)

  return (
    <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
      {/* header */}
      <div className="flex items-center gap-2">
        <span className="text-xs font-bold px-2 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--accent)' }}>Cảnh #{index + 1}</span>
        <div className="flex items-center gap-3 ml-auto text-xs" style={{ color: 'var(--muted)' }}>
          <span className="flex items-center gap-1"><StatusDot status={iStatus} /> Ảnh: {STATUS_VN[iStatus]}</span>
          <span className="flex items-center gap-1"><StatusDot status={vStatus} /> Video: {STATUS_VN[vStatus]}</span>
        </div>
      </div>

      {/* previews */}
      {(iUrl || vUrl) && (
        <div className="flex flex-wrap gap-3">
          {iUrl && (
            <img
              src={iUrl}
              alt={`Ảnh cảnh ${index + 1}`}
              className="rounded object-cover"
              style={{ width: 120, height: ori === 'horizontal' ? 68 : 200, border: '1px solid var(--border)' }}
            />
          )}
          {vUrl && (
            <video
              src={vUrl}
              controls
              className="rounded"
              style={{ width: ori === 'horizontal' ? 240 : 120, border: '1px solid var(--border)' }}
            />
          )}
        </div>
      )}

      {/* editable fields */}
      <Field label="MÔ TẢ HÀNH ĐỘNG CẢNH" hint="Viết ngắn gọn HÀNH ĐỘNG đang diễn ra. ĐỪNG tả ngoại hình nhân vật — ảnh tham chiếu đã lo phần đó.">
        <textarea
          value={prompt}
          onChange={e => setPrompt(e.target.value)}
          rows={2}
          className="rounded px-2 py-1.5 text-xs outline-none resize-y"
          style={inputStyle}
          placeholder="VD: Nhân vật chạy qua khu rừng, ánh nắng xuyên qua tán cây"
        />
      </Field>

      <Field label="MÔ TẢ CHUYỂN ĐỘNG VIDEO 8s (tùy chọn)" hint="Diễn biến/chuyển động trong 8 giây của cảnh này.">
        <textarea
          value={videoPrompt}
          onChange={e => setVideoPrompt(e.target.value)}
          rows={2}
          className="rounded px-2 py-1.5 text-xs outline-none resize-y"
          style={inputStyle}
          placeholder="VD: Máy quay đi theo nhân vật, lá cây rung nhẹ trong gió"
        />
      </Field>

      {entityNames.length > 0 && (
        <Field label="NHÂN VẬT / ĐỒ VẬT XUẤT HIỆN TRONG CẢNH">
          <div className="flex flex-wrap gap-1.5">
            {entityNames.map(n => {
              const on = names.includes(n)
              return (
                <button
                  key={n}
                  type="button"
                  onClick={() => toggleName(n)}
                  className="text-xs px-2 py-0.5 rounded font-semibold transition-colors"
                  style={{
                    background: on ? 'var(--accent)' : 'var(--surface)',
                    color: on ? '#fff' : 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {n}
                </button>
              )
            })}
          </div>
        </Field>
      )}

      {error && <div className="text-xs" style={{ color: 'var(--red)' }}>{error}</div>}

      {/* actions */}
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={save}
          disabled={!dirty || saving}
          className="text-xs px-3 py-1.5 rounded font-semibold"
          style={{
            background: dirty && !saving ? 'var(--accent)' : 'var(--card)',
            color: dirty && !saving ? '#fff' : 'var(--muted)',
            border: '1px solid var(--border)',
            cursor: dirty && !saving ? 'pointer' : 'not-allowed',
          }}
        >
          {saving ? 'Đang lưu…' : 'Lưu cảnh'}
        </button>
        <button
          type="button"
          onClick={remove}
          disabled={deleting}
          className="text-xs px-3 py-1.5 rounded flex items-center gap-1"
          style={{ background: 'var(--card)', color: 'var(--red)', border: '1px solid var(--border)' }}
        >
          <Trash2 size={12} /> {deleting ? 'Đang xóa…' : 'Xóa cảnh'}
        </button>
      </div>
    </div>
  )
}

// ---- page ----

export default function StudioPage() {
  const { id } = useParams<{ id: string }>()
  const navigate = useNavigate()
  const { lastEvent } = useWebSocket()

  const [project, setProject] = useState<Project | null>(null)
  const [entities, setEntities] = useState<Character[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [currentVideoId, setCurrentVideoId] = useState<string>('')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(true)

  const [connected, setConnected] = useState<boolean | null>(null)
  const [keyPresent, setKeyPresent] = useState<boolean | null>(null)

  const [newVideoOri, setNewVideoOri] = useState<Orientation>('VERTICAL')
  const [creatingVideo, setCreatingVideo] = useState(false)
  const [addingScene, setAddingScene] = useState(false)
  const [actionError, setActionError] = useState<string | null>(null)

  const [charProg, setCharProg] = useState<BatchStatus | null>(null)
  const [imgProg, setImgProg] = useState<BatchStatus | null>(null)
  const [vidProg, setVidProg] = useState<BatchStatus | null>(null)
  const [videosDone, setVideosDone] = useState(false)

  const pollRef = useRef<Record<string, number>>({})
  const activePollsRef = useRef(0)

  const currentVideo = videos.find(v => v.id === currentVideoId) ?? null
  const ori = oriOf(currentVideo)

  // ---- data loading ----

  const loadEntities = useCallback(() => {
    if (!id) return
    fetchAPI<Character[]>(`/api/projects/${id}/characters`).then(setEntities).catch(console.error)
  }, [id])

  const loadVideos = useCallback(() => {
    if (!id) return Promise.resolve<Video[]>([])
    return fetchAPI<Video[]>(`/api/videos?project_id=${id}`)
      .then(vs => { setVideos(vs); return vs })
      .catch(err => { console.error(err); return [] as Video[] })
  }, [id])

  const loadScenes = useCallback((vid: string) => {
    if (!vid) { setScenes([]); return }
    fetchAPI<Scene[]>(`/api/scenes?video_id=${vid}`)
      .then(ss => setScenes([...ss].sort((a, b) => a.display_order - b.display_order)))
      .catch(console.error)
  }, [])

  const refreshFlowStatus = useCallback(() => {
    fetchAPI<{ connected: boolean; flow_key_present: boolean }>('/api/flow/status')
      .then(s => { setConnected(!!s.connected); setKeyPresent(!!s.flow_key_present) })
      .catch(() => { setConnected(false); setKeyPresent(false) })
  }, [])

  useEffect(() => {
    if (!id) return
    setLoading(true)
    Promise.all([
      fetchAPI<Project>(`/api/projects/${id}`),
      fetchAPI<Character[]>(`/api/projects/${id}/characters`),
      fetchAPI<Video[]>(`/api/videos?project_id=${id}`),
    ])
      .then(([proj, chars, vids]) => {
        setProject(proj)
        setEntities(chars)
        setVideos(vids)
        setCurrentVideoId(vids[0]?.id ?? '')
      })
      .catch(console.error)
      .finally(() => setLoading(false))
    refreshFlowStatus()
  }, [id, refreshFlowStatus])

  useEffect(() => {
    if (currentVideoId) loadScenes(currentVideoId)
  }, [currentVideoId, loadScenes])

  // WS: while something is generating, refresh scenes early on any event
  useEffect(() => {
    if (lastEvent && activePollsRef.current > 0 && currentVideoId) {
      loadScenes(currentVideoId)
    }
  }, [lastEvent, currentVideoId, loadScenes])

  // cleanup polls on unmount
  useEffect(() => {
    const polls = pollRef.current
    return () => { Object.values(polls).forEach(clearInterval) }
  }, [])

  // ---- polling helpers ----

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
    onDone: (b: BatchStatus) => void,
  ) {
    stopPoll(key)
    activePollsRef.current += 1
    const tick = async () => {
      try {
        const st = await fetchAPI<BatchStatus>(`/api/requests/batch-status?${query}`)
        setProg(st)
        if (st.done) {
          stopPoll(key)
          onDone(st)
        }
      } catch (e) {
        console.error(e)
      }
    }
    void tick()
    pollRef.current[key] = window.setInterval(tick, 3500)
  }

  // ---- flow gate ----

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

  // ---- actions ----

  async function createFirstVideo() {
    if (!project) return
    setCreatingVideo(true)
    setActionError(null)
    try {
      const v = await postAPI<Video>('/api/videos', {
        project_id: project.id,
        title: project.name,
        orientation: newVideoOri,
      })
      const vs = await loadVideos()
      setCurrentVideoId(v.id || vs[0]?.id || '')
    } catch (e) {
      setActionError(errMsg(e))
    } finally {
      setCreatingVideo(false)
    }
  }

  async function addScene() {
    if (!currentVideoId) return
    setAddingScene(true)
    setActionError(null)
    try {
      const maxOrder = scenes.reduce((m, s) => Math.max(m, s.display_order), -1)
      await postAPI<Scene>('/api/scenes', {
        video_id: currentVideoId,
        display_order: maxOrder + 1,
        prompt: '',
      })
      loadScenes(currentVideoId)
    } catch (e) {
      setActionError(errMsg(e))
    } finally {
      setAddingScene(false)
    }
  }

  const missingEntities = entities.filter(e => !e.media_id)

  async function genCharImages() {
    if (!project || missingEntities.length === 0) return
    setActionError(null)
    if (!(await ensureFlow())) return
    try {
      await postAPI('/api/requests/batch', {
        requests: missingEntities.map(e => ({
          type: 'GENERATE_CHARACTER_IMAGE',
          character_id: e.id,
          project_id: project.id,
        })),
      })
      startPoll(
        'char',
        `project_id=${project.id}&type=GENERATE_CHARACTER_IMAGE`,
        setCharProg,
        () => loadEntities(),
      )
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  const scenesWithPrompt = scenes.filter(s => (s.prompt ?? '').trim() !== '')
  const allImagesReady = scenes.length > 0 && scenes.every(s => imgStatus(s, ori) === 'COMPLETED')

  async function genAllImages() {
    if (!project || !currentVideoId || scenesWithPrompt.length === 0) return
    setActionError(null)
    setVideosDone(false)
    if (!(await ensureFlow())) return
    try {
      await postAPI('/api/requests/batch', {
        requests: scenesWithPrompt.map(s => ({
          type: 'GENERATE_IMAGE',
          scene_id: s.id,
          project_id: project.id,
          video_id: currentVideoId,
          orientation: ORIENT(ori),
        })),
      })
      startPoll(
        'img',
        `video_id=${currentVideoId}&type=GENERATE_IMAGE&orientation=${ORIENT(ori)}`,
        setImgProg,
        () => loadScenes(currentVideoId),
      )
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  async function genAllVideos() {
    if (!project || !currentVideoId || !allImagesReady) return
    setActionError(null)
    setVideosDone(false)
    if (!(await ensureFlow())) return
    try {
      await postAPI('/api/requests/batch', {
        requests: scenes.map(s => ({
          type: 'GENERATE_VIDEO',
          scene_id: s.id,
          project_id: project.id,
          video_id: currentVideoId,
          orientation: ORIENT(ori),
        })),
      })
      startPoll(
        'vid',
        `video_id=${currentVideoId}&type=GENERATE_VIDEO&orientation=${ORIENT(ori)}`,
        setVidProg,
        () => { loadScenes(currentVideoId); setVideosDone(true) },
      )
    } catch (e) {
      setActionError(errMsg(e))
    }
  }

  // ---- render ----

  if (loading || !project) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Đang tải Studio…</div>
  }

  const flowOk = connected === true && keyPresent === true
  const entityNames = entities.map(e => e.name)
  const charBusy = !!pollRef.current['char']
  const imgBusy = !!pollRef.current['img']
  const vidBusy = !!pollRef.current['vid']

  return (
    <div className="flex flex-col gap-4 max-w-4xl">
      {/* header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => navigate(`/projects/${project.id}`)}
          className="text-xs px-3 py-1.5 rounded flex items-center gap-1"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          <ArrowLeft size={13} /> Về project
        </button>
        <h1 className="font-bold text-sm" style={{ color: 'var(--text)' }}>Studio — {project.name}</h1>
        {currentVideo && (
          <span className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--muted)' }}>
            {ori === 'horizontal' ? 'Ngang 16:9' : 'Dọc 9:16'}
          </span>
        )}
      </div>

      <FlowBanner connected={connected} keyPresent={keyPresent} onRecheck={refreshFlowStatus} />

      {actionError && (
        <div className="rounded-lg p-3 text-xs" style={{ background: 'rgba(239,68,68,0.12)', border: '1px solid var(--red)', color: 'var(--red)' }}>
          {actionError}
        </div>
      )}

      {/* no video yet -> create first video */}
      {videos.length === 0 ? (
        <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
          <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Tạo tập video đầu tiên</div>
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            Chọn hướng khung hình cho tập phim này. <b>Dọc</b> = TikTok/Shorts (9:16). <b>Ngang</b> = YouTube (16:9).
            Sau khi tạo sẽ không đổi hướng được, nên chọn đúng ngay từ đầu.
          </div>
          <div className="flex gap-2">
            {(['VERTICAL', 'HORIZONTAL'] as Orientation[]).map(o => {
              const on = newVideoOri === o
              return (
                <button
                  key={o}
                  type="button"
                  onClick={() => setNewVideoOri(o)}
                  className="text-xs px-3 py-1.5 rounded font-semibold"
                  style={{
                    background: on ? 'var(--accent)' : 'var(--surface)',
                    color: on ? '#fff' : 'var(--muted)',
                    border: '1px solid var(--border)',
                  }}
                >
                  {o === 'VERTICAL' ? 'Dọc 9:16 (TikTok/Shorts)' : 'Ngang 16:9 (YouTube)'}
                </button>
              )
            })}
          </div>
          <div>
            <button
              type="button"
              onClick={createFirstVideo}
              disabled={creatingVideo}
              className="text-xs px-4 py-2 rounded font-semibold"
              style={{ background: 'var(--accent)', color: '#fff', border: '1px solid var(--border)', cursor: creatingVideo ? 'not-allowed' : 'pointer' }}
            >
              {creatingVideo ? 'Đang tạo…' : 'Tạo tập video đầu tiên'}
            </button>
          </div>
        </div>
      ) : (
        <>
          {/* video selector (only if multiple) */}
          {videos.length > 1 && (
            <Field label="TẬP VIDEO ĐANG LÀM">
              <select
                value={currentVideoId}
                onChange={e => setCurrentVideoId(e.target.value)}
                className="text-xs px-2 py-1.5 rounded outline-none w-72"
                style={inputStyle}
              >
                {videos.map(v => (
                  <option key={v.id} value={v.id}>
                    {v.title} · {v.orientation === 'HORIZONTAL' ? 'Ngang' : 'Dọc'}
                  </option>
                ))}
              </select>
            </Field>
          )}

          {/* ENTITIES */}
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="flex items-center gap-2">
              <Users size={15} style={{ color: 'var(--accent)' }} />
              <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Nhân vật / Đồ vật</div>
            </div>
            <div className="text-xs" style={{ color: 'var(--muted)' }}>
              Ảnh nhân vật là "bản gốc" để AI giữ đúng thiết kế ở mọi cảnh. Entity nào chưa có ảnh thì tạo trước khi dựng cảnh.
            </div>

            {entities.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>
                Project chưa có nhân vật/đồ vật nào. Bạn vẫn có thể dựng cảnh, nhưng nên thêm nhân vật ở trang Create để giữ thiết kế nhất quán.
              </div>
            ) : (
              <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))' }}>
                {entities.map(e => (
                  <div key={e.id} className="rounded-lg p-2 flex flex-col gap-2" style={{ background: 'var(--surface)', border: '1px solid var(--border)' }}>
                    <div
                      className="rounded overflow-hidden flex items-center justify-center"
                      style={{ width: '100%', aspectRatio: '1/1', background: 'var(--bg)', border: '1px solid var(--border)' }}
                    >
                      {e.reference_image_url ? (
                        <img src={e.reference_image_url} alt={e.name} className="w-full h-full object-cover" />
                      ) : (
                        <span className="text-xs" style={{ color: 'var(--muted)' }}>{e.entity_type}</span>
                      )}
                    </div>
                    <div className="font-bold text-xs truncate" style={{ color: 'var(--text)' }}>{e.name}</div>
                    {e.media_id ? (
                      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--green)' }}>✓ Đã có ảnh</span>
                    ) : (
                      <span className="text-xs flex items-center gap-1" style={{ color: 'var(--red)' }}>
                        <span className="inline-block w-2 h-2 rounded-full" style={{ background: 'var(--red)' }} /> Chưa có ảnh
                      </span>
                    )}
                  </div>
                ))}
              </div>
            )}

            {missingEntities.length > 0 && (
              <div className="flex flex-col gap-2">
                <button
                  type="button"
                  onClick={genCharImages}
                  disabled={charBusy || !flowOk}
                  className="text-xs px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 self-start"
                  style={{
                    background: charBusy || !flowOk ? 'var(--card)' : 'var(--accent)',
                    color: charBusy || !flowOk ? 'var(--muted)' : '#fff',
                    border: '1px solid var(--border)',
                    cursor: charBusy || !flowOk ? 'not-allowed' : 'pointer',
                  }}
                  title={!flowOk ? 'Cần extension kết nối + Flow key trước khi tạo ảnh' : undefined}
                >
                  <ImageIcon size={13} /> {charBusy ? 'Đang tạo ảnh nhân vật…' : `Tạo ảnh cho ${missingEntities.length} nhân vật chưa có`}
                </button>
                <ProgressBar label="Ảnh nhân vật" prog={charProg} />
              </div>
            )}
          </div>

          {/* SCENES */}
          <div className="rounded-lg p-4 flex flex-col gap-3" style={cardStyle}>
            <div className="flex items-center gap-2">
              <Film size={15} style={{ color: 'var(--accent)' }} />
              <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Các cảnh (Scenes)</div>
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{scenes.length} cảnh</span>
            </div>
            <div className="text-xs leading-relaxed" style={{ color: 'var(--muted)' }}>
              Mỗi <b>CẢNH</b> là một đoạn phim ngắn ~8 giây. Viết ngắn gọn <b>HÀNH ĐỘNG</b> đang diễn ra
              (VD: "Nhân vật chạy qua khu rừng, ánh nắng xuyên qua tán cây"). <b>ĐỪNG tả ngoại hình nhân vật</b> — ảnh đã lo phần đó.
            </div>

            {scenes.length === 0 ? (
              <div className="text-xs" style={{ color: 'var(--muted)' }}>Chưa có cảnh nào. Bấm "Thêm cảnh" để bắt đầu.</div>
            ) : (
              <div className="flex flex-col gap-3">
                {scenes.map((s, i) => (
                  <SceneCard
                    key={s.id}
                    scene={s}
                    index={i}
                    entityNames={entityNames}
                    ori={ori}
                    onReload={() => loadScenes(currentVideoId)}
                  />
                ))}
              </div>
            )}

            <button
              type="button"
              onClick={addScene}
              disabled={addingScene}
              className="text-xs px-3 py-1.5 rounded font-semibold flex items-center gap-1.5 self-start"
              style={{ background: 'var(--surface)', color: 'var(--accent)', border: '1px solid var(--border)', cursor: addingScene ? 'not-allowed' : 'pointer' }}
            >
              <Plus size={13} /> {addingScene ? 'Đang thêm…' : 'Thêm cảnh'}
            </button>
          </div>

          {/* ACTION BAR (pipeline) */}
          <div className="rounded-lg p-4 flex flex-col gap-4 sticky bottom-0" style={{ ...cardStyle, boxShadow: '0 -4px 12px rgba(0,0,0,0.15)' }}>
            <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>Tạo hàng loạt</div>

            {/* step 1: images */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={genAllImages}
                  disabled={imgBusy || scenesWithPrompt.length === 0 || !flowOk}
                  className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5"
                  style={{
                    background: imgBusy || scenesWithPrompt.length === 0 || !flowOk ? 'var(--card)' : 'var(--accent)',
                    color: imgBusy || scenesWithPrompt.length === 0 || !flowOk ? 'var(--muted)' : '#fff',
                    border: '1px solid var(--border)',
                    cursor: imgBusy || scenesWithPrompt.length === 0 || !flowOk ? 'not-allowed' : 'pointer',
                  }}
                >
                  <ImageIcon size={13} /> {imgBusy ? 'Đang tạo ảnh…' : `Tạo ảnh tất cả cảnh (${scenesWithPrompt.length})`}
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {scenesWithPrompt.length === 0
                    ? 'Cần ít nhất 1 cảnh có mô tả hành động.'
                    : !flowOk
                      ? 'Cần extension kết nối + Flow key.'
                      : 'Bước 1: tạo ảnh nền cho từng cảnh.'}
                </span>
              </div>
              <ProgressBar label="Ảnh cảnh" prog={imgProg} />
            </div>

            {/* step 2: videos */}
            <div className="flex flex-col gap-2">
              <div className="flex items-center gap-3 flex-wrap">
                <button
                  type="button"
                  onClick={genAllVideos}
                  disabled={vidBusy || !allImagesReady || !flowOk}
                  className="text-xs px-4 py-2 rounded font-semibold flex items-center gap-1.5"
                  style={{
                    background: vidBusy || !allImagesReady || !flowOk ? 'var(--card)' : 'var(--accent)',
                    color: vidBusy || !allImagesReady || !flowOk ? 'var(--muted)' : '#fff',
                    border: '1px solid var(--border)',
                    cursor: vidBusy || !allImagesReady || !flowOk ? 'not-allowed' : 'pointer',
                  }}
                >
                  <Film size={13} /> {vidBusy ? 'Đang tạo video…' : `Tạo video tất cả cảnh (${scenes.length})`}
                </button>
                <span className="text-xs" style={{ color: 'var(--muted)' }}>
                  {!allImagesReady
                    ? 'Chỉ bật khi TẤT CẢ cảnh đã có ảnh (COMPLETED).'
                    : !flowOk
                      ? 'Cần extension kết nối + Flow key.'
                      : 'Bước 2: mỗi cảnh mất 2–5 phút, hãy để cửa sổ mở.'}
                </span>
              </div>
              <ProgressBar label="Video cảnh" prog={vidProg} />
            </div>

            {videosDone && (
              <div className="rounded-lg p-3 text-xs flex items-start gap-2" style={{ background: 'rgba(34,197,94,0.12)', border: '1px solid var(--green)', color: 'var(--green)' }}>
                <RefreshCw size={13} className="mt-0.5 shrink-0" />
                <span>
                  Đã tạo xong video từng cảnh. Bước ghép thành 1 video hoàn chỉnh (kèm 4K + lồng tiếng)
                  sẽ có ở bản cập nhật sau (cần ffmpeg). Bạn có thể xem trước từng cảnh ở danh sách phía trên.
                </span>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  )
}
