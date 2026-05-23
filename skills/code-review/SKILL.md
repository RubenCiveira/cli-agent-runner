---
name: code-review
description: Review code for correctness, security, performance, and style.
tags: code, review, quality
---

## Workflow

Review the provided code and produce a structured report.

### Structure your response as follows:

**Summary** — one sentence describing what the code does.

**Issues** — list findings grouped by severity:
- 🔴 Critical: bugs, security vulnerabilities, data loss risks
- 🟡 Warning: performance issues, bad patterns, missing error handling
- 🔵 Suggestion: style, naming, readability improvements

**Verdict** — one of: `APPROVE`, `APPROVE WITH CHANGES`, `REQUEST CHANGES`

### Rules:
- Reference specific line numbers when possible.
- Distinguish between bugs (incorrect behaviour) and style issues (preference).
- Do not rewrite code unless asked. Describe the fix instead.
- If the code is too long to review fully, state what you covered.
