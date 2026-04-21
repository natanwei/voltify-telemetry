import mqtt, { type MqttClient } from 'mqtt'
import { GetCommand, PutCommand } from '@aws-sdk/lib-dynamodb'
import {
  alertItem,
  latestItem,
  makeClient,
  TABLE,
  telemetryItem,
} from '../shared/ddb.js'
import { vote } from '../shared/voting.js'
import { telemetrySubscription } from '../shared/topics.js'
import type { SensorReading } from '../shared/types.js'

async function waitForDb(
  ddb: ReturnType<typeof makeClient>,
  maxMs = 30000,
) {
  const start = Date.now()
  let lastError: unknown
  while (Date.now() - start < maxMs) {
    try {
      await ddb.send(
        new GetCommand({ TableName: TABLE, Key: { pk: '__health__', sk: '__health__' } }),
      )
      return
    } catch (err) {
      lastError = err
      await new Promise(r => setTimeout(r, 500))
    }
  }
  throw new Error(`DB not reachable within ${maxMs}ms: ${(lastError as Error)?.message}`)
}

export type WorkerOptions = {
  ddbEndpoint?: string
  mqttUrl?: string
  clientId?: string
}

export type WorkerHandle = {
  client: MqttClient
  ddb: ReturnType<typeof makeClient>
  ready: Promise<void>
  stop: () => Promise<void>
}

export async function startWorker(opts: WorkerOptions = {}): Promise<WorkerHandle> {
  const ddb = makeClient({ endpoint: opts.ddbEndpoint })
  const brokerUrl = opts.mqttUrl ?? process.env.MQTT_URL ?? 'mqtt://localhost:1883'
  const clientId = opts.clientId ?? 'voltify-worker'

  console.log(
    `[worker] waiting for db at ${opts.ddbEndpoint ?? process.env.DDB_ENDPOINT ?? 'http://localhost:4567'}`,
  )
  await waitForDb(ddb)
  console.log('[worker] db ready')

  const client = mqtt.connect(brokerUrl, {
    clientId,
    clean: false,
    reconnectPeriod: 1000,
    connectTimeout: 5000,
  })

  // Override the default handler so PUBACK fires only after DB writes succeed.
  // Default mqtt.js acks on dispatch, which would lose messages on DB failure.
  client.handleMessage = async (packet, cb) => {
    const payload = packet.payload as Buffer
    let reading: SensorReading
    try {
      reading = JSON.parse(payload.toString())
    } catch (err) {
      console.error(`[worker] malformed payload, dropping: ${(err as Error).message}`)
      cb()
      return
    }

    try {
      console.log(`[worker] recv r=${reading.reading_id} train=${reading.train_id}`)
      const result = vote(reading)

      await ddb.send(new PutCommand({ TableName: TABLE, Item: telemetryItem(reading, result) }))
      await ddb.send(new PutCommand({ TableName: TABLE, Item: latestItem(reading, result) }))

      if (result.status !== 'OK') {
        try {
          await ddb.send(
            new PutCommand({
              TableName: TABLE,
              Item: alertItem(reading, result),
              ConditionExpression: 'attribute_not_exists(pk)',
            }),
          )
          console.log(
            `[worker] alert queued r=${reading.reading_id} severity=${result.status} (email_status=pending)`,
          )
        } catch (e) {
          if ((e as { name?: string })?.name !== 'ConditionalCheckFailedException') throw e
          console.log(`[worker] duplicate alert suppressed r=${reading.reading_id}`)
        }
      }

      console.log(
        `[worker] wrote r=${reading.reading_id} status=${result.status} spread=${result.spread.toFixed(2)}`,
      )
      cb()
      console.log(`[worker] puback r=${reading.reading_id}`)
    } catch (err) {
      console.error(
        `[worker] handler failed r=${reading.reading_id}, dropping socket to force redelivery:`,
        (err as Error).message,
      )
      // Don't call cb(): broker redelivers on reconnect for clean=false clients.
      client.stream.end()
    }
  }

  let markReady: () => void
  let markReadyError: (err: Error) => void
  const ready = new Promise<void>((resolve, reject) => {
    markReady = resolve
    markReadyError = reject
  })
  let readyResolved = false

  client.on('connect', () => {
    console.log('[worker] mqtt connected')
    client.subscribe(telemetrySubscription, { qos: 1 }, (err, granted) => {
      if (err) {
        console.error('[worker] subscribe error', err.message)
        if (!readyResolved) markReadyError(err)
        return
      }
      console.log(`[worker] subscribed: ${granted?.map(g => g.topic).join(', ')}`)
      if (!readyResolved) {
        readyResolved = true
        markReady()
      }
    })
  })
  client.on('close', () => console.log('[worker] mqtt socket closed'))
  client.on('reconnect', () => console.log('[worker] mqtt reconnecting…'))
  client.on('error', err => console.error('[worker] mqtt error:', err.message))

  return {
    client,
    ddb,
    ready,
    stop: () =>
      new Promise(resolve => {
        client.end(false, {}, () => {
          ddb.destroy()
          resolve()
        })
      }),
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const worker = await startWorker()
  const shutdown = async () => {
    console.log('[worker] shutting down')
    await worker.stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
