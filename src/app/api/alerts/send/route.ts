import { NextResponse } from 'next/server'
import { GetCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb'
import { keys, makeClient, TABLE } from '../../../../shared/ddb.js'
import { sendAlert } from '../../../../worker/resend.js'
import type { Alert } from '../../../../shared/types.js'

export const dynamic = 'force-dynamic'

let _ddb: ReturnType<typeof makeClient> | null = null
function ddb() {
  if (!_ddb) _ddb = makeClient()
  return _ddb
}

export async function POST(req: Request) {
  let body: { ts?: string; train_id?: string; reading_id?: string; email?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid JSON body' }, { status: 400 })
  }
  const { ts, train_id, reading_id, email } = body
  if (!ts || !train_id || !reading_id) {
    return NextResponse.json(
      { error: 'body requires ts, train_id, reading_id' },
      { status: 400 },
    )
  }
  if (!email) {
    return NextResponse.json({ error: 'email is required' }, { status: 400 })
  }
  // Minimal shape check so typos don't silently turn into a Resend 422.
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    return NextResponse.json({ error: 'email looks malformed' }, { status: 400 })
  }

  const pk = keys.alertPk()
  const sk = keys.alertSk(ts, train_id, reading_id)

  // Fetch current alert
  const found = await ddb().send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))
  if (!found.Item) {
    return NextResponse.json({ error: 'alert not found' }, { status: 404 })
  }
  const alert = found.Item as unknown as Alert
  if (alert.email_status === 'sent') {
    return NextResponse.json({ skipped: true, reason: 'already sent', alert }, { status: 200 })
  }

  // Attempt the send
  try {
    const result = await sendAlert(alert, alert.detail, email)
    const now = new Date().toISOString()
    // Conditional update guards against double-send races
    await ddb().send(
      new UpdateCommand({
        TableName: TABLE,
        Key: { pk, sk },
        UpdateExpression:
          'SET email_status = :sent, email_sent_at = :now, email_provider_id = :pid',
        ConditionExpression: 'email_status <> :sent',
        ExpressionAttributeValues: {
          ':sent': 'sent',
          ':now': now,
          ':pid': result.id ?? (result.stubbed ? 'stub' : 'unknown'),
        },
      }),
    )
    return NextResponse.json({
      sent: true,
      stubbed: result.stubbed,
      provider_id: result.id ?? null,
      sent_at: now,
    })
  } catch (err) {
    const message = (err as Error).message
    try {
      await ddb().send(
        new UpdateCommand({
          TableName: TABLE,
          Key: { pk, sk },
          UpdateExpression: 'SET email_status = :failed, email_error = :err',
          ExpressionAttributeValues: {
            ':failed': 'failed',
            ':err': message,
          },
        }),
      )
    } catch {
      // ignore; original error is what matters
    }
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
