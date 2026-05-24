import type { DetectedAgent } from './types.ts'
import { listAgents, getAgent } from './registry.ts'

export async function detectAgents(): Promise<DetectedAgent[]> {
  const agents = listAgents()
  return Promise.all(agents.map((agent) => agent.detect().catch(() => ({
    id: agent.id,
    name: agent.name,
    available: false,
    path: null,
    version: null,
    models: [],
    modelsSource: 'fallback' as const,
  }))))
}

export async function detectAgent(id: string): Promise<DetectedAgent | null> {
  const agent = getAgent(id)
  if (!agent) return null
  return agent.detect()
}
