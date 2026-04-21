import { test, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import { Outbox } from '../simulator/outbox.ts'
import type { SensorReading } from '../shared/types.ts'

let tmpDir: string
let file: string

beforeEach(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'outbox-test-'))
  file = path.join(tmpDir, 'outbox.jsonl')
})

afterEach(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true })
})

const mk = (id: string, s1 = 20): SensorReading => ({
  train_id: 'TR-TEST',
  reading_id: id,
  ts: new Date().toISOString(),
  sensors: { s1, s2: 20, s3: 20 },
})

test('enqueues readings and tracks pending set', () => {
  const o = new Outbox(file)
  o.enqueue(mk('a'))
  o.enqueue(mk('b'))
  o.enqueue(mk('c'))
  assert.equal(o.size(), 3)
  const ids = o.unsent().map(r => r.reading_id).sort()
  assert.deepEqual(ids, ['a', 'b', 'c'])
})

test('ack removes from pending but keeps file append-only', () => {
  const o = new Outbox(file)
  o.enqueue(mk('a'))
  o.enqueue(mk('b'))
  o.enqueue(mk('c'))
  o.ack('b')
  assert.equal(o.size(), 2)
  const ids = o.unsent().map(r => r.reading_id).sort()
  assert.deepEqual(ids, ['a', 'c'])
  // Check JSONL has exactly 4 lines: 3 enqueues + 1 ack
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 4)
})

test('hydrates from existing JSONL correctly', () => {
  const first = new Outbox(file)
  first.enqueue(mk('a'))
  first.enqueue(mk('b'))
  first.enqueue(mk('c'))
  first.ack('a')
  // Simulate restart by creating a fresh Outbox against the same file
  const second = new Outbox(file)
  assert.equal(second.size(), 2)
  const ids = second.unsent().map(r => r.reading_id).sort()
  assert.deepEqual(ids, ['b', 'c'])
})

test('double-enqueue of same id is a no-op', () => {
  const o = new Outbox(file)
  o.enqueue(mk('a'))
  o.enqueue(mk('a'))
  assert.equal(o.size(), 1)
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
})

test('acking an unknown id is a no-op (no file write)', () => {
  const o = new Outbox(file)
  o.enqueue(mk('a'))
  o.ack('unknown')
  assert.equal(o.size(), 1)
  const lines = fs.readFileSync(file, 'utf8').trim().split('\n')
  assert.equal(lines.length, 1)
})

test('survives malformed lines in the JSONL file', () => {
  fs.writeFileSync(file, 'not valid json\n{"op":"enqueue","id":"a","reading":' + JSON.stringify(mk('a')) + '}\n\n')
  const o = new Outbox(file)
  assert.equal(o.size(), 1)
  assert.equal(o.unsent()[0].reading_id, 'a')
})
