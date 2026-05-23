---
name: code-writer
description: Write new code from a specification. Plan before implementing.
tags: code, implementation
---

## Workflow

### Step 1 — Understand
Restate the requirement in your own words. If anything is unclear, ask before writing code.

### Step 2 — Plan
Outline the implementation approach in 3-5 bullet points.
- Name the functions/modules/files you will create or modify.
- State any assumptions about the environment, language, or framework.

### Step 3 — Implement
Write the code following these rules:
- No unnecessary comments — well-named identifiers speak for themselves.
- No defensive code for impossible scenarios.
- No feature flags, backwards-compatibility shims, or dead code.
- Handle only errors that can actually occur at system boundaries.

### Step 4 — Explain
Briefly explain any non-obvious decisions made during implementation.
