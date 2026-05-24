// ── Shared types (mirrored from @runner/core for the browser bundle) ──────────

export interface Project {
  id: string; name: string; path: string
  created_at: number; updated_at: number; sessionCount?: number
}

export interface Session {
  id: string; project_id: string | null; name: string
  agent_id: string; skill_id: string | null; model: string | null
  external_session_id: string | null; created_at: number; updated_at: number
}

export interface Message {
  id: string; session_id: string; run_id: string | null; role: 'user' | 'assistant'
  content: string; created_at: number
}

/** Deserialized event payload — always a parsed object, never a JSON string. */
export interface EventData { type: string; [key: string]: unknown }

export interface RunEvent {
  id: number; run_id: string; type: string; data: EventData; created_at: number
}

export interface Exchange {
  runId: string
  runStatus: 'queued' | 'running' | 'completed' | 'failed' | 'cancelled'
  userMessage: Message | null
  assistantMessage: Message | null
  steps: RunEvent[]
}

export interface FileChange {
  id: number; run_id: string; session_id: string
  path: string; change_type: 'added' | 'modified' | 'deleted'
  diff: string | null
  /** 0 = inside project root (relative path); 1 = outside project root (absolute path) */
  external: number
  created_at: number
}

export interface Skill { id: string; name: string; description: string; tags: string[] }
export interface Agent { id: string; name: string; available: boolean; version: string | null; models: { id: string; label: string }[] }

// ── QuestionForm types (mirrored from @runner/core for the browser bundle) ────

export type QuestionType = 'text' | 'textarea' | 'radio' | 'checkbox'
export interface QuestionOption { label: string; value: string }
export interface FormQuestion {
  id: string; label: string; type: QuestionType
  options?: QuestionOption[]; maxSelections?: number
  placeholder?: string; required?: boolean
}
export interface QuestionForm { id?: string; title?: string; questions: FormQuestion[] }
export type FormAnswers = Record<string, string | string[]>

export function formatFormAnswers(form: QuestionForm, answers: FormAnswers): string {
  const header = form.id ? `[form answers — ${form.id}]` : '[form answers]'
  const lines = form.questions.map((q) => {
    const answer = answers[q.id]
    const text = Array.isArray(answer) ? answer.join(', ') : (answer ?? '(skipped)')
    return `- ${q.label}: ${text}`
  })
  return `${header}\n${lines.join('\n')}`
}

// ── AgentEvent types ──────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'text'; text: string }
  | { type: 'tool_use'; name: string }
  | { type: 'error'; message: string }
  | { type: 'done'; exitCode: number }
  | { type: 'raw'; data: string }
  | { type: 'tool_result' }
  | { type: 'question_form'; form: QuestionForm }

// ── SSE helpers ───────────────────────────────────────────────────────────────

async function* readSSE(resp: Response): AsyncGenerator<{ event: string; data: string }> {
  const reader = resp.body!.getReader()
  const dec = new TextDecoder()
  let buf = ''
  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    const parts = buf.split('\n\n')
    buf = parts.pop() ?? ''
    for (const part of parts) {
      const ev = part.match(/^event: (\S+)/m)?.[1] ?? 'message'
      const data = part.match(/^data: (.+)/m)?.[1]
      if (data) yield { event: ev, data }
    }
  }
}

// ── API client ────────────────────────────────────────────────────────────────

async function get<T>(url: string): Promise<T> {
  const r = await fetch(url)
  if (!r.ok) throw new Error(`GET ${url} → ${r.status}`)
  return r.json() as Promise<T>
}

async function post<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`POST ${url} → ${r.status}`)
  return r.json() as Promise<T>
}

async function patch<T>(url: string, body: unknown): Promise<T> {
  const r = await fetch(url, { method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) })
  if (!r.ok) throw new Error(`PATCH ${url} → ${r.status}`)
  return r.json() as Promise<T>
}

async function del(url: string): Promise<void> {
  const r = await fetch(url, { method: 'DELETE' })
  if (!r.ok) throw new Error(`DELETE ${url} → ${r.status}`)
}

// ── Projects ──────────────────────────────────────────────────────────────────

export const api = {
  projects: {
    list: () => get<Project[]>('/api/projects'),
    add: (p: { path: string; name?: string }) => post<Project>('/api/projects', p),
    remove: (id: string) => del(`/api/projects/${id}`),
    sessions: (id: string) => get<Session[]>(`/api/projects/${id}/sessions`),
    createSession: (id: string, body: { name?: string; agentId?: string; skillId?: string; model?: string }) =>
      post<Session>(`/api/projects/${id}/sessions`, body),
  },
  sessions: {
    list: () => get<Session[]>('/api/sessions'),
    get: (id: string) => get<Session>(`/api/sessions/${id}`),
    rename: (id: string, name: string) => patch<Session>(`/api/sessions/${id}`, { name }),
    remove: (id: string) => del(`/api/sessions/${id}`),
    messages: (id: string) => get<Message[]>(`/api/sessions/${id}/messages`),
    exchanges: (id: string) => get<Exchange[]>(`/api/sessions/${id}/exchanges`),
    opencodeMessages: (id: string) => get<unknown[]>(`/api/sessions/${id}/opencode-messages`),
    changes: (id: string) => get<FileChange[]>(`/api/sessions/${id}/changes`),

    /** Stream a message. Calls onEvent for each agent event, resolves when done. */
    sendMessage: async (
      sessionId: string,
      content: string,
      onEvent: (e: AgentEvent) => void,
    ): Promise<{ runId: string; exitCode: number }> => {
      const resp = await fetch(`/api/sessions/${sessionId}/messages`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      })
      if (!resp.ok || !resp.body) throw new Error(`sendMessage → ${resp.status}`)

      for await (const { event, data } of readSSE(resp)) {
        const parsed = JSON.parse(data) as Record<string, unknown>
        if (event === 'agent') {
          onEvent(parsed as AgentEvent)
        } else if (event === 'done') {
          return { runId: String(parsed['runId'] ?? ''), exitCode: Number(parsed['exitCode'] ?? 0) }
        } else if (event === 'error') {
          throw new Error(String(parsed['message'] ?? 'Unknown error'))
        }
      }
      return { runId: '', exitCode: 0 }
    },
  },
  skills: { list: () => get<Skill[]>('/api/skills') },
  agents: { list: () => get<Agent[]>('/api/agents') },
}
