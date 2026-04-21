import { test } from 'node:test'
import assert from 'node:assert/strict'
import { vote, DEFAULT_THRESHOLD_C } from '../shared/voting.ts'
import type { SensorReading } from '../shared/types.ts'

const mk = (s1: number, s2: number, s3: number): SensorReading => ({
  train_id: 'TR-TEST',
  reading_id: 'r-test',
  ts: '2026-04-21T00:00:00.000Z',
  sensors: { s1, s2, s3 },
})

test('OK when all three sensors agree within threshold', () => {
  const r = vote(mk(20.0, 20.5, 21.0))
  assert.equal(r.status, 'OK')
  assert.equal(r.outlier, undefined)
  assert.equal(r.spread, 1.0)
})

test('OK at the exact boundary (spread === THRESHOLD)', () => {
  const r = vote(mk(20.0, 22.0, 21.0))
  assert.equal(r.status, 'OK')
  assert.equal(r.spread, 2.0)
})

test('WARN identifies s1 as outlier', () => {
  const r = vote(mk(35.0, 20.0, 20.5))
  assert.equal(r.status, 'WARN')
  assert.equal(r.outlier, 's1')
})

test('WARN identifies s2 as outlier', () => {
  const r = vote(mk(20.0, 35.0, 20.5))
  assert.equal(r.status, 'WARN')
  assert.equal(r.outlier, 's2')
})

test('WARN identifies s3 as outlier', () => {
  const r = vote(mk(20.0, 20.5, 35.0))
  assert.equal(r.status, 'WARN')
  assert.equal(r.outlier, 's3')
})

test('CRITICAL when all three disagree', () => {
  const r = vote(mk(20.0, 30.0, 50.0))
  assert.equal(r.status, 'CRITICAL')
  assert.equal(r.outlier, undefined)
})

test('CRITICAL on gradual drift (no unique outlier)', () => {
  // [20, 22, 24] at threshold=2:
  //   |s1-s2|=2 OK, |s2-s3|=2 OK, |s1-s3|=4 FAIL.
  // No sensor is far from BOTH others, so majority cannot be determined.
  const r = vote(mk(20.0, 22.0, 24.0))
  assert.equal(r.status, 'CRITICAL')
  assert.equal(r.spread, 4.0)
})

test('threshold override', () => {
  const r = vote(mk(10, 15, 20), 10)
  assert.equal(r.status, 'OK')
})

test('uses DEFAULT_THRESHOLD_C when not overridden', () => {
  assert.equal(DEFAULT_THRESHOLD_C, 2.0)
})
