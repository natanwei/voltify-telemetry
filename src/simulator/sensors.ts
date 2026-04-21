import { ulid } from 'ulid'
import type { SensorReading } from '../shared/types.js'

export type AnomalyMode = 'none' | 'warn' | 'critical'

const round1 = (n: number) => Math.round(n * 10) / 10

// Sine-wave baseline around 25°C, period 60s, plus ±0.25°C noise per sensor.
// The anomaly modes match what the voting function classifies: see voting.test.ts.
export function makeSensors(
  t: number,
  mode: AnomalyMode = 'none',
): { s1: number; s2: number; s3: number } {
  const base = 25 + 3 * Math.sin((2 * Math.PI * t) / 60)
  const noise = () => (Math.random() - 0.5) * 0.5

  if (mode === 'warn') {
    return { s1: round1(base + noise()), s2: round1(base + noise()), s3: round1(base + 15 + noise()) }
  }
  if (mode === 'critical') {
    return { s1: round1(base + noise()), s2: round1(base + 12 + noise()), s3: round1(base + 24 + noise()) }
  }
  return { s1: round1(base + noise()), s2: round1(base + noise()), s3: round1(base + noise()) }
}

export function makeReading(trainId: string, t: number, mode: AnomalyMode): SensorReading {
  return {
    train_id: trainId,
    reading_id: ulid(),
    ts: new Date().toISOString(),
    sensors: makeSensors(t, mode),
  }
}
