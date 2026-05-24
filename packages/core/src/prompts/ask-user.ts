// ── JSON Schema — single source of truth ──────────────────────────────────────
//
// This schema drives both the system prompt injected into the agent and the
// runtime validation of the JSON the agent emits inside <question-form> blocks.

export const QUESTION_FORM_SCHEMA = {
  type: 'object',
  required: ['questions'],
  properties: {
    questions: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label', 'type'],
        properties: {
          id:            { type: 'string', description: 'Unique key for this question' },
          label:         { type: 'string', description: 'Question text shown to the user' },
          type:          { enum: ['text', 'textarea', 'radio', 'checkbox'] },
          options: {
            type: 'array',
            description: 'Required for radio/checkbox',
            items: {
              type: 'object',
              required: ['label', 'value'],
              properties: {
                label: { type: 'string' },
                value: { type: 'string', description: 'Stable key sent in the answer' },
              },
            },
          },
          maxSelections: { type: 'integer', minimum: 1, description: 'Checkbox only' },
          placeholder:   { type: 'string' },
          required:      { type: 'boolean' },
        },
        if:   { properties: { type: { enum: ['radio', 'checkbox'] } } },
        then: { required: ['options'] },
      },
    },
  },
} as const

// ── TypeScript types derived from the schema ──────────────────────────────────

export type QuestionType = 'text' | 'textarea' | 'radio' | 'checkbox'

export interface QuestionOption {
  label: string
  value: string
}

export interface FormQuestion {
  id: string
  label: string
  type: QuestionType
  options?: QuestionOption[]
  maxSelections?: number
  placeholder?: string
  required?: boolean
}

export interface QuestionForm {
  id?: string
  title?: string
  questions: FormQuestion[]
}

export type FormAnswers = Record<string, string | string[]>

// ── Runtime validation against the schema shape ───────────────────────────────

function isQuestionOption(v: unknown): v is QuestionOption {
  if (typeof v !== 'object' || v === null) return false
  const o = v as Record<string, unknown>
  return typeof o['label'] === 'string' && typeof o['value'] === 'string'
}

function isFormQuestion(v: unknown): v is FormQuestion {
  if (typeof v !== 'object' || v === null) return false
  const q = v as Record<string, unknown>
  if (typeof q['id'] !== 'string' || typeof q['label'] !== 'string') return false
  const TYPES: string[] = ['text', 'textarea', 'radio', 'checkbox']
  if (!TYPES.includes(String(q['type']))) return false
  if (q['type'] === 'radio' || q['type'] === 'checkbox') {
    if (!Array.isArray(q['options']) || !q['options'].every(isQuestionOption)) return false
  }
  return true
}

/**
 * Validates and coerces a parsed JSON value into a QuestionForm.
 * Returns null when the value doesn't match the schema.
 */
export function parseQuestionForm(
  value: unknown,
  attrs: { id?: string; title?: string } = {},
): QuestionForm | null {
  if (typeof value !== 'object' || value === null) return null
  const obj = value as Record<string, unknown>
  if (!Array.isArray(obj['questions'])) return null
  if (!obj['questions'].every(isFormQuestion)) return null
  return {
    id: attrs.id,
    title: attrs.title,
    questions: obj['questions'] as FormQuestion[],
  }
}

// ── System prompt fragment ────────────────────────────────────────────────────

export const ASK_USER_PROMPT = `\
## Asking the user for input

When you need information before proceeding, emit a \`<question-form>\` block
instead of asking in plain text. Stop after emitting it — do not continue.

\`\`\`
<question-form id="<id>" title="<optional title>">
{ …JSON matching the schema below… }
</question-form>
\`\`\`

JSON Schema for the block body:
\`\`\`json
${JSON.stringify(QUESTION_FORM_SCHEMA, null, 2)}
\`\`\`

Rules:
- \`options\` is required for \`radio\` / \`checkbox\`; omit for \`text\` / \`textarea\`.
- Group all questions into one block. Do not repeat questions already answered.
- After emitting the block, stop — wait for the user's response.

Answers arrive in the next message as:
\`\`\`
[form answers — <id>]
- <label>: <value or comma-separated values>
\`\`\``

// ── Text splitting ────────────────────────────────────────────────────────────

/** Returns true when text contains at least one <question-form> block. */
export function hasQuestionForm(text: string): boolean {
  return /<question-form[\s>]/i.test(text)
}

/** One segment of a split agent response — prose or a parsed form. */
export type FormSegment =
  | { kind: 'text'; content: string }
  | { kind: 'form'; raw: string; form: QuestionForm }

/**
 * Splits agent output into alternating prose / question-form segments.
 * Uses parseQuestionForm (schema-validated) for each block found.
 * Segments that fail validation are returned as plain text to avoid data loss.
 */
export function splitOnQuestionForms(input: string): FormSegment[] {
  const TAG_RE = /<question-form([^>]*)>([\s\S]*?)<\/question-form>/gi
  const segments: FormSegment[] = []
  let lastIndex = 0
  let match: RegExpExecArray | null

  while ((match = TAG_RE.exec(input)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: 'text', content: input.slice(lastIndex, match.index) })
    }

    const attrs = match[1]
    const body = match[2].trim()
    const raw = match[0]

    const id    = /\bid=["']?([^"'\s>]+)["']?/i.exec(attrs)?.[1]
    const title = /\btitle=["']([^"']*)["']/i.exec(attrs)?.[1]

    // Strip optional code-fence wrapper the agent sometimes adds
    const jsonBody = body.startsWith('```')
      ? body.replace(/^```[^\n]*\n?/, '').replace(/\n?```$/, '')
      : body

    let parsed: unknown
    try { parsed = JSON.parse(jsonBody) } catch { parsed = null }

    const form = parseQuestionForm(parsed, { id, title })

    if (form) {
      segments.push({ kind: 'form', raw, form })
    } else {
      segments.push({ kind: 'text', content: raw })
    }

    lastIndex = match.index + raw.length
  }

  if (lastIndex < input.length) {
    segments.push({ kind: 'text', content: input.slice(lastIndex) })
  }

  return segments.filter((s) => s.kind !== 'text' || s.content.trim() !== '')
}

// ── Answer serialisation ──────────────────────────────────────────────────────

/**
 * Serialises user answers into the [form answers — id] format
 * the agent expects to see in the next user message.
 */
export function formatFormAnswers(form: QuestionForm, answers: FormAnswers): string {
  const header = form.id ? `[form answers — ${form.id}]` : '[form answers]'
  const lines = form.questions.map((q) => {
    const answer = answers[q.id]
    const text = Array.isArray(answer) ? answer.join(', ') : (answer ?? '(skipped)')
    return `- ${q.label}: ${text}`
  })
  return `${header}\n${lines.join('\n')}`
}
