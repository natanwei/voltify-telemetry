import { Aedes } from 'aedes'
import net from 'node:net'

const PORT = Number(process.env.MQTT_PORT ?? 1883)

export async function startBroker(port = PORT) {
  const aedes = await Aedes.createBroker()
  const server = net.createServer(aedes.handle)

  aedes.on('client', c => console.log(`[broker] client connected: ${c.id}`))
  aedes.on('clientDisconnect', c => console.log(`[broker] client disconnected: ${c.id}`))
  aedes.on('publish', (packet, client) => {
    if (!client) return
    console.log(
      `[broker] publish ${packet.topic} qos=${packet.qos} from=${client.id} bytes=${packet.payload.length}`,
    )
  })

  await new Promise<void>((resolve, reject) => {
    server.on('error', reject)
    server.listen(port, () => {
      server.off('error', reject)
      resolve()
    })
  })
  console.log(`[broker] aedes listening on :${port}`)

  return {
    port,
    aedes,
    stop: () =>
      new Promise<void>(resolve => {
        server.close(() => aedes.close(() => resolve()))
      }),
  }
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const { stop } = await startBroker()
  const shutdown = async () => {
    console.log('[broker] shutting down')
    await stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
