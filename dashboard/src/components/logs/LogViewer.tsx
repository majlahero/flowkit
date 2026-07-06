import { useState, useEffect, useRef } from 'react'
import { useWebSocket } from '../../api/useWebSocket'
import type { WSEvent } from '../../types'

const MAX_LOGS = 500

function formatTime(iso: string) {
  const d = new Date(iso)
  if (isNaN(d.getTime())) return iso
  return d.toLocaleTimeString()
}

function eventColor(type: string): string {
  const t = type.toLowerCase()
  if (t.includes('error') || t.includes('fail')) return 'var(--red)'
  if (t.includes('complete') || t.includes('success') || t.includes('done')) return 'var(--green)'
  if (t.includes('processing') || t.includes('start') || t.includes('pending')) return 'var(--yellow)'
  return 'var(--muted)'
}

export default function LogViewer() {
  const { isConnected, lastEvent } = useWebSocket()
  const [logs, setLogs] = useState<WSEvent[]>([])
  const [paused, setPaused] = useState(false)
  const endRef = useRef<HTMLDivElement | null>(null)
  const seenRef = useRef<WSEvent | null>(null)

  // Accumulate each new WS event into the log list (skip duplicates of the same object)
  useEffect(() => {
    if (!lastEvent || paused) return
    if (seenRef.current === lastEvent) return
    seenRef.current = lastEvent
    setLogs(prev => {
      const next = [...prev, lastEvent]
      return next.length > MAX_LOGS ? next.slice(next.length - MAX_LOGS) : next
    })
  }, [lastEvent, paused])

  // Auto-scroll to newest
  useEffect(() => {
    if (!paused) endRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [logs, paused])

  return (
    <div className="flex flex-col gap-3 h-full">
      <div className="flex items-center gap-3">
        <span className="flex items-center gap-1.5 text-xs" style={{ color: 'var(--muted)' }}>
          <span
            className="inline-block w-2 h-2 rounded-full"
            style={{ background: isConnected ? 'var(--green)' : 'var(--red)' }}
          />
          {isConnected ? 'WS connected' : 'WS disconnected'}
        </span>
        <span className="text-xs ml-auto" style={{ color: 'var(--muted)' }}>
          {logs.length} events
        </span>
        <button
          onClick={() => setPaused(p => !p)}
          className="px-3 py-1 rounded text-xs font-semibold transition-colors"
          style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
        >
          {paused ? 'Resume' : 'Pause'}
        </button>
        <button
          onClick={() => setLogs([])}
          className="px-3 py-1 rounded text-xs font-semibold transition-colors"
          style={{ background: 'var(--card)', color: 'var(--text)', border: '1px solid var(--border)' }}
        >
          Clear
        </button>
      </div>

      <div
        className="flex-1 overflow-auto rounded-lg p-3 font-mono text-xs"
        style={{ background: 'var(--card)', border: '1px solid var(--border)' }}
      >
        {logs.length === 0 ? (
          <div style={{ color: 'var(--muted)' }}>Waiting for events...</div>
        ) : (
          logs.map((log, i) => (
            <div key={i} className="flex gap-2 py-0.5" style={{ borderBottom: '1px solid var(--border)' }}>
              <span style={{ color: 'var(--muted)' }}>{formatTime(log.timestamp)}</span>
              <span className="font-semibold" style={{ color: eventColor(log.type) }}>{log.type}</span>
              <span className="flex-1 break-all" style={{ color: 'var(--text)' }}>
                {log.data && Object.keys(log.data).length > 0 ? JSON.stringify(log.data) : ''}
              </span>
            </div>
          ))
        )}
        <div ref={endRef} />
      </div>
    </div>
  )
}
