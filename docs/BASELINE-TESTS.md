# Baseline verification — 6 November 2026

Environment: Node.js v22.16.0, Linux container. The Node application was tested without npm dependencies.

Commands executed:

```bash
npm run check
npm test
```

Observed results:

- JavaScript syntax checks: **passed** (`server/index.js`, `server/api.js`, `public/app.js`).
- API integration tests: **7 passed, 0 failed**.
- Covered health check, empty list, full CRUD flow, optimistic update conflict (HTTP 409), validation, malformed JSON, payload size limit, HTML/CSS serving and source-code non-disclosure.
- Local application started and `/api/health` returned `{"status":"ok","service":"concord-sprint-demo"}`.

**Not yet verified**: Claude Code ↔ Codex MCP integration, Concord install, adapter connectivity or real multi-agent messaging. Those require the separately provisioned CLIs and runtime access. The baseline result is not evidence of Concord collaboration.
