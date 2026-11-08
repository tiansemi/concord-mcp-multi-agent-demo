import { afterEach, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { createAppServer } from '../server/api.js';

let server;
let base;

beforeEach(async () => {
  server = createAppServer({ initialTasks: [] });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  base = `http://127.0.0.1:${server.address().port}`;
});

afterEach(async () => {
  await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
});

async function request(path, method = 'GET', body) {
  const response = await fetch(base + path, {
    method,
    ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) })
  });
  return { status: response.status, data: await response.json() };
}

test('health endpoint', async () => {
  const result = await request('/api/health');
  assert.equal(result.status, 200);
  assert.equal(result.data.status, 'ok');
});

test('initial task list is empty', async () => {
  const result = await request('/api/tasks');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.tasks, []);
});

test('summary returns zeros for an empty collection', async () => {
  const result = await request('/api/summary');
  assert.equal(result.status, 200);
  assert.deepEqual(result.data, { total: 0, backlog: 0, progress: 0, done: 0 });
});

test('summary reflects creates, status changes, rejected updates, and deletes', async () => {
  const expected = { total: 0, backlog: 0, progress: 0, done: 0 };
  async function checkSummary() {
    const result = await request('/api/summary');
    assert.equal(result.status, 200);
    assert.deepEqual(result.data, expected);
    const { tasks } = (await request('/api/tasks')).data;
    assert.equal(result.data.total, tasks.length);
    for (const status of ['backlog', 'progress', 'done']) {
      assert.equal(result.data[status], tasks.filter(task => task.status === status).length);
    }
    assert.equal(result.data.total, result.data.backlog + result.data.progress + result.data.done);
  }
  const tasks = [];
  try {
    for (let i = 0; i < 5; i++) {
      const created = await request('/api/tasks', 'POST', { title: `Summary task ${i}` });
      assert.equal(created.status, 201);
      tasks.push(created.data.task);
      expected.total++;
      expected.backlog++;
      await checkSummary();
    }
    for (const [index, status] of [[0, 'progress'], [1, 'progress'], [2, 'done']]) {
      const changed = await request(`/api/tasks/${tasks[index].id}`, 'PATCH', { status, version: 1 });
      assert.equal(changed.status, 200);
      expected.backlog--;
      expected[status]++;
      await checkSummary();
    }
    assert.deepEqual(expected, { total: 5, backlog: 2, progress: 2, done: 1 });
    assert.equal((await request(`/api/tasks/${tasks[0].id}`, 'PATCH', { status: 'done', version: 1 })).status, 409);
    assert.equal((await request(`/api/tasks/${tasks[3].id}`, 'PATCH', { status: 'invalid', version: 1 })).status, 400);
    await checkSummary();
    for (const [index, task] of tasks.entries()) {
      assert.equal((await request(`/api/tasks/${task.id}`, 'DELETE')).status, 200);
      expected.total--;
      expected[index < 2 ? 'progress' : index === 2 ? 'done' : 'backlog']--;
      await checkSummary();
    }
  } finally {
    for (const task of tasks) await request(`/api/tasks/${task.id}`, 'DELETE');
  }
});

test('summary rejects unsupported methods', async () => {
  const response = await fetch(base + '/api/summary', { method: 'POST' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET');
  assert.deepEqual(await response.json(), { error: 'Method not allowed' });
});

test('create, retrieve, update status, and delete a task', async () => {
  const created = await request('/api/tasks', 'POST', { title: '  Test API  ', description: 'Quality checks', owner: 'QA', priority: 'high' });
  assert.equal(created.status, 201);
  const task = created.data.task;
  assert.equal(task.title, 'Test API');
  assert.equal(task.status, 'backlog');
  assert.equal(task.version, 1);

  const list = await request('/api/tasks');
  assert.ok(list.data.tasks.some(t => t.id === task.id));

  const changed = await request(`/api/tasks/${task.id}`, 'PATCH', { status: 'progress', version: 1 });
  assert.equal(changed.status, 200);
  assert.equal(changed.data.task.status, 'progress');
  assert.equal(changed.data.task.version, 2);

  const stale = await request(`/api/tasks/${task.id}`, 'PATCH', { status: 'done', version: 1 });
  assert.equal(stale.status, 409);
  assert.equal(stale.data.current.version, 2);

  const removed = await request(`/api/tasks/${task.id}`, 'DELETE');
  assert.equal(removed.status, 200);
  assert.equal((await request(`/api/tasks/${task.id}`, 'DELETE')).status, 404);
});

test('rejects invalid task inputs', async () => {
  assert.equal((await request('/api/tasks', 'POST', { title: '   ' })).status, 400);
  assert.equal((await request('/api/tasks', 'POST', { title: 'x'.repeat(81) })).status, 400);
  assert.equal((await request('/api/tasks', 'POST', { title: 'Test', priority: 'critical' })).status, 400);
  assert.equal((await request('/api/tasks', 'POST', ['invalid'])).status, 400);
  assert.equal((await request('/api/tasks', 'POST', { title: '<script>alert(1)</script>', description: '<img src=x onerror=alert(1)>' })).status, 201);
});

test('rejects unknown statuses and malformed JSON', async () => {
  const task = (await request('/api/tasks', 'POST', { title: 'Status test' })).data.task;
  assert.equal((await request(`/api/tasks/${task.id}`, 'PATCH', { status: 'random', version: 1 })).status, 400);
  const response = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: 'invalid{' });
  assert.equal(response.status, 400);
});

test('rejects oversized requests', async () => {
  const response = await fetch(base + '/api/tasks', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ title: 'Test', description: 'x'.repeat(20000) }) });
  assert.equal(response.status, 413);
});

test('serves HTML and blocks traversal / source disclosure', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /Sprint Board/);
  const source = await fetch(base + '/server/api.js');
  assert.equal(source.status, 404);
  const css = await fetch(base + '/styles.css');
  assert.equal(css.status, 200);
});
