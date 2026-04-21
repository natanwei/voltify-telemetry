import { test } from 'node:test'
import assert from 'node:assert/strict'
import net from 'node:net'
import mqtt from 'mqtt'
import { ulid } from 'ulid'
import { GetCommand, QueryCommand } from '@aws-sdk/lib-dynamodb'
import { startDynalite } from '../infra/db.ts'
import { startBroker } from '../infra/broker.ts'
import { startWorker } from '../worker/index.ts'
import { keys, makeClient, TABLE } from '../shared/ddb.ts'
import { telemetryTopic } from '../shared/topics.ts'
import type { SensorReading } from '../shared/types.ts'

function getFreePort(): Promise<number> {
  return new Promise(resolve => {
    const srv = net.createServer()
    srv.listen(0, () => {
      const port = (srv.address() as net.AddressInfo).port
      srv.close(() => resolve(port))
    })
  })
}

async function waitForItem(
  ddb: ReturnType<typeof makeClient>,
  pk: string,
  sk: string,
  timeoutMs = 5000,
): Promise<Record<string, unknown>> {
  const start = Date.now()
  while (Date.now() - start < timeoutMs) {
    const res = await ddb.send(new GetCommand({ TableName: TABLE, Key: { pk, sk } }))
    if (res.Item) return res.Item
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error(`item not found within ${timeoutMs}ms: pk=${pk} sk=${sk}`)
}

function makePublisher(mqttUrl: string) {
  return new Promise<mqtt.MqttClient>((resolve, reject) => {
    const c = mqtt.connect(mqttUrl, { clientId: `pub-${Date.now()}-${Math.random()}` })
    c.once('connect', () => resolve(c))
    c.once('error', reject)
  })
}

function publishReading(pub: mqtt.MqttClient, r: SensorReading) {
  return new Promise<void>((resolve, reject) => {
    pub.publish(telemetryTopic(r.train_id), JSON.stringify(r), { qos: 1 }, err => {
      err ? reject(err) : resolve()
    })
  })
}

test('end-to-end: OK reading flows through to telemetry + LATEST, no alert', async t => {
  const [dbPort, mqttPort] = await Promise.all([getFreePort(), getFreePort()])
  const db = await startDynalite(dbPort)
  const broker = await startBroker(mqttPort)
  const worker = await startWorker({
    ddbEndpoint: `http://localhost:${dbPort}`,
    mqttUrl: `mqtt://localhost:${mqttPort}`,
    clientId: `test-worker-${dbPort}`,
  })
  await worker.ready

  const reading: SensorReading = {
    train_id: 'TR-TEST-OK',
    reading_id: ulid(),
    ts: new Date().toISOString(),
    sensors: { s1: 25, s2: 25.3, s3: 25.1 },
  }

  const pub = await makePublisher(`mqtt://localhost:${mqttPort}`)
  await publishReading(pub, reading)

  const ddb = makeClient({ endpoint: `http://localhost:${dbPort}` })

  const telemetry = await waitForItem(
    ddb,
    keys.telemetryPk(reading.train_id),
    keys.telemetrySk(reading.ts, reading.reading_id),
  )
  assert.equal(telemetry.reading_id, reading.reading_id)
  assert.equal((telemetry.voting as { status: string }).status, 'OK')

  const latest = await waitForItem(ddb, keys.fleetPk(), keys.fleetSk(reading.train_id))
  assert.equal(latest.last_reading_id, reading.reading_id)

  // No alert rows for OK reading
  const alerts = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ALERTS' },
    }),
  )
  assert.equal(alerts.Items?.length ?? 0, 0)

  t.after(async () => {
    ddb.destroy()
    pub.end(true)
    await worker.stop()
    await broker.stop()
    await db.stop()
  })
})

test('end-to-end: CRITICAL reading writes alert with email_status=pending', async t => {
  const [dbPort, mqttPort] = await Promise.all([getFreePort(), getFreePort()])
  const db = await startDynalite(dbPort)
  const broker = await startBroker(mqttPort)
  const worker = await startWorker({
    ddbEndpoint: `http://localhost:${dbPort}`,
    mqttUrl: `mqtt://localhost:${mqttPort}`,
    clientId: `test-worker-crit-${dbPort}`,
  })
  await worker.ready

  const reading: SensorReading = {
    train_id: 'TR-TEST-CRIT',
    reading_id: ulid(),
    ts: new Date().toISOString(),
    sensors: { s1: 20, s2: 30, s3: 50 },
  }

  const pub = await makePublisher(`mqtt://localhost:${mqttPort}`)
  await publishReading(pub, reading)

  const ddb = makeClient({ endpoint: `http://localhost:${dbPort}` })

  const alert = await waitForItem(
    ddb,
    keys.alertPk(),
    keys.alertSk(reading.ts, reading.train_id, reading.reading_id),
  )
  assert.equal(alert.severity, 'CRITICAL')
  assert.equal(alert.train_id, reading.train_id)
  assert.equal(alert.email_status, 'pending')

  t.after(async () => {
    ddb.destroy()
    pub.end(true)
    await worker.stop()
    await broker.stop()
    await db.stop()
  })
})

test('end-to-end: duplicate CRITICAL reading is deduped by conditional put', async t => {
  const [dbPort, mqttPort] = await Promise.all([getFreePort(), getFreePort()])
  const db = await startDynalite(dbPort)
  const broker = await startBroker(mqttPort)
  const worker = await startWorker({
    ddbEndpoint: `http://localhost:${dbPort}`,
    mqttUrl: `mqtt://localhost:${mqttPort}`,
    clientId: `test-worker-dedup-${dbPort}`,
  })
  await worker.ready

  const reading: SensorReading = {
    train_id: 'TR-TEST-DEDUP',
    reading_id: ulid(),
    ts: new Date().toISOString(),
    sensors: { s1: 20, s2: 30, s3: 50 },
  }

  const pub = await makePublisher(`mqtt://localhost:${mqttPort}`)
  await publishReading(pub, reading)
  // Second publish with same reading_id simulates a redelivery
  await publishReading(pub, reading)

  const ddb = makeClient({ endpoint: `http://localhost:${dbPort}` })

  // Wait long enough for both messages to be processed
  await new Promise(r => setTimeout(r, 1500))

  const alerts = await ddb.send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': 'ALERTS' },
    }),
  )
  assert.equal(alerts.Items?.length, 1, 'should have exactly one alert after duplicate publish')

  t.after(async () => {
    ddb.destroy()
    pub.end(true)
    await worker.stop()
    await broker.stop()
    await db.stop()
  })
})
