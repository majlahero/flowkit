// Shared Studio UI primitives (StatusDot / ProgressBar / FlowBanner).
// Extracted from StudioPage so the Wizard can reuse the SAME components.
// StudioPage imports these back in — behaviour and markup are identical.

import type { StatusType } from '../../types'

export const STATUS_VN: Record<StatusType, string> = {
  PENDING: 'Chưa làm',
  PROCESSING: 'Đang xử lý',
  COMPLETED: 'Xong',
  FAILED: 'Lỗi',
}

export function StatusDot({ status }: { status: StatusType }) {
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

// ---- batch status (mirrors GET /api/requests/batch-status) ----

export interface BatchStatus {
  total: number
  pending: number
  processing: number
  completed: number
  failed: number
  done: boolean
  all_succeeded: boolean
  orientation: string | null
}

export function ProgressBar({ label, prog }: { label: string; prog: BatchStatus | null }) {
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

export function FlowBanner({
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
