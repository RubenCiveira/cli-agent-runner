import { useState, useEffect, useRef, useCallback } from 'react'
import { api } from '../api.ts'
import type { Exchange, FileChange, Session, AgentEvent, RunEvent, EventData } from '../api.ts'

// ── Diff renderer ─────────────────────────────────────────────────────────────

function DiffView({ diff }: { diff: string }) {
  return (
    <div className="diff-block">
      {diff.split('\n').map((line, i) => {
        let cls = 'ctx'
        if (line.startsWith('+++') || line.startsWith('---')) cls = 'hunk'
        else if (line.startsWith('@@')) cls = 'hunk'
        else if (line.startsWith('+')) cls = 'add'
        else if (line.startsWith('-')) cls = 'del'
        return <div key={i} className={`diff-line ${cls}`}>{line || ' '}</div>
      })}
    </div>
  )
}

// ── Changes panel ─────────────────────────────────────────────────────────────

function ChangesPanel({ sessionId, onClose }: { sessionId: string; onClose: () => void }) {
  const [changes, setChanges] = useState<FileChange[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    api.sessions.changes(sessionId).then(setChanges).finally(() => setLoading(false))
  }, [sessionId])

  const BADGE: Record<string, string> = { added: 'badge-added', modified: 'badge-modified', deleted: 'badge-deleted' }
  const SYM: Record<string, string> = { added: '+', modified: '~', deleted: '-' }

  return (
    <div className="changes-overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="changes-panel">
        <div className="changes-panel-header">
          <h2>File changes</h2>
          <button className="btn-icon" onClick={onClose} style={{ fontSize: 16 }}>✕</button>
        </div>
        <div className="changes-panel-body">
          {loading && <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>Loading…</p>}
          {!loading && changes.length === 0 && (
            <p style={{ color: 'var(--text-muted)', fontSize: 12 }}>No file changes recorded for this session.</p>
          )}
          {changes.map((c) => (
            <div key={c.id} className="change-file">
              <div className="change-file-header">
                <span className={BADGE[c.change_type]}>{SYM[c.change_type]}</span>
                <span className="change-path">{c.path}</span>
              </div>
              {c.diff ? <DiffView diff={c.diff} /> : <p className="no-diff">No diff available</p>}
            </div>
          ))}
        </div>
      </div>
    </div>
  )
}

// ── Events section ────────────────────────────────────────────────────────────

function tok(tokens: Record<string, unknown>): string {
  const parts: string[] = []
  if (tokens.total) parts.push(`${tokens.total} tok`)
  const cache = tokens.cache as Record<string, unknown> | undefined
  if (cache?.read) parts.push(`${cache.read} cached`)
  const cost = tokens.cost as number | undefined
  if (cost) parts.push(`$${cost.toFixed(4)}`)
  return parts.join(' · ')
}

function EventRow({ data }: { data: EventData }) {
  const type = data.type

  if (type === 'done' || type === 'step_start') return null

  // ── Grouped step (step_start…step_finish folded by server) ────────────────
  if (type === 'step') {
    const innerEvents = (data.events ?? []) as EventData[]
    const tokens = (data.tokens ?? {}) as Record<string, unknown>
    const summary = tok({ ...tokens, cost: data.cost as number | undefined })
    return (
      <div className="ev-step">
        <div className="ev-step-header">
          <span className="ev-label">step</span>
          <span className="ev-name">{String(data.reason ?? 'stop')}</span>
          {summary && <span className="ev-meta">{summary}</span>}
        </div>
        <div className="ev-step-body">
          {innerEvents.map((e, i) => <EventRow key={i} data={e} />)}
        </div>
      </div>
    )
  }

  // ── step_finish (ungrouped — run still active when loaded) ─────────────────
  if (type === 'step_finish') {
    const part = (data.part ?? {}) as Record<string, unknown>
    const summary = tok({ ...(part.tokens ?? {}) as Record<string, unknown>, cost: part.cost as number | undefined })
    return (
      <div className="ev-row step-finish-ev">
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 8px' }}>
          <span className="ev-label">step</span>
          <span className="ev-name">{String(part.reason ?? 'stop')}</span>
          {summary && <span className="ev-meta">{summary}</span>}
        </div>
      </div>
    )
  }

  // ── tool_use — two sub-formats: AgentEvent (name) or opencode (part.tool) ──
  if (type === 'tool_use') {
    const part = data.part as Record<string, unknown> | undefined
    const name = String(data.name ?? part?.tool ?? '?')
    const state = (part?.state ?? {}) as Record<string, unknown>
    const isDone = !part || state.status === 'completed'
    const input = data.input ?? state.input
    const output = state.output != null ? String(state.output) : null
    return (
      <div className={`ev-row ${isDone ? 'tool-result' : 'tool-use'}`}>
        <div style={{ display: 'flex', gap: 6, alignItems: 'center', padding: '2px 8px' }}>
          <span className="ev-label">{isDone ? 'result' : 'use'}</span>
          <span className="ev-name">{name}</span>
        </div>
        {output && <pre className="ev-data">{output.length > 600 ? output.slice(0, 600) + '…' : output}</pre>}
        {input != null && !isDone && <pre className="ev-data">{JSON.stringify(input, null, 2)}</pre>}
      </div>
    )
  }

  // ── tool_result ───────────────────────────────────────────────────────────
  if (type === 'tool_result') {
    const content = String(data.content ?? '')
    return (
      <div className="ev-row tool-result">
        <span className="ev-label">result</span>
        <pre className="ev-data">{content.length > 600 ? content.slice(0, 600) + '…' : content}</pre>
      </div>
    )
  }

  // ── text — AgentEvent (text) or opencode (part.text) ─────────────────────
  if (type === 'text') {
    const text = String(data.text ?? (data.part as Record<string, unknown> | undefined)?.text ?? '')
    if (!text.trim()) return null
    return (
      <div className="ev-row text-ev">
        <span className="ev-label">text</span>
        <span className="ev-data">{text.length > 300 ? text.slice(0, 300) + '…' : text}</span>
      </div>
    )
  }

  // ── error ─────────────────────────────────────────────────────────────────
  if (type === 'error') {
    return (
      <div className="ev-row error-ev">
        <span className="ev-label">error</span>
        <span className="ev-data ev-error">{String(data.message ?? '')}</span>
      </div>
    )
  }

  // ── unknown / raw ─────────────────────────────────────────────────────────
  const display = JSON.stringify(data)
  return (
    <div className="ev-row raw-ev">
      <span className="ev-label">{type || 'raw'}</span>
      <span className="ev-data">{display.length > 300 ? display.slice(0, 300) + '…' : display}</span>
    </div>
  )
}

function EventsSection({ steps, runStatus }: { steps: RunEvent[]; runStatus: Exchange['runStatus'] }) {
  const [open, setOpen] = useState(false)
  if (steps.length === 0) return null

  const isActive = runStatus === 'queued' || runStatus === 'running'
  const stepCount = steps.filter((e) => e.data.type === 'step' || e.data.type === 'tool_use').length

  return (
    <div className="events-section">
      <button className="events-toggle" onClick={() => setOpen((o) => !o)}>
        <span className="events-arrow">{open ? '▾' : '▸'}</span>
        {isActive
          ? <><span className="ev-spinner" /><span className="ev-status running">Working…</span></>
          : runStatus === 'failed'
            ? <span className="ev-status failed">✗ Failed</span>
            : <span className="ev-status done">✓ Done</span>
        }
        {stepCount > 0 && (
          <span className="ev-count">{stepCount} {stepCount !== 1 ? 'steps' : 'step'}</span>
        )}
      </button>
      {open && (
        <div className="events-body">
          {steps.map((e) => <EventRow key={e.id} data={e.data} />)}
        </div>
      )}
    </div>
  )
}

// ── Exchange turn ─────────────────────────────────────────────────────────────

function textFromEventData(ev: EventData): string {
  if (ev.type !== 'text') return ''
  return String(ev.text ?? (ev.part as Record<string, unknown> | undefined)?.text ?? '')
}

function extractStepsText(steps: RunEvent[]): string {
  return steps.flatMap((step) => {
    const d = step.data
    if (d.type === 'step') return ((d.events as EventData[] | undefined) ?? []).map(textFromEventData)
    return [textFromEventData(d)]
  }).join('')
}

function ExchangeTurn({ exchange, streamText }: { exchange: Exchange; streamText?: string }) {
  const assistantText = exchange.assistantMessage?.content ?? extractStepsText(exchange.steps)
  const isStreaming = streamText !== undefined && !assistantText

  return (
    <div className="exchange-turn">
      {exchange.userMessage && (
        <div className="message">
          <div className="msg-role user">U</div>
          <div className="msg-content">{exchange.userMessage.content}</div>
        </div>
      )}
      <EventsSection steps={exchange.steps} runStatus={exchange.runStatus} />
      {assistantText && (
        <div className="message">
          <div className="msg-role assistant">A</div>
          <div className="msg-content">{assistantText}</div>
        </div>
      )}
      {isStreaming && (
        <div className="message">
          <div className="msg-role assistant">A</div>
          <div className="msg-content streaming">{streamText || ' '}</div>
        </div>
      )}
    </div>
  )
}

// ── Debug helper ──────────────────────────────────────────────────────────────

function logExchanges(exchanges: Exchange[]) {
  return exchanges.map((ex) => ({
    runId: ex.runId.slice(0, 8),
    status: ex.runStatus,
    user: ex.userMessage?.content.slice(0, 80) ?? null,
    assistant: ex.assistantMessage?.content.slice(0, 80) ?? null,
    steps: ex.steps.map((e) => {
      const d = e.data
      const part = d.part as Record<string, unknown> | undefined
      return {
        type: d.type,
        name: d.name ?? part?.tool,
        ...(d.type === 'step' ? { events: (d.events as unknown[])?.length } : {}),
      }
    }),
  }))
}

// ── Send icon ─────────────────────────────────────────────────────────────────

function SendIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor">
      <path d="M1.5 2.5l13 5.5-13 5.5V9.5l9-1.5-9-1.5V2.5Z" />
    </svg>
  )
}

// ── Chat component ────────────────────────────────────────────────────────────

interface ChatProps {
  session: Session
}

export function Chat({ session }: ChatProps) {
  const [exchanges, setExchanges] = useState<Exchange[]>([])
  const [input, setInput] = useState('')
  const [streaming, setStreaming] = useState(false)
  const [streamText, setStreamText] = useState('')
  const [pendingExchange, setPendingExchange] = useState<Exchange | null>(null)
  const [showChanges, setShowChanges] = useState(false)
  const [changesCount, setChangesCount] = useState(0)
  const [error, setError] = useState('')
  const bottomRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => {
    setExchanges([])
    setPendingExchange(null)
    setStreamText('')
    setError('')
    setInput('')
    api.sessions.exchanges(session.id).then((exs) => {
      setExchanges(exs)
      console.debug('[exchanges:load]', session.id, logExchanges(exs))
    })
    api.sessions.changes(session.id).then((c) => setChangesCount(c.length))
  }, [session.id])

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [exchanges, streamText, pendingExchange])

  const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value)
    e.target.style.height = 'auto'
    e.target.style.height = Math.min(e.target.scrollHeight, 160) + 'px'
  }, [])

  const sendMessage = useCallback(async () => {
    const content = input.trim()
    if (!content || streaming) return

    setInput('')
    if (textareaRef.current) { textareaRef.current.style.height = 'auto' }
    setError('')
    setStreaming(true)
    setStreamText('')

    // Show optimistic pending exchange
    const optimistic: Exchange = {
      runId: 'pending',
      runStatus: 'running',
      userMessage: { id: 'opt', session_id: session.id, run_id: null, role: 'user', content, created_at: Date.now() },
      assistantMessage: null,
      steps: [],
    }
    setPendingExchange(optimistic)

    let fullText = ''
    try {
      await api.sessions.sendMessage(session.id, content, (event: AgentEvent) => {
        if (event.type === 'text') {
          fullText += event.text
          setStreamText(fullText)
        }
      })

      const updated = await api.sessions.exchanges(session.id)
      setExchanges(updated)
      console.debug('[exchanges:after-send]', session.id, logExchanges(updated))
      const updatedChanges = await api.sessions.changes(session.id)
      setChangesCount(updatedChanges.length)
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Error sending message')
    } finally {
      setPendingExchange(null)
      setStreaming(false)
      setStreamText('')
    }
  }, [input, streaming, session.id])

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); sendMessage() }
  }, [sendMessage])

  return (
    <>
      <div className="chat-panel">
        <div className="chat-header">
          <span className="session-name">{session.name}</span>
          <span className="header-meta">{session.agent_id}{session.skill_id ? ` · ${session.skill_id}` : ''}</span>
          <button
            className={`changes-badge ${changesCount > 0 ? 'has-changes' : ''}`}
            onClick={() => setShowChanges(true)}
          >
            {changesCount > 0 ? `${changesCount} changes` : 'Changes'}
          </button>
        </div>

        <div className="messages">
          {exchanges.length === 0 && !streaming && (
            <div style={{ padding: '20px', color: 'var(--text-dim)', fontSize: 12, textAlign: 'center' }}>
              Send a message to start the conversation.
            </div>
          )}
          {exchanges
            .filter((ex) => ex.userMessage || ex.assistantMessage || ex.steps.length > 0)
            .map((ex) => <ExchangeTurn key={ex.runId} exchange={ex} />)}
          {pendingExchange && <ExchangeTurn exchange={pendingExchange} streamText={streamText} />}
          {error && (
            <div style={{ padding: '8px 20px', color: 'var(--red)', fontSize: 12 }}>{error}</div>
          )}
          <div ref={bottomRef} />
        </div>

        <div className="chat-input-area">
          <textarea
            ref={textareaRef}
            className="chat-textarea"
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder="Message… (Enter to send, Shift+Enter for newline)"
            disabled={streaming}
            rows={1}
          />
          <button className="send-btn" onClick={sendMessage} disabled={!input.trim() || streaming}>
            <SendIcon />
          </button>
        </div>
      </div>

      {showChanges && (
        <ChangesPanel sessionId={session.id} onClose={() => setShowChanges(false)} />
      )}
    </>
  )
}
