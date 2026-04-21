import { NextResponse } from 'next/server'
import { queryFleet } from '../../lib/queries.js'

export const dynamic = 'force-dynamic'

const SIM_URL = process.env.SIM_CONTROL_URL ?? 'http://localhost:5050'

async function fetchSimModes(): Promise<Record<string, string>> {
  try {
    const res = await fetch(`${SIM_URL}/trains`, {
      signal: AbortSignal.timeout(500),
    })
    if (!res.ok) return {}
    return (await res.json()) as Record<string, string>
  } catch {
    return {} // simulator unreachable — dashboard just won't know mode state
  }
}

export async function GET() {
  try {
    const [items, modes] = await Promise.all([queryFleet(), fetchSimModes()])
    return NextResponse.json({
      trains: items,
      modes,
      server_ts: new Date().toISOString(),
    })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, trains: [], modes: {}, server_ts: new Date().toISOString() },
      { status: 500 },
    )
  }
}
