import { NextResponse } from 'next/server'

export const dynamic = 'force-dynamic'

const SIM_URL = process.env.SIM_CONTROL_URL ?? 'http://localhost:5050'

const VALID_MODES = new Set(['none', 'warn', 'critical'])

export async function POST(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params
  let body: { mode?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  if (!body.mode || !VALID_MODES.has(body.mode)) {
    return NextResponse.json(
      { error: `mode must be one of: ${[...VALID_MODES].join(', ')}` },
      { status: 400 },
    )
  }

  try {
    const res = await fetch(`${SIM_URL}/trains/${encodeURIComponent(id)}/mode`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mode: body.mode }),
    })
    const data = await res.json().catch(() => ({}))
    return NextResponse.json(data, { status: res.status })
  } catch (err) {
    return NextResponse.json(
      { error: `simulator unreachable at ${SIM_URL}: ${(err as Error).message}` },
      { status: 502 },
    )
  }
}
