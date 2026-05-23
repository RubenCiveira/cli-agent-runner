import type { RuntimeAgentDef, DetectedAgent, ModelOption } from './types.ts'
import { listAgentDefs } from './registry.ts'

async function which(bin: string): Promise<string | null> {
  const proc = Bun.spawn(['which', bin], { stdout: 'pipe', stderr: 'pipe' })
  const text = await new Response(proc.stdout).text()
  await proc.exited
  const path = text.trim()
  return path.length > 0 ? path : null
}

async function resolveAgentPath(def: RuntimeAgentDef): Promise<string | null> {
  const bins = [def.bin, ...(def.fallbackBins ?? [])]
  for (const bin of bins) {
    const path = await which(bin)
    if (path) return path
  }
  return null
}

async function probeVersion(
  binPath: string,
  args: string[],
  timeoutMs: number,
): Promise<string | null> {
  try {
    const proc = Bun.spawn([binPath, ...args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(), timeoutMs)
    const [text, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    clearTimeout(timer)
    if (code !== 0) return null
    return text.trim().split('\n')[0] ?? null
  } catch {
    return null
  }
}

async function fetchModels(
  binPath: string,
  def: RuntimeAgentDef,
): Promise<{ models: ModelOption[]; source: 'live' | 'fallback' }> {
  if (!def.listModels) return { models: def.fallbackModels, source: 'fallback' }

  try {
    const proc = Bun.spawn([binPath, ...def.listModels.args], {
      stdout: 'pipe',
      stderr: 'pipe',
    })
    const timer = setTimeout(() => proc.kill(), def.listModels.timeoutMs)
    const [text, code] = await Promise.all([
      new Response(proc.stdout).text(),
      proc.exited,
    ])
    clearTimeout(timer)
    if (code !== 0) return { models: def.fallbackModels, source: 'fallback' }

    const models = def.listModels.parse(text)
    return models.length > 0
      ? { models, source: 'live' }
      : { models: def.fallbackModels, source: 'fallback' }
  } catch {
    return { models: def.fallbackModels, source: 'fallback' }
  }
}

async function probeOne(def: RuntimeAgentDef): Promise<DetectedAgent> {
  const path = await resolveAgentPath(def)
  if (!path) {
    return {
      id: def.id,
      name: def.name,
      available: false,
      path: null,
      version: null,
      models: def.fallbackModels,
      modelsSource: 'fallback',
    }
  }

  const version = await probeVersion(
    path,
    def.versionArgs,
    def.versionProbeTimeoutMs ?? 5000,
  )
  if (!version) {
    return {
      id: def.id,
      name: def.name,
      available: false,
      path,
      version: null,
      models: def.fallbackModels,
      modelsSource: 'fallback',
    }
  }

  const { models, source } = await fetchModels(path, def)
  return {
    id: def.id,
    name: def.name,
    available: true,
    path,
    version,
    models,
    modelsSource: source,
  }
}

export async function detectAgents(): Promise<DetectedAgent[]> {
  const defs = listAgentDefs()
  return Promise.all(defs.map((def) => probeOne(def).catch(() => ({
    id: def.id,
    name: def.name,
    available: false,
    path: null,
    version: null,
    models: def.fallbackModels,
    modelsSource: 'fallback' as const,
  }))))
}

export async function detectAgent(id: string): Promise<DetectedAgent | null> {
  const { getAgentDef } = await import('./registry.ts')
  const def = getAgentDef(id)
  if (!def) return null
  return probeOne(def)
}
