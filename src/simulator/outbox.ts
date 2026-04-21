import fs from 'node:fs'
import path from 'node:path'
import type { SensorReading } from '../shared/types.js'

type OutboxOp =
  | { op: 'enqueue'; id: string; reading: SensorReading }
  | { op: 'ack'; id: string }

// Append-only JSONL outbox. Write to disk first, then update the in-memory Map,
// so a crash at any point replays into the correct pending set on next boot.
// Behavior pinned by src/test/outbox.test.ts.
export class Outbox {
  private pending = new Map<string, SensorReading>()
  private writes = 0

  constructor(private file: string) {
    fs.mkdirSync(path.dirname(file), { recursive: true })
    this.hydrate()
  }

  private hydrate() {
    if (!fs.existsSync(this.file)) return
    const raw = fs.readFileSync(this.file, 'utf8')
    for (const line of raw.split('\n')) {
      if (!line) continue
      let op: OutboxOp
      try {
        op = JSON.parse(line)
      } catch {
        continue
      }
      if (op.op === 'enqueue') this.pending.set(op.id, op.reading)
      else if (op.op === 'ack') this.pending.delete(op.id)
    }
  }

  enqueue(reading: SensorReading) {
    if (this.pending.has(reading.reading_id)) return
    this.pending.set(reading.reading_id, reading)
    this.appendLine({ op: 'enqueue', id: reading.reading_id, reading })
  }

  ack(id: string) {
    if (!this.pending.has(id)) return
    this.pending.delete(id)
    this.appendLine({ op: 'ack', id })
  }

  private appendLine(op: OutboxOp) {
    fs.appendFileSync(this.file, JSON.stringify(op) + '\n')
    this.writes++
  }

  unsent(): SensorReading[] {
    return [...this.pending.values()]
  }

  size(): number {
    return this.pending.size
  }

  totalWrites(): number {
    return this.writes
  }
}
