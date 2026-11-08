# Evidence — first Concord coordination test (6 Nov 2026)

Environment: Windows 11, Concord MCP 0.20.0 (installed with `--ignore-scripts` into `.sandbox-tools/`), Codex v0.167.0, Claude Code, Node.js 22. Telemetry disabled through `CONCORD_TELEMETRY_DISABLED=1` in the generated configs (not verified at network level). Local paths are redacted as `<repo>`.

## Agents and tasks

| Agent | Identity | Task | Scope |
| --- | --- | --- | --- |
| Claude Code | `claude-code:bc5d667f` (from its session) | `frontend-priority-filter` | `public/app.js`, `public/styles.css` |
| Codex | `codex:backend` (set with `CONCORD_AGENT_ID`, no session hooks) | `sprint-summary-api-backend` | `server/api.js`, `test/api.test.js` |

Workspace: `ws_<redacted: encodes the local path>`.

## Sequence

1. Claude Code called `start_work` and claimed its two frontend files; no overlap reported.
2. Codex's first attempts failed: Concord could not identify the session. Cause: no session hooks (`--no-adapters`). Fix: `CONCORD_AGENT_ID=codex:backend` in the Codex sandbox config, then restart.
3. Codex attempted to claim `public/app.js` for "Sprint summary API" and reported an overlap with `claude-code:bc5d667f`. It closed that probe task and registered `sprint-summary-api-backend` on its backend files with zero overlaps. The probe is recorded durably in `concord handoff sprint-summary-api` ("Coordination probe detected public/app.js overlap with Claude Code…"). The raw `start_work` response was not captured.
4. Each agent implemented its feature, ran `npm run check` and `npm test`, and finished with `finish_work`. Both tasks reached `review_ready` (v2).

## Concord state after the work

```text
Review ready
  frontend-priority-filter tests: 2  guardrails: 3  open questions: 0
  sprint-summary-api-backend tests: 2  guardrails: 5  open questions: 0

frontend-priority-filter   review_ready  v2  claude-code:bc5d667f
sprint-summary-api         closed        v6  codex:backend
sprint-summary-api-backend review_ready  v2  codex:backend

doctor: tasks: 3, events: 16; start_work and finish_work used on all three tasks
```

`concord check public/app.js` after completion: `OK: none of the 1 file(s) overlap another active task.`

## Tests

`npm run check` passed. `npm test`: 10 tests, 10 pass, 0 fail (including three new `/api/summary` tests). Codex's own first run failed with `spawn EPERM` inside its sandbox and was re-run with approval. A separate re-run by the author's assistant also gave 10/10.

Manual browser check, reported by the author, who ran the full seven-step checklist (create High/Medium/Low tasks, priority filter, search combined with priority, counters, Backlog → In progress move with the filter active, reset). The author's screenshots show the High filter (only matching cards, counters follow), the searches "json" and "add", and the combination of High with "add" (empty columns show "No matching tasks"); the other steps rest on the author's report, not on a screenshot. `GET /api/summary` returned `total 5, backlog 1, progress 3, done 1`, consistent with the board.

## Review packets (excerpts)

Frontend (`frontend-priority-filter`): labelled native select beside the search box, combined with the text search (AND), filters all three columns and their counts, sprint metrics stay unfiltered, no API change. Guardrails: no backend or Codex-owned files modified, no duplicate task, no commits.

Backend (`sprint-summary-api-backend`): `GET /api/summary` returns `{total, backlog, progress, done}` computed per request from the task map; unsupported methods return 405 with `Allow: GET`; three integration tests added. Guardrails: only `server/api.js` and `test/api.test.js` edited, no dependency added, no frontend file modified.

## Cross-review (each agent reviewed the other's task, read-only)

- **Codex on `frontend-priority-filter`: PASS.** Priority matching and AND-combination with the trimmed, case-insensitive search are correct; column counts follow the filter while sprint metrics stay unfiltered; content uses `textContent`; the native select has an explicit label and visible focus; priority values match backend validation. Low finding: no automated frontend tests (suggested: browser tests for combined filter/search, reset, keyboard, narrow layouts). Codex did not visually verify the responsive layout. It ran `npm run check` and `npm test` (10/10).
- **Claude Code on `sprint-summary-api-backend`: PASS.** `GET /api/summary` recomputes counts on every request through the shared `json()` helper; the summary tests check consistency after every create, status change, rejected update and delete; non-GET methods return 405 with `Allow: GET`; existing routes unchanged; no user input, so no injection surface. Low findings: (1) a task with an unsupported status counts in `total` but in no bucket (only reachable through custom `initialTasks`); (2) two tests depend on run order in a shared server instance; (3) the 405 test covers POST only. Info: the frontend does not call `/api/summary`, and storage is in memory without authentication, by design. It ran `npm test` itself (10/10).
- Neither reviewer modified files, created tasks, committed, or altered the `review_ready` tasks. The findings were not fixed; they are listed here as known limitations.

## Limits of this evidence

- Messaging between the agents was not demonstrated: `Live prompting` shows both agents `unreachable` and `concord messages` returns "No messages". Contract and decisions are shared through task state and review packets only.
- Codex identity is operator-set, not detected from its session.
- The overlap is shown by Codex's report and the persisted handoff, not by a captured `start_work` response.
- The folder was not a git repository during the test, so there is no `git diff --stat`.
- One machine, one run; no repeat.
