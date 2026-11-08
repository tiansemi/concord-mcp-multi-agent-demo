import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { runInNewContext } from 'node:vm';

// Minimal DOM substitute: tests the shipped script, not a duplicate predicate.
// This deliberately does not simulate browser layout, focus, or native select behavior.
class Element {
  constructor(tag = 'div') {
    this.tagName = tag;
    this.children = [];
    this.listeners = {};
    this.attributes = {};
    this.style = { setProperty() {} };
    this.value = '';
    this.textContent = '';
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  replaceWith(element) { this.replacement = element; }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(type, listener) { this.listeners[type] = listener; }
  dispatch(type, value) {
    this.value = value;
    this.listeners[type]({ target: this });
  }
}

const source = await readFile(new URL('../public/app.js', import.meta.url), 'utf8');
const fixtures = [
  { id: '1', title: '<script>Alpha</script>', description: 'Design', owner: 'QA', priority: 'high', status: 'backlog' },
  { id: '2', title: 'Beta', description: 'Alpha notes', owner: 'Dev', priority: 'medium', status: 'progress' },
  { id: '3', title: 'Gamma', description: '', owner: 'Alpha team', priority: 'low', status: 'done' },
  { id: '4', title: 'Delta', description: '', owner: 'QA', priority: 'high', status: 'done' }
];

async function app(tasks = fixtures) {
  const elements = new Map();
  const created = [];
  const calls = [];
  const get = selector => {
    if (!elements.has(selector)) elements.set(selector, new Element());
    return elements.get(selector);
  };
  runInNewContext(source, {
    document: {
      querySelector: get,
      querySelectorAll: () => [],
      createElement: tag => { const element = new Element(tag); created.push(element); return element; }
    },
    fetch: async path => { calls.push(path); return { ok: true, json: async () => ({ tasks }) }; },
    window: { clearTimeout() {}, setTimeout() {} }
  });
  await new Promise(resolve => setImmediate(resolve));
  const priority = created.find(element => element.id === 'priority-filter');
  const counts = () => ['backlog', 'progress', 'done'].map(status => Number(get(`#${status}-column-count`).textContent));
  return { get, created, priority, counts, calls };
}

test('priority options are labelled and all priorities are initially shown', async () => {
  const ui = await app();
  assert.deepEqual(ui.priority.children.map(option => option.value), ['all', 'high', 'medium', 'low']);
  assert.ok(ui.created.some(element => element.tagName === 'label' && element.attributes.for === 'priority-filter'));
  assert.deepEqual(ui.counts(), [1, 1, 2]);
  for (const [priority, counts] of [['high', [1, 0, 1]], ['medium', [0, 1, 0]], ['low', [0, 0, 1]], ['all', [1, 1, 2]]]) {
    ui.priority.dispatch('change', priority);
    assert.deepEqual(ui.counts(), counts);
  }
  assert.deepEqual(ui.calls, ['/api/tasks']);
});

test('search and priority intersect, reset independently, and leave metrics unfiltered', async () => {
  const ui = await app();
  ui.get('#search-input').dispatch('input', '  ALPHA  ');
  assert.deepEqual(ui.counts(), [1, 1, 1]);
  ui.priority.dispatch('change', 'high');
  assert.deepEqual(ui.counts(), [1, 0, 0]);
  ui.get('#search-input').dispatch('input', '');
  assert.deepEqual(ui.counts(), [1, 0, 1]);
  ui.get('#search-input').dispatch('input', 'missing');
  assert.deepEqual(ui.counts(), [0, 0, 0]);
  assert.equal(ui.get('#backlog-list').children[0].textContent, 'No matching tasks');
  ui.priority.dispatch('change', 'all');
  assert.deepEqual(ui.counts(), [0, 0, 0]);
  ui.get('#search-input').dispatch('input', '   ');
  assert.deepEqual(ui.counts(), [1, 1, 2]);
  assert.equal(ui.get('#total-count').textContent, '4');
  assert.equal(ui.get('#progress-count').textContent, '1');
  assert.equal(ui.get('#done-count').textContent, '2');
});

test('empty collections distinguish unfiltered and filtered empty states', async () => {
  const ui = await app([]);
  assert.deepEqual(ui.counts(), [0, 0, 0]);
  assert.equal(ui.get('#backlog-list').children[0].textContent, 'No tasks yet');
  assert.equal(ui.get('#percent-count').textContent, '0%');
  ui.priority.dispatch('change', 'low');
  assert.equal(ui.get('#backlog-list').children[0].textContent, 'No matching tasks');
});

test('task titles are rendered as text and the existing search element is retained', async () => {
  const ui = await app();
  const card = ui.get('#backlog-list').children[0];
  assert.equal(card.children.find(element => element.tagName === 'h4').textContent, '<script>Alpha</script>');
  assert.ok(ui.get('.search-wrap').replacement.children.includes(ui.get('.search-wrap')));
  assert.equal(typeof ui.get('#search-input').listeners.input, 'function');
});
