import { DynamoDBClient } from '@aws-sdk/client-dynamodb'
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb'
import type { Alert, LatestSnapshot, SensorReading, VotingResult } from './types.js'

export const TABLE = process.env.DDB_TABLE ?? 'voltify'

export function makeClient(opts?: { endpoint?: string; region?: string }) {
  const endpoint = opts?.endpoint ?? process.env.DDB_ENDPOINT ?? 'http://localhost:4567'
  const region = opts?.region ?? process.env.DDB_REGION ?? 'us-east-1'
  const base = new DynamoDBClient({
    endpoint,
    region,
    credentials: { accessKeyId: 'local', secretAccessKey: 'local' },
  })
  return DynamoDBDocumentClient.from(base, {
    marshallOptions: { removeUndefinedValues: true },
  })
}

export const keys = {
  telemetryPk: (trainId: string) => `TRAIN#${trainId}`,
  telemetrySk: (ts: string, readingId: string) => `TELEMETRY#${ts}#${readingId}`,
  fleetPk: () => 'FLEET',
  fleetSk: (trainId: string) => `TRAIN#${trainId}`,
  alertPk: () => 'ALERTS',
  alertSk: (ts: string, trainId: string, readingId: string) => `${ts}#${trainId}#${readingId}`,
}

export function telemetryItem(r: SensorReading, v: VotingResult) {
  return {
    pk: keys.telemetryPk(r.train_id),
    sk: keys.telemetrySk(r.ts, r.reading_id),
    train_id: r.train_id,
    reading_id: r.reading_id,
    ts: r.ts,
    sensors: r.sensors,
    voting: v,
  }
}

export function latestItem(r: SensorReading, v: VotingResult): LatestSnapshot & {
  pk: string
  sk: string
} {
  return {
    pk: keys.fleetPk(),
    sk: keys.fleetSk(r.train_id),
    train_id: r.train_id,
    last_ts: r.ts,
    last_reading_id: r.reading_id,
    sensors: r.sensors,
    voting: v,
  }
}

export function alertItem(r: SensorReading, v: VotingResult): Alert & {
  pk: string
  sk: string
} {
  if (v.status === 'OK') throw new Error('alertItem called for an OK reading')
  return {
    pk: keys.alertPk(),
    sk: keys.alertSk(r.ts, r.train_id, r.reading_id),
    ts: r.ts,
    train_id: r.train_id,
    severity: v.status,
    reading_id: r.reading_id,
    detail: v,
    sensors: r.sensors,
    email_status: 'pending',
  }
}
