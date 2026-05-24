// Shared utilities for CLI-based agent runtimes

export interface CliProcess {
  readonly exited: Promise<number>
  readonly stdout: ReadableStream<Uint8Array>
  readonly stderr: ReadableStream<Uint8Array>
  kill(): void
}

export interface SpawnOptions {
  cwd?: string
  env?: Record<string, string>
}

/**
 * Spawn a long-running CLI process with stdin piped.
 * Writes `stdinPayload` to stdin then closes it.
 */
export function spawnCli(
  bin: string,
  args: string[],
  stdinPayload: string,
  options: SpawnOptions = {},
): CliProcess {
  type P = ReturnType<typeof Bun.spawn<'pipe', 'pipe', 'pipe'>>
  const proc: P = Bun.spawn([bin, ...args], {
    cwd: options.cwd,
    env: (options.env ?? process.env) as Record<string, string>,
    stdin: 'pipe' as const,
    stdout: 'pipe' as const,
    stderr: 'pipe' as const,
  })
  proc.stdin.write(stdinPayload)
  proc.stdin.end()
  return {
    exited: proc.exited.then((code) => code ?? 0),
    stdout: proc.stdout,
    stderr: proc.stderr,
    kill: () => proc.kill(),
  }
}

export interface OneShotResult {
  exitCode: number
  stdout: string
  stderr: string
}

/**
 * Run a short-lived CLI command with no stdin (e.g. `--version`, `models`).
 * Returns null if the binary is not found or throws.
 */
export async function runOneShot(
  bin: string,
  args: string[],
  options: { cwd?: string; timeoutMs?: number } = {},
): Promise<OneShotResult | null> {
  try {
    const proc = Bun.spawn([bin, ...args], {
      cwd: options.cwd,
      stdin: 'ignore' as const,
      stdout: 'pipe' as const,
      stderr: 'pipe' as const,
    })
    if (options.timeoutMs) {
      setTimeout(() => proc.kill(), options.timeoutMs)
    }
    const [stdout, stderr, exitCode] = await Promise.all([
      new Response(proc.stdout).text(),
      new Response(proc.stderr).text(),
      proc.exited,
    ])
    return { exitCode: exitCode ?? 0, stdout, stderr }
  } catch {
    return null
  }
}

/** Async generator that yields trimmed non-empty lines from a ReadableStream. */
export async function* readLines(
  stream: ReadableStream<Uint8Array>,
): AsyncGenerator<string> {
  const reader = stream.getReader()
  const dec = new TextDecoder()
  let buf = ''
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      const lines = buf.split('\n')
      buf = lines.pop() ?? ''
      for (const line of lines) {
        const t = line.trim()
        if (t) yield t
      }
    }
    const t = buf.trim()
    if (t) yield t
  } finally {
    reader.releaseLock()
  }
}
