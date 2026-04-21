'use client'

import { useCallback, useEffect, useState } from 'react'
import type { Alert } from '../../shared/types.js'

type AlertsResponse = { alerts: Alert[]; server_ts: string; error?: string }

function fmtTs(iso: string) {
  const d = new Date(iso)
  return d.toLocaleTimeString(undefined, { hour12: false })
}

const EMAIL_KEY = 'voltify.alertEmail'

export default function AlertsView() {
  const [data, setData] = useState<AlertsResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [sending, setSending] = useState<string | null>(null) // reading_id currently posting

  useEffect(() => {
    let cancelled = false
    const tick = async () => {
      try {
        const res = await fetch('/api/alerts', { cache: 'no-store' })
        const json = (await res.json()) as AlertsResponse
        if (!cancelled) {
          setData(json)
          setError(json.error ?? null)
        }
      } catch (err) {
        if (!cancelled) setError((err as Error).message)
      }
    }
    tick()
    const iv = setInterval(tick, 2000)
    return () => {
      cancelled = true
      clearInterval(iv)
    }
  }, [])

  const sendOne = useCallback(async (a: Alert) => {
    const remembered = typeof window !== 'undefined' ? localStorage.getItem(EMAIL_KEY) : null
    const prefill = remembered ?? ''
    const email = window.prompt(
      `Send this ${a.severity} alert for ${a.train_id} to which email?`,
      prefill,
    )
    if (!email) return // cancelled
    if (typeof window !== 'undefined') localStorage.setItem(EMAIL_KEY, email)

    setSending(a.reading_id)
    try {
      const res = await fetch('/api/alerts/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ts: a.ts,
          train_id: a.train_id,
          reading_id: a.reading_id,
          email,
        }),
      })
      const body = await res.json().catch(() => ({}))
      if (!res.ok) {
        alert(`Send failed: ${body.error ?? res.statusText}`)
      } else if (body.sent) {
        const tag = body.stubbed ? '(stubbed — RESEND_API_KEY not set)' : `id=${body.provider_id}`
        // Cheap success toast
        alert(`Sent to ${email}. ${tag}`)
        // Optimistic local update
        setData(prev =>
          prev
            ? {
                ...prev,
                alerts: prev.alerts.map(x =>
                  x.reading_id === a.reading_id
                    ? { ...x, email_status: 'sent', email_sent_at: body.sent_at }
                    : x,
                ),
              }
            : prev,
        )
      } else if (body.skipped) {
        alert(`Skipped: ${body.reason}`)
      }
    } catch (err) {
      alert(`Send failed: ${(err as Error).message}`)
    } finally {
      setSending(null)
    }
  }, [])

  if (!data && !error) return <p className="meta">loading…</p>

  const alerts = data?.alerts ?? []
  const pending = alerts.filter(a => a.email_status !== 'sent').length

  return (
    <>
      <div className="meta">
        <span className="live">live</span> · {alerts.length} recent alert
        {alerts.length === 1 ? '' : 's'}
        {pending > 0 ? <> · <strong>{pending}</strong> pending email{pending === 1 ? '' : 's'}</> : null}
        {error ? <span style={{ color: 'var(--red)', marginLeft: 12 }}>error: {error}</span> : null}
      </div>

      {alerts.length === 0 ? (
        <div className="empty">
          <p>No alerts — the fleet is looking healthy.</p>
        </div>
      ) : (
        <table className="table">
          <thead>
            <tr>
              <th>Time</th>
              <th>Train</th>
              <th>Severity</th>
              <th>Spread</th>
              <th>Sensors (s1 / s2 / s3 °C)</th>
              <th>Email</th>
              <th>Reading</th>
            </tr>
          </thead>
          <tbody>
            {alerts.map(a => {
              const busy = sending === a.reading_id
              const status = a.email_status ?? 'pending'
              return (
                <tr key={a.reading_id}>
                  <td>{fmtTs(a.ts)}</td>
                  <td><strong>{a.train_id}</strong></td>
                  <td>
                    <span className={`chip chip-${a.severity}`}>{a.severity}</span>
                  </td>
                  <td>{a.detail.spread.toFixed(2)}°C</td>
                  <td>
                    {a.sensors.s1.toFixed(1)} / {a.sensors.s2.toFixed(1)} / {a.sensors.s3.toFixed(1)}
                    {a.detail.outlier ? (
                      <span className="mono" style={{ marginLeft: 8 }}>
                        outlier: {a.detail.outlier}
                      </span>
                    ) : null}
                  </td>
                  <td>
                    <span className={`status-badge status-${status}`}>{status}</span>
                    {status !== 'sent' ? (
                      <button
                        type="button"
                        className="send-btn"
                        style={{ marginLeft: 8 }}
                        disabled={busy}
                        onClick={() => sendOne(a)}
                      >
                        {busy ? 'sending…' : 'send'}
                      </button>
                    ) : null}
                    {status === 'sent' && a.email_sent_at ? (
                      <span className="mono" style={{ marginLeft: 8 }}>
                        at {fmtTs(a.email_sent_at)}
                      </span>
                    ) : null}
                  </td>
                  <td className="mono">{a.reading_id}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
    </>
  )
}
