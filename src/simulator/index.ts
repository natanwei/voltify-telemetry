import mqtt, { type MqttClient } from 'mqtt'
import http from 'node:http'
import { Outbox } from './outbox.js'
import { makeReading, type AnomalyMode } from './sensors.js'
import { telemetryTopic } from '../shared/topics.js'
import type { SensorReading } from '../shared/types.js'

type Args = {
  trains: number
  tickMs: number
  flaky: boolean
  controlPort: number
  warn: Set<string>
  critical: Set<string>
}

function parseArgs(): Args {
  const argv = process.argv.slice(2)
  const out: Args = {
    trains: 3,
    tickMs: 1000,
    flaky: false,
    controlPort: Number(process.env.SIM_CONTROL_PORT ?? 5050),
    warn: new Set(),
    critical: new Set(),
  }
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]
    if (a === '--flaky') out.flaky = true
    else if (a === '--trains') out.trains = Number(argv[++i])
    else if (a.startsWith('--trains=')) out.trains = Number(a.slice('--trains='.length))
    else if (a === '--tick-ms') out.tickMs = Number(argv[++i])
    else if (a.startsWith('--tick-ms=')) out.tickMs = Number(a.slice('--tick-ms='.length))
    else if (a === '--control-port') out.controlPort = Number(argv[++i])
    else if (a.startsWith('--control-port=')) out.controlPort = Number(a.slice('--control-port='.length))
    else if (a.startsWith('--warn=')) out.warn.add(a.slice('--warn='.length))
    else if (a.startsWith('--critical=')) out.critical.add(a.slice('--critical='.length))
  }
  return out
}

function makeTrainIds(n: number): string[] {
  return Array.from({ length: n }, (_, i) => `TR-${String(i + 1).padStart(3, '0')}`)
}

function initialMode(trainId: string, args: Args): AnomalyMode {
  if (args.critical.has(trainId)) return 'critical'
  if (args.warn.has(trainId)) return 'warn'
  return 'none'
}

function publish(client: MqttClient, outbox: Outbox, trainId: string, r: SensorReading) {
  client.publish(telemetryTopic(trainId), JSON.stringify(r), { qos: 1 }, err => {
    if (err) {
      console.error(`[sim ${trainId}] publish error r=${r.reading_id}: ${err.message}`)
      return
    }
    outbox.ack(r.reading_id)
    console.log(`[sim ${trainId}] acked r=${r.reading_id} outbox=${outbox.size()}`)
  })
}

const VALID_MODES: ReadonlySet<AnomalyMode> = new Set(['none', 'warn', 'critical'])

async function main() {
  const args = parseArgs()
  const brokerUrl = process.env.MQTT_URL ?? 'mqtt://localhost:1883'
  const trainIds = makeTrainIds(args.trains)

  console.log(
    `[sim] starting ${trainIds.length} trains tick=${args.tickMs}ms flaky=${args.flaky} broker=${brokerUrl} control=:${args.controlPort}`,
  )

  // Mutable per-train mode state. CLI args set the initial values;
  // the control HTTP server (below) lets the dashboard change them live.
  const modes = new Map<string, AnomalyMode>()
  for (const id of trainIds) modes.set(id, initialMode(id, args))
  console.log(`[sim] initial modes: ${JSON.stringify(Object.fromEntries(modes))}`)

  const trains = trainIds.map(trainId => {
    const outbox = new Outbox(`./data/outbox-${trainId}.jsonl`)
    const client = mqtt.connect(brokerUrl, {
      clientId: `train-${trainId}`,
      clean: false,
      reconnectPeriod: 1000,
      connectTimeout: 5000,
    })

    client.on('connect', () => {
      const unsent = outbox.unsent()
      console.log(`[sim ${trainId}] connected; replaying ${unsent.length} unsent from outbox`)
      for (const r of unsent) publish(client, outbox, trainId, r)
    })
    client.on('close', () => console.log(`[sim ${trainId}] socket closed`))
    client.on('reconnect', () => console.log(`[sim ${trainId}] reconnecting…`))
    client.on('error', err => console.error(`[sim ${trainId}] error: ${err.message}`))

    let t = 0
    const tickHandle = setInterval(() => {
      t++
      const mode = modes.get(trainId) ?? 'none'
      const reading = makeReading(trainId, t, mode)
      outbox.enqueue(reading)
      console.log(
        `[sim ${trainId}] enqueued r=${reading.reading_id} mode=${mode} temps=[${reading.sensors.s1}, ${reading.sensors.s2}, ${reading.sensors.s3}] outbox=${outbox.size()}`,
      )
      publish(client, outbox, trainId, reading)
    }, args.tickMs)

    let flakyHandle: NodeJS.Timeout | null = null
    if (args.flaky) {
      const scheduleFlaky = () => {
        const delay = 15000 + Math.random() * 20000
        flakyHandle = setTimeout(() => {
          if (client.connected) {
            const offlineMs = 4000 + Math.random() * 6000
            console.log(`[sim ${trainId}] FLAKY: dropping connection for ~${(offlineMs / 1000).toFixed(1)}s`)
            const originalPeriod = client.options.reconnectPeriod
            client.options.reconnectPeriod = offlineMs
            client.stream.end()
            setTimeout(() => {
              client.options.reconnectPeriod = originalPeriod
            }, offlineMs + 1000)
          }
          scheduleFlaky()
        }, delay)
      }
      scheduleFlaky()
    }

    return { trainId, client, outbox, tickHandle, flakyHandle }
  })

  // Control server: lets the dashboard (and curl) change a train's mode live.
  const controlServer = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*')
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type')
    if (req.method === 'OPTIONS') {
      res.writeHead(204)
      res.end()
      return
    }

    const url = new URL(req.url ?? '/', `http://localhost:${args.controlPort}`)

    if (req.method === 'GET' && url.pathname === '/trains') {
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify(Object.fromEntries(modes)))
      return
    }

    const m = url.pathname.match(/^\/trains\/([^/]+)\/mode$/)
    if (req.method === 'POST' && m) {
      const trainId = decodeURIComponent(m[1])
      if (!modes.has(trainId)) {
        res.writeHead(404, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `unknown train: ${trainId}` }))
        return
      }
      let body = ''
      for await (const chunk of req) body += chunk
      let parsed: { mode?: string }
      try {
        parsed = body ? JSON.parse(body) : {}
      } catch {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: 'invalid JSON body' }))
        return
      }
      const mode = parsed.mode as AnomalyMode | undefined
      if (!mode || !VALID_MODES.has(mode)) {
        res.writeHead(400, { 'Content-Type': 'application/json' })
        res.end(JSON.stringify({ error: `mode must be one of: ${[...VALID_MODES].join(', ')}` }))
        return
      }
      modes.set(trainId, mode)
      console.log(`[sim] mode changed via control: ${trainId} -> ${mode}`)
      res.writeHead(200, { 'Content-Type': 'application/json' })
      res.end(JSON.stringify({ train_id: trainId, mode }))
      return
    }

    res.writeHead(404, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ error: 'not found' }))
  })

  controlServer.listen(args.controlPort, () => {
    console.log(`[sim] control server on :${args.controlPort} — POST /trains/:id/mode, GET /trains`)
  })

  const shutdown = () => {
    console.log('[sim] shutting down')
    controlServer.close()
    for (const { client, tickHandle, flakyHandle } of trains) {
      clearInterval(tickHandle)
      if (flakyHandle) clearTimeout(flakyHandle)
      client.end(false)
    }
    setTimeout(() => process.exit(0), 500)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}

main().catch(err => {
  console.error('[sim] fatal', err)
  process.exit(1)
})
