const STATUS = ['backlog', 'progress', 'done'];
const STATUS_LABELS = { backlog: 'Backlog', progress: 'In progress', done: 'Done' };
const PRIORITY_FILTERS = [['all', 'All priorities'], ['high', 'High'], ['medium', 'Medium'], ['low', 'Low']];
const state = { tasks: [], filter: '', priority: 'all' };
const $ = selector => document.querySelector(selector);

function notify(message, isError = false) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.style.borderColor = isError ? '#ba6363' : '#526782';
  toast.hidden = false;
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => { toast.hidden = true; }, 3800);
}

async function api(path, options = {}) {
  let response;
  try {
    response = await fetch(path, {
      ...options,
      headers: { 'content-type': 'application/json', ...(options.headers ?? {}) }
    });
  } catch {
    throw new Error('Cannot reach the API. Is the server running?');
  }
  const result = await response.json();
  if (!response.ok) throw new Error(result.error ?? `HTTP ${response.status}`);
  return result;
}

const el = (tag, className, text) => {
  const element = document.createElement(tag);
  if (className) element.className = className;
  if (text !== undefined) element.textContent = text; // Never inject untrusted HTML.
  return element;
};

function taskCard(task) {
  const card = el('article', 'task-card');
  const upper = el('div', 'card-upper');
  upper.append(el('span', `priority ${task.priority}`, `${task.priority[0].toUpperCase()}${task.priority.slice(1)} priority`));
  card.append(upper);
  card.append(el('h4', '', task.title));
  card.append(el('p', '', task.description || 'No description provided.'));
  const footer = el('div', 'card-footer');
  const owner = el('span', 'owner');
  const initials = task.owner.split(/\s+/).slice(0, 2).map(word => word[0]?.toUpperCase() || '').join('');
  owner.append(el('span', 'owner-initials', initials || '?'), el('span', '', task.owner));
  footer.append(owner);

  const controls = el('div', 'card-controls');
  const select = el('select', 'status-control');
  select.setAttribute('aria-label', `Move ${task.title} to status`);
  for (const status of STATUS) {
    const option = el('option', '', STATUS_LABELS[status]);
    option.value = status;
    select.append(option);
  }
  select.value = task.status;
  select.addEventListener('change', async () => {
    select.disabled = true;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'PATCH', body: JSON.stringify({ status: select.value, version: task.version }) });
      await loadTasks();
      notify('Task updated');
    } catch (error) {
      notify(error.message, true);
      await loadTasks();
    }
  });
  controls.append(select);
  const remove = el('button', 'delete-button', '×');
  remove.type = 'button';
  remove.setAttribute('aria-label', `Delete ${task.title}`);
  remove.title = 'Delete task';
  remove.addEventListener('click', async () => {
    if (!window.confirm(`Delete "${task.title}"?`)) return;
    try {
      await api(`/api/tasks/${task.id}`, { method: 'DELETE' });
      await loadTasks();
      notify('Task removed');
    } catch (error) { notify(error.message, true); }
  });
  controls.append(remove);
  footer.append(controls);
  card.append(footer);
  return card;
}

function render() {
  const total = state.tasks.length;
  const progress = state.tasks.filter(t => t.status === 'progress').length;
  const completed = state.tasks.filter(t => t.status === 'done').length;
  const percent = total ? Math.round(completed / total * 100) : 0;
  $('#total-count').textContent = String(total);
  $('#progress-count').textContent = String(progress);
  $('#done-count').textContent = String(completed);
  $('#percent-count').textContent = `${percent}%`;
  $('#progress-circle').style.setProperty('--progress', `${percent}%`);
  for (const status of STATUS) {
    const tasks = state.tasks.filter(t => t.status === status
      && (state.priority === 'all' || t.priority === state.priority)
      && `${t.title} ${t.description} ${t.owner}`.toLowerCase().includes(state.filter));
    const list = $(`#${status}-list`);
    list.replaceChildren();
    for (const task of tasks) list.append(taskCard(task));
    if (!tasks.length) list.append(el('div', 'empty-col', (state.filter || state.priority !== 'all') ? 'No matching tasks' : 'No tasks yet'));
    $(`#${status}-column-count`).textContent = String(tasks.length);
  }
}

async function loadTasks() {
  const result = await api('/api/tasks');
  state.tasks = result.tasks;
  render();
}

function showDialog() {
  const dialog = $('#task-dialog');
  dialog.showModal();
  dialog.querySelector('[name=title]').focus();
}

$('#new-task-button').addEventListener('click', showDialog);
document.querySelectorAll('[data-new-task]').forEach(button => button.addEventListener('click', showDialog));
$('#close-dialog').addEventListener('click', () => $('#task-dialog').close());
$('#cancel-task').addEventListener('click', () => $('#task-dialog').close());
$('#search-input').addEventListener('input', event => { state.filter = event.target.value.toLowerCase().trim(); render(); });
function setupPriorityFilter() {
  const search = $('.search-wrap');
  const controls = el('div', 'board-controls');
  const label = el('label', 'priority-filter');
  label.setAttribute('for', 'priority-filter');
  label.append(el('span', 'priority-filter-label', 'Priority'));
  const select = el('select');
  select.id = 'priority-filter';
  for (const [value, text] of PRIORITY_FILTERS) {
    const option = el('option', '', text);
    option.value = value;
    select.append(option);
  }
  select.value = state.priority;
  select.addEventListener('change', () => { state.priority = select.value; render(); });
  label.append(select);
  search.replaceWith(controls);
  controls.append(label, search);
}

setupPriorityFilter();
$('#task-form').addEventListener('submit', async event => {
  event.preventDefault();
  const form = event.currentTarget;
  const values = Object.fromEntries(new FormData(form));
  const submit = form.querySelector('[type=submit]');
  submit.disabled = true;
  try {
    await api('/api/tasks', { method: 'POST', body: JSON.stringify(values) });
    form.reset();
    $('#task-dialog').close();
    await loadTasks();
    notify('Task created');
  } catch (error) { notify(error.message, true); }
  finally { submit.disabled = false; }
});
$('#activity-link').addEventListener('click', event => { event.preventDefault(); notify('Use Concord CLI to inspect agent activity: concord status'); });

loadTasks().catch(error => { notify(error.message, true); });
