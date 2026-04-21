import type { SensorReading, VotingResult } from './types.js'

export const DEFAULT_THRESHOLD_C = 2.0

// Triple modular redundancy vote. See src/test/voting.test.ts for the full
// behavior spec (OK / WARN-with-outlier / CRITICAL for drift or 3-way disagreement).
export function vote(r: SensorReading, THRESHOLD = DEFAULT_THRESHOLD_C): VotingResult {
  const s = [r.sensors.s1, r.sensors.s2, r.sensors.s3]
  const spread = Math.max(...s) - Math.min(...s)

  if (spread <= THRESHOLD) return { status: 'OK', spread }

  for (let i = 0; i < 3; i++) {
    const a = s[(i + 1) % 3]
    const b = s[(i + 2) % 3]
    if (
      Math.abs(s[i] - a) > THRESHOLD &&
      Math.abs(s[i] - b) > THRESHOLD &&
      Math.abs(a - b) <= THRESHOLD
    ) {
      return { status: 'WARN', spread, outlier: (`s${i + 1}`) as 's1' | 's2' | 's3' }
    }
  }

  return { status: 'CRITICAL', spread }
}
