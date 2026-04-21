import { NextResponse } from 'next/server'
import { queryRecentAlerts } from '../../lib/queries.js'

export const dynamic = 'force-dynamic'

export async function GET() {
  try {
    const alerts = await queryRecentAlerts(50)
    return NextResponse.json({ alerts, server_ts: new Date().toISOString() })
  } catch (err) {
    return NextResponse.json(
      { error: (err as Error).message, alerts: [], server_ts: new Date().toISOString() },
      { status: 500 },
    )
  }
}
