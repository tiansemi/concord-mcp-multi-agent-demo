import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, extname, join, resolve, sep } from 'node:path';
import { randomUUID } from 'node:crypto';

const __dirname = dirname(fileURLToPath(import.meta.url));
const publicRoot = resolve(__dirname, '../public');
const STATUSES = new Set(['backlog', 'progress', 'done']);
const PRIORITIES = new Set(['low', 'medium', 'high']);
const MAX_BODY_BYTES = 16 * 1024;
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon'
};

const seed = [
  { title: 'Define API contract', description: 'Agree on JSON payloads and optimistic updates.', status: 'done', priority: 'high', owner: 'Backend' },
  { title: 'Create responsive task board', description: 'Build accessible columns, cards and controls.', status: 'progress', priority: 'high', owner: 'Frontend' },
  { title: 'Add request validation', description: 'Reject malformed inputs and limit payload sizes.', status: 'progress', priority: 'medium', owner: 'Backend' },
  { title: 'Run integration tests', description: 'Test endpoints, error states and conflicts.', status: 'backlog', priority: 'medium', owner: 'QA' },
  { title: 'Prepare Concord review packet', description: 'Record claimed files, test results and handoff.', status: 'backlog', priority: 'low', owner: 'Reviewer' }
];

function json(res, status, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff'
  });
  res.end(body);
}

function httpError(status, message) {
  return Object.assign(new Error(message), { status });
}

async function bodyJson(req) {
  const declared = req.headers['content-length'];
  if (declared && Number(declared) > MAX_BODY_BYTES) throw httpError(413, 'Request body too large');
  const chunks = [];
  let size = 0;
  for await (const chunk of req) {
    size += chunk.length;
    if (size > MAX_BODY_BYTES) throw httpError(413, 'Request body too large');
    chunks.push(chunk);
  }
  let value;
  try { value = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw httpError(400, 'Expected a valid JSON body'); }
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw httpError(400, 'Expected a JSON object');
  }
  return value;
}

function stringField(value, name, max, required = false) {
  if (value === undefined && !required) return '';
  if (typeof value !== 'string') throw httpError(400, `${name} must be a string`);
  const trimmed = value.trim();
  if ((required && !trimmed) || trimmed.length > max) {
    throw httpError(400, `${name} must contain ${required ? '1' : '0'}-${max} characters`);
  }
  return trimmed;
}

function validateCreate(input) {
  const title = stringField(input.title, 'title', 80, true);
  const description = stringField(input.description, 'description', 240);
  const owner = stringField(input.owner, 'owner', 32);
  const priority = input.priority ?? 'medium';
  if (!PRIORITIES.has(priority)) throw httpError(400, 'Invalid priority');
  return { title, description, owner: owner || 'Unassigned', priority };
}

function copyTask(task) { return { ...task }; }

export function createAppServer({ initialTasks = seed } = {}) {
  const tasks = new Map();
  for (const task of initialTasks) {
    const id = task.id ?? randomUUID();
    tasks.set(id, { ...copyTask(task), id, version: task.version ?? 1, updatedAt: task.updatedAt ?? new Date().toISOString() });
  }

  const server = createServer(async (req, res) => {
    try {
      const method = req.method ?? 'GET';
      const url = new URL(req.url ?? '/', 'http://localhost');
      if (url.pathname.startsWith('/api/')) {
        if (url.pathname === '/api/health' && method === 'GET') {
          return json(res, 200, { status: 'ok', service: 'concord-sprint-demo' });
        }
        if (url.pathname === '/api/summary') {
          if (method !== 'GET') {
            res.setHeader('Allow', 'GET');
            return json(res, 405, { error: 'Method not allowed' });
          }
          const summary = { total: tasks.size, backlog: 0, progress: 0, done: 0 };
          for (const task of tasks.values()) {
            if (STATUSES.has(task.status)) summary[task.status] += 1;
          }
          return json(res, 200, summary);
        }
        if (url.pathname === '/api/tasks') {
          if (method === 'GET') {
            const list = [...tasks.values()].sort((a, b) => a.updatedAt < b.updatedAt ? 1 : -1);
            return json(res, 200, { tasks: list });
          }
          if (method === 'POST') {
            const input = validateCreate(await bodyJson(req));
            const task = { id: randomUUID(), ...input, status: 'backlog', version: 1, updatedAt: new Date().toISOString() };
            tasks.set(task.id, task);
            return json(res, 201, { task });
          }
          res.setHeader('Allow', 'GET, POST');
          return json(res, 405, { error: 'Method not allowed' });
        }
        const taskId = /^\/api\/tasks\/([a-f\d-]{36})$/.exec(url.pathname)?.[1];
        if (taskId) {
          const task = tasks.get(taskId);
          if (!task) return json(res, 404, { error: 'Task not found' });
          if (method === 'PATCH') {
            const input = await bodyJson(req);
            if (!Number.isSafeInteger(input.version) || input.version !== task.version) {
              return json(res, 409, { error: 'Task was updated elsewhere. Refresh and try again.', current: task });
            }
            if (!STATUSES.has(input.status)) throw httpError(400, 'Invalid status');
            const updated = { ...task, status: input.status, version: task.version + 1, updatedAt: new Date().toISOString() };
            tasks.set(taskId, updated);
            return json(res, 200, { task: updated });
          }
          if (method === 'DELETE') {
            tasks.delete(taskId);
            return json(res, 200, { deleted: true });
          }
          res.setHeader('Allow', 'PATCH, DELETE');
          return json(res, 405, { error: 'Method not allowed' });
        }
        return json(res, 404, { error: 'API endpoint not found' });
      }
      if (method !== 'GET' && method !== 'HEAD') {
        res.writeHead(405, { Allow: 'GET, HEAD' });
        return res.end();
      }
      const pathname = url.pathname === '/' ? '/index.html' : url.pathname;
      // Prevent path traversal and never expose local source code.
      let decoded;
      try { decoded = decodeURIComponent(pathname); }
      catch { throw httpError(400, 'Invalid path encoding'); }
      if (decoded.includes('\\') || decoded.includes('\0') || decoded.split('/').includes('..')) {
        throw httpError(403, 'Forbidden path');
      }
      const path = resolve(publicRoot, '.' + decoded);
      if (path !== publicRoot && !path.startsWith(publicRoot + sep)) throw httpError(403, 'Forbidden path');
      const type = MIME[extname(path).toLowerCase()];
      if (!type) throw httpError(404, 'File not found');
      try {
        const bytes = await readFile(path);
        res.writeHead(200, { 'Content-Type': type, 'Content-Length': bytes.length, 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-cache' });
        return res.end(method === 'HEAD' ? undefined : bytes);
      } catch (err) {
        if (err.code === 'ENOENT') throw httpError(404, 'File not found');
        throw err;
      }
    } catch (err) {
      if (res.headersSent) return res.end();
      json(res, err.status ?? 500, { error: err.status ? err.message : 'Internal server error' });
    }
  });
  return server;
}
