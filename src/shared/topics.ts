export const TOPIC_PREFIX = 'voltify/trains'

export const telemetryTopic = (trainId: string) => `${TOPIC_PREFIX}/${trainId}/telemetry`
export const telemetrySubscription = `${TOPIC_PREFIX}/+/telemetry`

export function parseTelemetryTopic(topic: string): string | null {
  const m = topic.match(/^voltify\/trains\/([^/]+)\/telemetry$/)
  return m ? m[1] : null
}
