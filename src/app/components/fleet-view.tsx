'use client'

import { useCallback, useEffect, useState } from 'react'
import type { LatestSnapshot, VotingStatus } from '../../shared/types.js'

type FleetResponse = {
  trains: LatestSnapshot[]
  modes: Record<string, string>
  server_ts: string
  error?: string
}

const STALE_AFTER_MS = 5000

// Maps a UI button label (capitalized status) to the simulator mode it injects.
const MODE_FOR_BUTTON: Record<'OK' | 'WARN' | 'CRITICAL', string> = {
  OK: 'none',
  WARN: 'warn',
  CRITICAL: 'critical',
}

function timeSince(iso: string, now: number): string {
  const delta = now - new Date(iso).getTime()
  if (delta < 1500) return 'just now'
  if (delta < 60_000) return `${Math.round(delta / 1000)}s ago`
  if (delta < 3_600_000) return `${Math.round(delta / 60_000)}m ago`
  return `${Math.round(delta / 3_600_000)}h ago`
}

function effectiveStatus(t: LatestSnapshot, now: number): VotingStatus | 'STALE' {
  const delta = now - new Date(t.last_ts).getTime()
  if (delta > STALE_AFTER_MS) return 'STALE'
  return t.voting.status
}

function modeLabel(mode: string | undefined): 'OK' | 'WARN' | 'CRITICAL' | null {
  if (mode === 'none') return 'OK'
  if (mode === 'warn') return 'WARN'
  if (mode === 'critical') return 'CRITICAL'
  return null // unknown mode: show no active button
}

export default function FleetView() {
  const [data, setData] = useState<FleetResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [now, setNow] = useState(Date.now())
  const [injecting, setInjecting] = useState<string | null>(null) // trainId currently posting

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/fleet', { cache: 'no-store' })
        const json = (await res.json()) as FleetResponse
        if (!cancelled) {
          setData(json)
          setError(json.error ?? null)
          setNow(Date.now())
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    tick()
    const iv = setInterval(tick, 2000)
    const clock = setInterval(() => setNow(Date.now()), 1000)
    return () => {
      cancelled = true
      clearInterval(iv)
      clearInterval(clock)
    }
  }, [])

  const inject = useCallback(
    async (trainId: string, button: 'OK' | 'WARN' | 'CRITICAL') => {
      setInjecting(trainId)
      try {
        const res = await fetch(`/api/trains/${encodeURIComponent(trainId)}/mode`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: MODE_FOR_BUTTON[button] }),
        })
        if (!res.ok) {
          const err = await res.json().catch(() => ({}))
          alert(`Failed to inject: ${err.error ?? res.statusText}`)
        } else {
          // Optimistic local update so the button lights up before the next poll
          setData(prev =>
            prev
              ? { ...prev, modes: { ...prev.modes, [trainId]: MODE_FOR_BUTTON[button] } }
              : prev,
          )
        }
      } catch (err) {
        alert(`Failed to inject: ${(err as Error).message}`)
      } finally {
        setInjecting(null)
      }
    },
    [],
  )

  if (!data && !error) return <p className="meta">loading…</p>

  const trains = data?.trains ?? []
  const modes = data?.modes ?? {}
  const counts = trains.reduce<Record<string, number>>(
    (acc, t) => {
      const s = effectiveStatus(t, now)
      acc[s] = (acc[s] ?? 0) + 1
      return acc
    },
    { OK: 0, WARN: 0, CRITICAL: 0, STALE: 0 },
  )

  return (
    <>
      <div className="meta">
        <span className="live">live</span>{' '}
        · {trains.length} train{trains.length === 1 ? '' : 's'}
        {' '}· OK {counts.OK} · WARN {counts.WARN} · CRITICAL {counts.CRITICAL}
        {counts.STALE ? ` · stale ${counts.STALE}` : ''}
        {error ? <span style={{ color: 'var(--red)', marginLeft: 12 }}>error: {error}</span> : null}
      </div>

      {trains.length === 0 ? (
        <div className="empty">
          <p>No telemetry yet — waiting for a train to report in.</p>
          <p className="mono">npm run dev:trains</p>
        </div>
      ) : (
        <div className="grid">
          {trains.map(t => {
            const status = effectiveStatus(t, now)
            const outlier = t.voting.outlier
            const activeMode = modeLabel(modes[t.train_id])
            const busy = injecting === t.train_id
            return (
              <div key={t.train_id} className={`card status-${status}`}>
                <div className="card-head">
                  <span className="train-id">{t.train_id}</span>
                  <span className={`chip chip-${status}`}>{status}</span>
                </div>
                <div className="sensors">
                  {(['s1', 's2', 's3'] as const).map(k => (
                    <div key={k} className={`sensor ${outlier === k ? 'outlier' : ''}`}>
                      <div className="sensor-label">{k.toUpperCase()}</div>
                      <div className="sensor-value">
                        {t.sensors[k].toFixed(1)}
                        <span className="sensor-unit">°C</span>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="card-foot">
                  <span>spread {t.voting.spread.toFixed(2)}°C</span>
                  <span>{timeSince(t.last_ts, now)}</span>
                </div>
                <div className="inject">
                  <span className="inject-label">inject</span>
                  {(['OK', 'WARN', 'CRITICAL'] as const).map(btn => (
                    <button
                      key={btn}
                      type="button"
                      disabled={busy}
                      className={activeMode === btn ? `active-${btn}` : ''}
                      onClick={() => inject(t.train_id, btn)}
                    >
                      {btn}
                    </button>
                  ))}
                </div>
              </div>
            )
          })}
        </div>
      )}
    </>
  )
}
