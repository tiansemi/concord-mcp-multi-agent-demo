# Reproducing the Claude Code / Codex collaboration experiment

**Executed experiment:** The Windows setup script and two-client experiment were run on 6 November 2026. Both agents shared a Concord workspace, an overlapping file claim was detected before a conflicting edit, and separate frontend/backend tasks reached `review_ready`. Both cross-agent reviews reported PASS. See [EVIDENCE.md](EVIDENCE.md) for historical observations and later finalization.

**Evidence boundaries:** Direct agent-to-agent messaging was not tested; live endpoints were unreachable. Shared task records, decisions and handoffs provided coordination. Codex identity was explicitly configured rather than automatically detected.

## Reproduction protocol

These steps describe a new experiment, not unfinished work from the original run. Use a fresh copy and unique task IDs; do not reopen existing review-ready tasks.

1. Run `npm test` and `npm start` for a baseline. The original pre-collaboration Linux baseline had 7 tests; the current project has 14.
2. Read [CONFIG-AUDIT.md](CONFIG-AUDIT.md), review and execute `scripts/setup-concord-sandbox.ps1` on Windows. It was executed for the original experiment; a new run still requires reviewing its effects. It refuses to overwrite existing local MCP configs.
3. Inspect `concord status`, `concord doctor` and `concord adapters status`. Record actual client/runtime versions and reachability; do not infer messaging support from registration alone.
4. Launch Claude Code from the project root and Codex via `scripts/run-codex-sandbox.ps1`, pointing to the same root. Inspect the generated project-local MCP configurations if a client does not connect.
5. Have Claude Code call `start_work` for a frontend priority-filter task claiming `public/app.js` and `public/styles.css`. It should implement a labelled native priority select, combine it with search and record its decision using `update_work`, without changing the API.
6. After that claim, have Codex attempt `start_work` on `public/app.js` for a summary API task. Capture the overlap response and do not edit the conflicting file. Release/close the probe and claim `server/api.js` and `test/api.test.js` under a distinct backend task. In the original run, reusing the probe retained the old file scope, so the backend task was registered separately.
7. Have Codex implement `GET /api/summary` returning dynamic `{total, backlog, progress, done}`, record the contract with task-scoped `update_work`, and add integration tests. Record coordination through durable shared state; do not attempt direct prompts while endpoints are unreachable.
8. Each agent runs `npm run check` and `npm test`, then calls `finish_work` with files, decisions, guardrails, tests and limitations to submit a review-ready handoff.
9. Perform independent read-only cross-agent reviews and manual browser checks of filtering, search, combined filters, counts, task mutations and summary consistency. Record observed outcomes separately from static review conclusions.

On Windows, use `npm.cmd` where the PowerShell npm shim is blocked.

## Evidence to collect for a new run

- Agent identities, versions and shared workspace observation; redact absolute paths and path-encoded workspace IDs before publication.
- The raw `start_work` overlap response before any conflicting edit.
- Task-scoped contract/decision records and both review-ready handoffs.
- Test command output and scoped diffs if Git is initialized.
- Manual browser observations, distinguishing screenshots from author reports.
- Reachability status. A direct prompt/reply is a separate optional experiment only when reachable; the original demonstration did not test it.

## Recorded outcomes and final state

| Check | Historical observation / current evidence |
| --- | --- |
| Setup | Isolated PowerShell script executed on Windows; local Concord tooling/configs generated. Network-level telemetry suppression and complete isolation were not independently verified |
| Versions | Concord 0.20.0 and Codex v0.167.0 recorded; Claude Code version and Windows Node.js version not captured. Node.js v22.16.0 belongs to the separate Linux baseline. A later documentation review observed v26.13.0, not proof of the earlier runtime |
| Shared workspace | Both clients registered; Codex identity was operator-configured |
| Overlap detection | Codex reported `public/app.js` overlap with Claude Code; durable probe handoff records it. Raw response is not included in published evidence. Scope was resolved before conflicting edits; this does not prove automatic edit blocking |
| Messaging | Not tested; endpoints unreachable and no direct messages recorded. Contracts and decisions are in shared task state |
| Implementation handoffs | Frontend and backend both `review_ready` v2; later finalization did not alter those task records |
| Independent reviews | Both PASS with low-severity findings; historical findings and subsequent fixes are separated in EVIDENCE.md |
| Original tests | 7/7 Linux baseline, followed by 10/10 Windows API tests after implementation and during reviews |
| Finalization | Syntax check passed and 14/14 tests passed: 10 API tests with fresh per-test servers plus 4 frontend behavioral tests using a DOM substitute |
| Manual browser validation | Author-reported checklist and selected screenshots; see EVIDENCE.md. No claim of automated browser/layout/accessibility coverage |

The experiment demonstrates scoped shared-state coordination and overlap detection. It does not establish live delivery, automatic identity detection for Codex, cross-machine coordination or production readiness.
