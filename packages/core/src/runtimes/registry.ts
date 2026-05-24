import type { RuntimeAgent } from './types.ts'
import { opencodeAgent } from './defs/opencode.ts'

const AGENTS: RuntimeAgent[] = [opencodeAgent]

export function registerAgent(agent: RuntimeAgent): void {
  if (AGENTS.some((a) => a.id === agent.id)) {
    throw new Error(`Duplicate agent id: ${agent.id}`)
  }
  AGENTS.push(agent)
}

export function getAgent(id: string): RuntimeAgent | null {
  return AGENTS.find((a) => a.id === id) ?? null
}

export function listAgents(): RuntimeAgent[] {
  return [...AGENTS]
}
