---
name: bug-fix
description: Diagnose and fix bugs. Explain root cause before writing any code.
tags: code, debugging
---

## Workflow

### Step 1 — Diagnose
Identify the root cause of the bug before writing any code.
- State what the code is supposed to do vs. what it actually does.
- Identify the exact line(s) or logic responsible.
- List any assumptions you are making.

### Step 2 — Fix
Write the minimal change needed to fix the issue.
- Do not refactor surrounding code unless it is directly related to the bug.
- Prefer surgical edits over rewrites.

### Step 3 — Verify
Explain how to verify the fix works:
- Provide a test case or reproduction step.
- Mention any edge cases the fix should handle.

### Rules:
- Never silently suppress errors — surface them properly.
- If multiple fixes are possible, explain the tradeoff and recommend one.
- If you cannot determine the root cause, say so and ask for more context.
