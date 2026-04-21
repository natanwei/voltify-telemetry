import type { SensorReading, VotingResult } from '../shared/types.js'

type ResendModule = typeof import('resend')
type ResendClient = InstanceType<ResendModule['Resend']>

let client: ResendClient | null = null

async function getClient(): Promise<ResendClient | null> {
  const apiKey = process.env.RESEND_API_KEY
  if (!apiKey) return null
  if (client) return client
  const { Resend } = await import('resend')
  client = new Resend(apiKey)
  return client
}

export async function sendAlert(
  r: Pick<SensorReading, 'train_id' | 'ts' | 'reading_id' | 'sensors'>,
  v: VotingResult,
  toOverride?: string,
): Promise<{ stubbed: boolean; id?: string }> {
  const subject = `[${v.status}] Voltify ${r.train_id} — pack temp anomaly`
  const body = [
    `Status: ${v.status}`,
    `Train: ${r.train_id}`,
    `Time: ${r.ts}`,
    `Reading: ${r.reading_id}`,
    `Spread: ${v.spread.toFixed(2)}°C`,
    `Sensors: s1=${r.sensors.s1}  s2=${r.sensors.s2}  s3=${r.sensors.s3}`,
    v.outlier ? `Likely outlier: ${v.outlier}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const to = toOverride ?? process.env.ALERT_TO
  const from = process.env.ALERT_FROM ?? 'Voltify <onboarding@resend.dev>'
  const c = await getClient()

  if (!c || !to) {
    console.log(`[resend/stub] would email to=${to ?? '(unset)'} subject=${JSON.stringify(subject)}`)
    return { stubbed: true }
  }

  const res = await c.emails.send({ from, to, subject, text: body })
  if (res.error) {
    throw new Error(`resend: ${res.error.message}`)
  }
  const id = res.data?.id
  console.log(`[resend] sent id=${id ?? '?'} to=${to}`)
  return { stubbed: false, id }
}
