import { useState, useEffect } from 'react'
import { useNavigate } from 'react-router-dom'
import { Clapperboard } from 'lucide-react'
import { fetchAPI, patchAPI } from '../api/client'
import type { Project, Character, Video, Scene, ChainType, StatusType } from '../types'
import EditableText from '../components/projects/EditableText'

type Tab = 'Overview' | 'Characters' | 'Videos' | 'Scenes'

interface Props {
  projectId: string
  onBack: () => void
}

function formatDate(iso: string) {
  return new Date(iso).toLocaleString()
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
      title={status}
    />
  )
}

function Badge({ label, color }: { label: string; color?: string }) {
  return (
    <span
      className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold"
      style={{ background: color ?? 'rgba(100,116,139,0.2)', color: 'var(--muted)' }}
    >
      {label}
    </span>
  )
}

function ChainBadge({ type }: { type: ChainType }) {
  const styles: Record<ChainType, { bg: string; color: string }> = {
    ROOT: { bg: 'rgba(59,130,246,0.2)', color: 'var(--accent)' },
    CONTINUATION: { bg: 'rgba(34,197,94,0.2)', color: 'var(--green)' },
    INSERT: { bg: 'rgba(245,158,11,0.2)', color: 'var(--yellow)' },
  }
  const s = styles[type] ?? styles.ROOT
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-semibold" style={{ background: s.bg, color: s.color }}>
      {type}
    </span>
  )
}

// ---- Overview Tab ----
function OverviewTab({ project, onRefresh }: { project: Project; onRefresh: () => void }) {
  async function patchProject(field: string, value: string) {
    await patchAPI(`/api/projects/${project.id}`, { [field]: value })
    onRefresh()
  }

  return (
    <div className="flex flex-col gap-4 max-w-2xl">
      <div className="rounded-lg p-4 flex flex-col gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>NAME</div>
          <EditableText value={project.name} onSave={v => patchProject('name', v)} className="font-bold text-sm" />
        </div>
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>DESCRIPTION</div>
          <EditableText value={project.description ?? ''} onSave={v => patchProject('description', v)} multiline className="text-xs" />
        </div>
        <div>
          <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>STORY</div>
          <EditableText value={project.story ?? ''} onSave={v => patchProject('story', v)} multiline className="text-xs" />
        </div>
      </div>

      <div className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
        <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>META</div>
        <div className="flex flex-wrap gap-2 text-xs" style={{ color: 'var(--text)' }}>
          <Badge label={project.material} />
          {project.user_paygate_tier && (
            <Badge
              label={project.user_paygate_tier.includes('TWO') ? 'TIER 2' : 'TIER 1'}
              color={project.user_paygate_tier.includes('TWO') ? 'rgba(245,158,11,0.2)' : 'rgba(59,130,246,0.2)'}
            />
          )}
          <Badge label={project.status} />
        </div>
        <div className="flex flex-col gap-1 mt-2 text-xs" style={{ color: 'var(--muted)' }}>
          <div>Created: {formatDate(project.created_at)}</div>
          <div>Updated: {formatDate(project.updated_at)}</div>
        </div>
      </div>
    </div>
  )
}

// ---- Characters Tab ----
function CharactersTab({ characters, onRefresh }: { characters: Character[]; onRefresh: () => void }) {
  async function patchChar(cid: string, field: string, value: string) {
    await patchAPI(`/api/characters/${cid}`, { [field]: value })
    onRefresh()
  }

  if (characters.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>No entities linked to this project.</div>
  }

  return (
    <div className="grid gap-4" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))' }}>
      {characters.map(ch => (
        <div key={ch.id} className="rounded-lg p-3 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          {/* Reference image */}
          <div
            className="rounded overflow-hidden flex items-center justify-center"
            style={{ width: '100%', aspectRatio: '1/1', background: 'var(--surface)', border: '1px solid var(--border)' }}
          >
            {ch.reference_image_url ? (
              <img src={ch.reference_image_url} alt={ch.name} className="w-full h-full object-cover" />
            ) : (
              <span className="text-xs" style={{ color: 'var(--muted)' }}>{ch.entity_type}</span>
            )}
          </div>

          {/* Name */}
          <div className="font-bold text-xs" style={{ color: 'var(--text)' }}>{ch.name}</div>

          {/* Entity type badge */}
          <Badge label={ch.entity_type} />

          {/* Description */}
          <div className="text-xs" style={{ color: 'var(--muted)' }}>
            <EditableText
              value={ch.description ?? ''}
              onSave={v => patchChar(ch.id, 'description', v)}
              multiline
              className="text-xs"
            />
          </div>

          {/* media_id indicator */}
          <div className="flex items-center gap-1.5 text-xs">
            <span
              className="inline-block w-2 h-2 rounded-full"
              style={{ background: ch.media_id ? 'var(--green)' : 'var(--red)' }}
            />
            <span style={{ color: ch.media_id ? 'var(--green)' : 'var(--red)' }}>
              {ch.media_id ? 'Ready' : 'Missing'}
            </span>
          </div>
        </div>
      ))}
    </div>
  )
}

// ---- Videos Tab ----
function VideosTab({ videos }: { videos: Video[] }) {
  if (videos.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>No videos in this project.</div>
  }

  return (
    <div className="flex flex-col gap-3">
      {videos.map(v => (
        <div key={v.id} className="rounded-lg p-4 flex items-center gap-3" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
          <div className="flex flex-col gap-1 flex-1">
            <div className="font-bold text-sm" style={{ color: 'var(--text)' }}>{v.title}</div>
            {v.description && <div className="text-xs" style={{ color: 'var(--muted)' }}>{v.description}</div>}
          </div>
          <Badge label={v.status} />
          <div className="text-xs" style={{ color: 'var(--muted)' }}>Order {v.display_order}</div>
        </div>
      ))}
    </div>
  )
}

// ---- Scenes Tab ----
function ScenesTab({ videos }: { videos: Video[] }) {
  const [selectedVideoId, setSelectedVideoId] = useState(videos[0]?.id ?? '')
  const [scenes, setScenes] = useState<Scene[]>([])
  const [loading, setLoading] = useState(false)

  useEffect(() => {
    if (!selectedVideoId) return
    setLoading(true)
    fetchAPI<Scene[]>(`/api/scenes?video_id=${selectedVideoId}`)
      .then(setScenes)
      .catch(console.error)
      .finally(() => setLoading(false))
  }, [selectedVideoId])

  async function patchScene(sid: string, field: string, value: string) {
    await patchAPI(`/api/scenes/${sid}`, { [field]: value })
    // refresh
    setLoading(true)
    fetchAPI<Scene[]>(`/api/scenes?video_id=${selectedVideoId}`)
      .then(setScenes)
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  function parseCharNames(raw: string[] | string | null): string[] {
    if (!raw) return []
    if (Array.isArray(raw)) return raw
    try { const p = JSON.parse(raw); return Array.isArray(p) ? p : [] } catch { return [] }
  }

  if (videos.length === 0) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>No videos yet.</div>
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Video selector */}
      <select
        value={selectedVideoId}
        onChange={e => setSelectedVideoId(e.target.value)}
        className="text-xs px-2 py-1.5 rounded outline-none w-64"
        style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
      >
        {videos.map(v => (
          <option key={v.id} value={v.id}>{v.title}</option>
        ))}
      </select>

      {loading ? (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>Loading scenes...</div>
      ) : scenes.length === 0 ? (
        <div className="text-xs" style={{ color: 'var(--muted)' }}>No scenes in this video.</div>
      ) : (
        <div className="flex flex-col gap-3">
          {scenes.map(scene => {
            const charNames = parseCharNames(scene.character_names)
            return (
              <div key={scene.id} className="rounded-lg p-4 flex flex-col gap-2" style={{ background: 'var(--card)', border: '1px solid var(--border)' }}>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-bold" style={{ color: 'var(--muted)' }}>#{scene.display_order + 1}</span>
                  <ChainBadge type={scene.chain_type} />
                  {/* Status badges */}
                  <div className="flex items-center gap-2 ml-auto">
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <StatusDot status={scene.vertical_image_status} /> img
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <StatusDot status={scene.vertical_video_status} /> vid
                    </span>
                    <span className="flex items-center gap-1 text-xs" style={{ color: 'var(--muted)' }}>
                      <StatusDot status={scene.vertical_upscale_status} /> upscale
                    </span>
                  </div>
                </div>

                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>PROMPT</div>
                  <EditableText
                    value={scene.prompt ?? ''}
                    onSave={v => patchScene(scene.id, 'prompt', v)}
                    className="text-xs"
                  />
                </div>

                <div>
                  <div className="text-xs font-bold mb-1" style={{ color: 'var(--muted)' }}>VIDEO PROMPT</div>
                  <EditableText
                    value={scene.video_prompt ?? ''}
                    onSave={v => patchScene(scene.id, 'video_prompt', v)}
                    multiline
                    className="text-xs"
                  />
                </div>

                {charNames.length > 0 && (
                  <div className="flex flex-wrap gap-1">
                    {charNames.map(name => (
                      <span key={name} className="text-xs px-2 py-0.5 rounded" style={{ background: 'var(--surface)', color: 'var(--accent)' }}>
                        {name}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      )}
    </div>
  )
}

// ---- Main ProjectDetailPage ----
export default function ProjectDetailPage({ projectId, onBack }: Props) {
  const navigate = useNavigate()
  const [project, setProject] = useState<Project | null>(null)
  const [characters, setCharacters] = useState<Character[]>([])
  const [videos, setVideos] = useState<Video[]>([])
  const [tab, setTab] = useState<Tab>('Overview')
  const [loading, setLoading] = useState(true)

  function fetchAll() {
    setLoading(true)
    Promise.all([
      fetchAPI<Project>(`/api/projects/${projectId}`),
      fetchAPI<Character[]>(`/api/projects/${projectId}/characters`),
      fetchAPI<Video[]>(`/api/videos?project_id=${projectId}`),
    ])
      .then(([proj, chars, vids]) => {
        setProject(proj)
        setCharacters(chars)
        setVideos(vids)
      })
      .catch(console.error)
      .finally(() => setLoading(false))
  }

  useEffect(() => { fetchAll() }, [projectId])

  if (loading || !project) {
    return <div className="text-xs" style={{ color: 'var(--muted)' }}>Loading project...</div>
  }

  const tabs: Tab[] = ['Overview', 'Characters', 'Videos', 'Scenes']

  return (
    <div className="flex flex-col gap-4">
      {/* Back + title */}
      <div className="flex items-center gap-3">
        <button
          onClick={onBack}
          className="text-xs px-3 py-1.5 rounded"
          style={{ background: 'var(--card)', color: 'var(--muted)', border: '1px solid var(--border)' }}
        >
          Back
        </button>
        <h1 className="font-bold text-sm" style={{ color: 'var(--text)' }}>{project.name}</h1>
        <button
          onClick={() => navigate(`/projects/${project.id}/studio`)}
          className="ml-auto flex items-center gap-1.5 text-xs px-3 py-1.5 rounded font-semibold"
          style={{ background: 'var(--accent)', color: '#fff', border: '1px solid var(--border)' }}
          title="Mở màn dựng cảnh: viết cảnh, tạo ảnh và tạo video từng cảnh"
        >
          <Clapperboard size={13} /> Dựng cảnh (Studio)
        </button>
      </div>

      {/* Tabs */}
      <div className="flex gap-1" style={{ borderBottom: '1px solid var(--border)', paddingBottom: 4 }}>
        {tabs.map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className="px-3 py-1.5 rounded-t text-xs font-semibold transition-colors"
            style={{
              background: tab === t ? 'var(--card)' : 'transparent',
              color: tab === t ? 'var(--accent)' : 'var(--muted)',
              borderBottom: tab === t ? '2px solid var(--accent)' : '2px solid transparent',
            }}
          >
            {t}
            {t === 'Characters' && ` (${characters.length})`}
            {t === 'Videos' && ` (${videos.length})`}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div>
        {tab === 'Overview' && <OverviewTab project={project} onRefresh={fetchAll} />}
        {tab === 'Characters' && <CharactersTab characters={characters} onRefresh={fetchAll} />}
        {tab === 'Videos' && <VideosTab videos={videos} />}
        {tab === 'Scenes' && <ScenesTab videos={videos} />}
      </div>
    </div>
  )
}
