import { QueryCommand } from '@aws-sdk/lib-dynamodb'
import { keys, makeClient, TABLE } from '../../shared/ddb.js'
import type { Alert, LatestSnapshot } from '../../shared/types.js'

// One shared client across all server-side route handlers.
let _ddb: ReturnType<typeof makeClient> | null = null
function ddb() {
  if (!_ddb) _ddb = makeClient()
  return _ddb
}

export async function queryFleet(): Promise<LatestSnapshot[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': keys.fleetPk() },
    }),
  )
  const items = (res.Items ?? []) as unknown as LatestSnapshot[]
  items.sort((a, b) => a.train_id.localeCompare(b.train_id))
  return items
}

export async function queryRecentAlerts(limit = 50): Promise<Alert[]> {
  const res = await ddb().send(
    new QueryCommand({
      TableName: TABLE,
      KeyConditionExpression: 'pk = :pk',
      ExpressionAttributeValues: { ':pk': keys.alertPk() },
      ScanIndexForward: false,
      Limit: limit,
    }),
  )
  return (res.Items ?? []) as unknown as Alert[]
}
