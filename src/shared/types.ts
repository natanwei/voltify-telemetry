export type TrainId = string

export type SensorReading = {
  train_id: TrainId
  reading_id: string
  ts: string
  sensors: { s1: number; s2: number; s3: number }
}

export type VotingStatus = 'OK' | 'WARN' | 'CRITICAL'

export type VotingResult = {
  status: VotingStatus
  spread: number
  outlier?: 's1' | 's2' | 's3'
}

export type EmailStatus = 'pending' | 'sent' | 'failed'

export type Alert = {
  ts: string
  train_id: TrainId
  severity: 'WARN' | 'CRITICAL'
  reading_id: string
  detail: VotingResult
  sensors: SensorReading['sensors']
  email_status: EmailStatus
  email_sent_at?: string
  email_error?: string
  email_provider_id?: string
}

export type LatestSnapshot = {
  train_id: TrainId
  last_ts: string
  last_reading_id: string
  sensors: SensorReading['sensors']
  voting: VotingResult
}
