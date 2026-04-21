import dynalite from 'dynalite'
import { CreateTableCommand, DescribeTableCommand, ResourceInUseException } from '@aws-sdk/client-dynamodb'
import { makeClient, TABLE } from '../shared/ddb.js'

const PORT = Number(process.env.DDB_PORT ?? 4567)

export async function startDynalite(port = PORT) {
  const server = dynalite({ createTableMs: 0, deleteTableMs: 0 })
  await new Promise<void>((resolve, reject) => {
    server.listen(port, (err: unknown) => (err ? reject(err as Error) : resolve()))
  })
  console.log(`[db] dynalite listening on :${port}`)
  await bootstrapTable(port)
  return {
    port,
    stop: () =>
      new Promise<void>((resolve, reject) =>
        server.close((err: unknown) => (err ? reject(err as Error) : resolve())),
      ),
  }
}

export async function bootstrapTable(port = PORT) {
  const ddb = makeClient({ endpoint: `http://localhost:${port}` })
  try {
    await ddb.send(
      new CreateTableCommand({
        TableName: TABLE,
        AttributeDefinitions: [
          { AttributeName: 'pk', AttributeType: 'S' },
          { AttributeName: 'sk', AttributeType: 'S' },
        ],
        KeySchema: [
          { AttributeName: 'pk', KeyType: 'HASH' },
          { AttributeName: 'sk', KeyType: 'RANGE' },
        ],
        BillingMode: 'PAY_PER_REQUEST',
      }),
    )
    console.log(`[db] created table ${TABLE}`)
  } catch (e) {
    if (e instanceof ResourceInUseException || (e as { name?: string })?.name === 'ResourceInUseException') {
      console.log(`[db] table ${TABLE} already exists`)
    } else {
      throw e
    }
  }
  await ddb.send(new DescribeTableCommand({ TableName: TABLE }))
  ddb.destroy()
}

const isMain = import.meta.url === `file://${process.argv[1]}`
if (isMain) {
  const { stop } = await startDynalite()
  const shutdown = async () => {
    console.log('[db] shutting down')
    await stop()
    process.exit(0)
  }
  process.on('SIGINT', shutdown)
  process.on('SIGTERM', shutdown)
}
