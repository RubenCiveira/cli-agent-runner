import type { RuntimeAgentDef } from './types.ts'
import { opencodeAgentDef } from './defs/opencode.ts'

const BASE_DEFS: RuntimeAgentDef[] = [opencodeAgentDef]

// Extend here: import and push your own RuntimeAgentDef
const AGENT_DEFS: RuntimeAgentDef[] = [...BASE_DEFS]

export function registerAgent(def: RuntimeAgentDef): void {
  if (AGENT_DEFS.some((d) => d.id === def.id)) {
    throw new Error(`Duplicate agent id: ${def.id}`)
  }
  AGENT_DEFS.push(def)
}

export function getAgentDef(id: string): RuntimeAgentDef | null {
  return AGENT_DEFS.find((d) => d.id === id) ?? null
}

export function listAgentDefs(): RuntimeAgentDef[] {
  return [...AGENT_DEFS]
}
