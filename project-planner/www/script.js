/* ============================================================
   LIFE PLANNER v3 — Work & Personal Structured Planner
   ============================================================ */

// ── State ────────────────────────────────────────────────────
const STATE_KEY = 'lifeplanner_v3';

let state = {
  tasks: [],
  /* {
      id, name,
      category: 'work' | 'personal',
      type: 'once' | 'routine',
      status: 'pending' | 'inprogress' | 'completed',
      due: 'YYYY-MM-DD' | null,
      priority: 'low'|'medium'|'high'|'urgent',
      notes: '',
      projectId: '',   // work once-tasks only
      goalId: '',      // personal once-tasks only
      repeatDays: [0-6],   // used when type === 'routine'
      createdAt: 'YYYY-MM-DD'
  } */
  projects: [],
  /* { id, name, category:'work'|'personal', color, status, desc, due, createdAt } */
  goals: [],
  /* { id, title, area, desc, due, progress:0-100, createdAt } */
  routineLog: {},
  /* { 'YYYY-MM-DD': { taskId: true } } */
  taskHistory: {}
  /* { 'YYYY-MM-DD': count } */
};

function load() {
  try {
    const s = localStorage.getItem(STATE_KEY);
    if (s) state = { ...state, ...JSON.parse(s) };
  } catch(e) { /* ignore */ }
}
function save() { pruneOldData(); localStorage.setItem(STATE_KEY, JSON.stringify(state)); scheduleReminders(); }

load();

// ── Helpers ───────────────────────────────────────────────────
const uid     = () => Math.random().toString(36).slice(2, 10);
const today   = () => new Date().toISOString().slice(0, 10);
const pad     = n  => String(n).padStart(2, '0');
const DOW_LABELS  = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
const DOW_SHORT   = ['S','M','T','W','T','F','S'];

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}
function isOverdue(due) { return due && due < today(); }

// Record a task completion in history (avoids duplicating this 3-liner)
function recordCompletion() {
  const t = today();
  state.taskHistory[t] = (state.taskHistory[t] || 0) + 1;
}

// Drop log entries older than 90 days to keep localStorage bounded
function pruneOldData() {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - 90);
  const cutoffStr = cutoff.toISOString().slice(0, 10);
  for (const d of Object.keys(state.routineLog))  { if (d < cutoffStr) delete state.routineLog[d];  }
  for (const d of Object.keys(state.taskHistory)) { if (d < cutoffStr) delete state.taskHistory[d]; }
}

// ── Navigation ────────────────────────────────────────────────
const PAGE_TITLES = {
  dashboard: 'Dashboard', work: 'Work',
  personal:  'Personal',  calendar: 'Calendar', routines: 'Routines', settings: 'Settings'
};
let currentPage = 'dashboard';
let editingId   = null;

// Active tab state per page
let workActiveTab     = 'work-tasks';
let personalActiveTab = 'personal-tasks';

// Active filter state
let workTaskFilter     = 'all';
let workTaskSort       = 'created';
let personalTaskFilter = 'all';

function showPage(name) {
  currentPage = name;
  document.querySelectorAll('.page').forEach(p => p.classList.remove('active'));
  document.getElementById(`page-${name}`).classList.add('active');
  document.querySelectorAll('.nav-item').forEach(n =>
    n.classList.toggle('active', n.dataset.page === name)
  );
  document.getElementById('pageTitle').textContent = PAGE_TITLES[name];
  if (name === 'dashboard') renderDashboard();
  if (name === 'work')      renderWork();
  if (name === 'personal')  renderPersonal();
  if (name === 'calendar')  renderCalendar();
  if (name === 'routines')  renderRoutines();
  updateBadges();
}

document.querySelectorAll('[data-page]').forEach(el => {
  el.addEventListener('click', e => { e.preventDefault(); showPage(el.dataset.page); });
});

// Sidebar toggle
const sidebar = document.getElementById('sidebar');
document.getElementById('sidebarToggle').addEventListener('click', () => {
  sidebar.classList.toggle('collapsed');
});
document.getElementById('mobileMenuBtn').addEventListener('click', () => {
  sidebar.classList.toggle('mobile-open');
});
document.addEventListener('click', e => {
  if (window.innerWidth <= 680 &&
      !sidebar.contains(e.target) &&
      !document.getElementById('mobileMenuBtn').contains(e.target)) {
    sidebar.classList.remove('mobile-open');
  }
});

// Topbar date
document.getElementById('topbarDate').textContent =
  new Date().toLocaleDateString('en-US', { weekday:'long', month:'long', day:'numeric' });

// ── Modals ────────────────────────────────────────────────────
const overlay = document.getElementById('modalOverlay');

function openModal(id) {
  overlay.classList.add('open');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  document.getElementById(id).classList.add('open');
}
function closeModal() {
  overlay.classList.remove('open');
  document.querySelectorAll('.modal').forEach(m => m.classList.remove('open'));
  editingId = null;
}
document.querySelectorAll('[data-close]').forEach(btn => {
  btn.addEventListener('click', closeModal);
});
overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });

// ══════════════════════════════════════════════════════════════
//  TASK MODAL
// ══════════════════════════════════════════════════════════════
const taskTypeSelect     = document.getElementById('taskType');
const taskDueField       = document.getElementById('taskDueField');
const taskRepeatField    = document.getElementById('taskRepeatField');
const taskReminderField  = document.getElementById('taskReminderField');
const taskProjectField   = document.getElementById('taskProjectField');
const taskGoalField      = document.getElementById('taskGoalField');
const taskCategorySelect = document.getElementById('taskCategory');

function applyTaskModalConditions() {
  const isRoutine  = taskTypeSelect.value === 'routine';
  const isWork     = taskCategorySelect.value === 'work';
  const isPersonal = !isWork;
  taskDueField.classList.toggle('hidden', isRoutine);
  taskRepeatField.classList.toggle('hidden', !isRoutine);
  taskReminderField.classList.toggle('hidden', !isRoutine);
  // Work + once → show project link; Personal + once → show goal link; Routines → neither
  taskProjectField.classList.toggle('hidden', !(isWork && !isRoutine));
  taskGoalField.classList.toggle('hidden',    !(isPersonal && !isRoutine));
  if (isWork && !isRoutine)     buildProjectDropdown();
  if (isPersonal && !isRoutine) buildGoalDropdown();
}

taskTypeSelect.addEventListener('change', applyTaskModalConditions);
taskCategorySelect.addEventListener('change', applyTaskModalConditions);

document.querySelectorAll('#taskDayPicker .day-btn').forEach(btn => {
  btn.addEventListener('click', () => btn.classList.toggle('active'));
});

function buildDropdown(elId, placeholder, items, labelKey) {
  const sel  = document.getElementById(elId);
  const prev = sel.value;
  sel.innerHTML = `<option value="">${placeholder}</option>`;
  items.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.id; opt.textContent = item[labelKey];
    if (opt.value === prev) opt.selected = true;
    sel.appendChild(opt);
  });
}
function buildProjectDropdown() {
  buildDropdown('taskProject', 'No project', state.projects.filter(p => p.category === 'work'), 'name');
}
function buildGoalDropdown() {
  buildDropdown('taskGoal', 'No goal', state.goals, 'title');
}

function openTaskModal(id = null, defaultCategory = 'work', prefilledDue = null) {
  editingId = id;
  const t = id ? state.tasks.find(x => x.id === id) : null;
  document.getElementById('taskModalTitle').textContent = id ? 'Edit Task' : 'New Task';
  document.getElementById('taskName').value         = t ? t.name : '';
  taskCategorySelect.value                          = t ? t.category : defaultCategory;
  taskTypeSelect.value                              = t ? t.type : 'once';
  document.getElementById('taskDue').value          = t ? (t.due || '') : (prefilledDue || today());
  document.getElementById('taskPriority').value     = t ? t.priority : 'medium';
  document.getElementById('taskStatus').value       = t ? t.status : 'pending';
  document.getElementById('taskNotes').value        = t ? (t.notes || '') : '';

  // Repeat days
  const days = t ? (t.repeatDays || []) : [1,2,3,4,5];
  document.querySelectorAll('#taskDayPicker .day-btn').forEach(btn => {
    btn.classList.toggle('active', days.includes(+btn.dataset.day));
  });

  buildProjectDropdown();
  buildGoalDropdown();
  document.getElementById('taskProject').value     = t ? (t.projectId    || '') : '';
  document.getElementById('taskGoal').value        = t ? (t.goalId       || '') : '';
  document.getElementById('taskReminderTime').value = t ? (t.reminderTime || '') : '';

  applyTaskModalConditions();
  openModal('taskModal');
  setTimeout(() => document.getElementById('taskName').focus(), 50);
}

document.getElementById('saveTaskBtn').addEventListener('click', () => {
  const name = document.getElementById('taskName').value.trim();
  if (!name) { document.getElementById('taskName').focus(); return; }

  const type     = taskTypeSelect.value;
  const category = taskCategorySelect.value;
  const newStatus = document.getElementById('taskStatus').value;

  const repeatDays = type === 'routine'
    ? [...document.querySelectorAll('#taskDayPicker .day-btn.active')].map(b => +b.dataset.day)
    : [];

  const data = {
    name, category, type, status: newStatus,
    priority:     document.getElementById('taskPriority').value,
    notes:        document.getElementById('taskNotes').value,
    due:          type === 'once' ? document.getElementById('taskDue').value : null,
    projectId:    category === 'work'     ? document.getElementById('taskProject').value : '',
    goalId:       category === 'personal' ? document.getElementById('taskGoal').value    : '',
    reminderTime: type === 'routine'      ? document.getElementById('taskReminderTime').value : '',
    repeatDays
  };

  if (editingId) {
    const old = state.tasks.find(t => t.id === editingId);
    if (old.status !== 'completed' && newStatus === 'completed') recordCompletion();
    Object.assign(old, data);
  } else {
    state.tasks.push({ id: uid(), createdAt: today(), ...data });
  }

  save(); closeModal(); rerenderCurrent(); updateBadges();
});

// Quick add buttons
document.getElementById('quickAddBtn').addEventListener('click', () => openTaskModal(null, 'work'));
document.getElementById('quickAddWorkBtn').addEventListener('click',     () => openTaskModal(null, 'work'));
document.getElementById('quickAddPersonalBtn').addEventListener('click', () => openTaskModal(null, 'personal'));

// Cycle task status on click (pending → inprogress → completed → pending)
function cycleTaskStatus(id) {
  const t = state.tasks.find(x => x.id === id);
  if (!t) return;
  const cycle = { pending: 'inprogress', inprogress: 'completed', completed: 'pending' };
  const oldStatus = t.status;
  t.status = cycle[t.status];
  if (oldStatus !== 'completed' && t.status === 'completed') recordCompletion();
  save(); rerenderCurrent(); updateBadges();
}

function deleteTask(id) {
  state.tasks = state.tasks.filter(t => t.id !== id);
  save(); rerenderCurrent(); updateBadges();
}

// ── Render a task row ─────────────────────────────────────────
function makeTaskRow(t, showCat = false) {
  const proj = t.projectId ? state.projects.find(p => p.id === t.projectId) : null;
  const goal = t.goalId    ? state.goals.find(g => g.id === t.goalId)        : null;
  const done = t.status === 'completed';
  const over = !done && isOverdue(t.due);

  const row = document.createElement('div');
  row.className = `task-row${t.status === 'pending' ? ' is-pending' : t.status === 'inprogress' ? ' is-inprogress' : ''}`;

  const catPill = showCat
    ? `<span class="cat-pill cat-pill-${t.category}">${t.category}</span>`
    : '';
  const projTag = proj
    ? `<span class="proj-tag" style="background:${proj.color}22;color:${proj.color}">◫ ${proj.name}</span>`
    : '';
  const goalTag = goal
    ? `<span class="proj-tag" style="background:rgba(139,92,246,0.15);color:var(--purple)">◎ ${goal.title}</span>`
    : '';
  const dueStr = t.due
    ? `<span class="task-row-due${over?' overdue':''}">${over?'⚠ ':''}${fmtDate(t.due)}</span>`
    : '';
  const typeIcon = t.type === 'routine' ? '<span style="color:var(--green);font-size:11px">↺</span>' : '';

  row.innerHTML = `
    <div class="task-status-btn ${t.status}" title="Click to advance status"></div>
    <span class="task-row-name${done?' done':''}">${t.name} ${typeIcon}</span>
    <div class="task-row-meta">
      ${catPill}
      ${projTag}${goalTag}
      <span class="status-badge sb-${t.status}">${t.status}</span>
      <span class="priority-badge pb-${t.priority}">${t.priority}</span>
      ${dueStr}
    </div>
    <button class="task-row-del" title="Delete">✕</button>
  `;
  row.querySelector('.task-status-btn').addEventListener('click', e => {
    e.stopPropagation(); cycleTaskStatus(t.id);
  });
  row.querySelector('.task-row-del').addEventListener('click', e => {
    e.stopPropagation(); deleteTask(t.id);
  });
  row.addEventListener('click', () => openTaskModal(t.id));
  return row;
}

function renderTaskList(el, tasks) {
  el.innerHTML = '';
  if (!tasks.length) {
    el.innerHTML = '<div class="task-empty">No tasks here</div>';
    return;
  }
  tasks.forEach(t => el.appendChild(makeTaskRow(t)));
}

function filterAndSortTasks(tasks, filter, sort) {
  let list = tasks.filter(t => t.type === 'once'); // routines shown in Routines page
  if (filter === 'pending')    list = list.filter(t => t.status === 'pending');
  if (filter === 'inprogress') list = list.filter(t => t.status === 'inprogress');
  if (filter === 'completed')  list = list.filter(t => t.status === 'completed');
  if (sort === 'due')      list.sort((a,b) => (a.due||'9999') > (b.due||'9999') ? 1 : -1);
  if (sort === 'priority') {
    const ord = { urgent:0, high:1, medium:2, low:3 };
    list.sort((a,b) => ord[a.priority] - ord[b.priority]);
  }
  // Always put pending first within groups
  const statusOrd = { pending:0, inprogress:1, completed:2 };
  if (filter === 'all') list.sort((a,b) => statusOrd[a.status] - statusOrd[b.status]);
  return list;
}

// ══════════════════════════════════════════════════════════════
//  WORK PAGE
// ══════════════════════════════════════════════════════════════
function setupTabGroup(groupId, panelPrefix, onSwitch) {
  document.querySelectorAll(`#${groupId} .tab-btn`).forEach(btn => {
    btn.addEventListener('click', () => {
      document.querySelectorAll(`#${groupId} .tab-btn`).forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      const tabId = btn.dataset.tab;
      document.querySelectorAll(`[id^="${panelPrefix}-tab-"]`).forEach(p => p.classList.remove('active'));
      document.getElementById(`${panelPrefix}-tab-${tabId.replace(`${panelPrefix}-`,'')}`).classList.add('active');
      onSwitch(tabId);
    });
  });
}

setupTabGroup('workTabGroup', 'work', tabId => {
  workActiveTab = tabId;
  renderWork();
});
setupTabGroup('personalTabGroup', 'personal', tabId => {
  personalActiveTab = tabId;
  renderPersonal();
});

// Shared filter-tab setup — avoids duplicating the activate-and-callback pattern
function setupFilterTabs(containerId, onFilter) {
  const btns = document.querySelectorAll(`#${containerId} .filter-tab`);
  btns.forEach(btn => {
    btn.addEventListener('click', () => {
      btns.forEach(b => b.classList.remove('active'));
      btn.classList.add('active');
      onFilter(btn.dataset.filter);
    });
  });
}

setupFilterTabs('workTaskFilter',     f => { workTaskFilter     = f; renderWork();     });
setupFilterTabs('personalTaskFilter', f => { personalTaskFilter = f; renderPersonal(); });

document.getElementById('workTaskSort').addEventListener('change', e => {
  workTaskSort = e.target.value; renderWork();
});

// Add buttons
document.getElementById('addWorkItemBtn').addEventListener('click', () => {
  if (workActiveTab === 'work-projects') openProjectModal(null, 'work');
  else openTaskModal(null, 'work');
});
document.getElementById('addPersonalItemBtn').addEventListener('click', () => {
  if (personalActiveTab === 'personal-goals') openGoalModal();
  else openTaskModal(null, 'personal');
});

function renderWork() {
  // Tasks
  const workTasks = filterAndSortTasks(
    state.tasks.filter(t => t.category === 'work'),
    workTaskFilter, workTaskSort
  );
  renderTaskList(document.getElementById('workTaskList'), workTasks);

  // Projects
  renderProjectList(document.getElementById('workProjectCard'), 'work');
}

function renderPersonal() {
  // Tasks
  const personalTasks = filterAndSortTasks(
    state.tasks.filter(t => t.category === 'personal'),
    personalTaskFilter, 'created'
  );
  renderTaskList(document.getElementById('personalTaskList'), personalTasks);

  // Goals
  renderGoalGrid(document.getElementById('personalGoalsGrid'));
}

// ══════════════════════════════════════════════════════════════
//  PROJECTS
// ══════════════════════════════════════════════════════════════
function openProjectModal(id = null, defaultCategory = 'work') {
  editingId = id;
  const p = id ? state.projects.find(x => x.id === id) : null;
  document.getElementById('projectModalTitle').textContent = id ? 'Edit Project' : 'New Project';
  document.getElementById('projectName').value     = p ? p.name : '';
  document.getElementById('projectCategory').value = p ? p.category : defaultCategory;
  document.getElementById('projectColor').value    = p ? p.color : '#3b82f6';
  document.getElementById('projectStatus').value   = p ? p.status : 'active';
  document.getElementById('projectDue').value      = p ? (p.due || '') : '';
  document.getElementById('projectDesc').value     = p ? (p.desc || '') : '';
  openModal('projectModal');
}

document.getElementById('saveProjectBtn').addEventListener('click', () => {
  const name = document.getElementById('projectName').value.trim();
  if (!name) return;
  const data = {
    name,
    category: document.getElementById('projectCategory').value,
    color:    document.getElementById('projectColor').value,
    status:   document.getElementById('projectStatus').value,
    due:      document.getElementById('projectDue').value,
    desc:     document.getElementById('projectDesc').value,
  };
  if (editingId) {
    Object.assign(state.projects.find(p => p.id === editingId), data);
  } else {
    state.projects.push({ id: uid(), createdAt: today(), ...data });
  }
  save(); closeModal(); rerenderCurrent(); updateBadges();
});

function deleteProject(id) {
  state.projects = state.projects.filter(p => p.id !== id);
  state.tasks.forEach(t => { if (t.projectId === id) t.projectId = ''; });
  save(); rerenderCurrent();
}

function projectProgress(id) {
  const tasks = state.tasks.filter(t => t.projectId === id && t.type === 'once');
  if (!tasks.length) return 0;
  return Math.round(tasks.filter(t => t.status === 'completed').length / tasks.length * 100);
}

// Returns auto-calculated % if linked tasks exist, else null (fall back to manual slider)
function goalProgress(id) {
  const tasks = state.tasks.filter(t => t.goalId === id && t.type === 'once');
  if (!tasks.length) return null;
  return Math.round(tasks.filter(t => t.status === 'completed').length / tasks.length * 100);
}

function renderProjectList(el, category) {
  const projs = state.projects.filter(p => p.category === category);
  el.innerHTML = '';
  if (!projs.length) {
    el.innerHTML = '<div class="task-empty">No projects yet</div>';
    return;
  }
  projs.forEach(p => {
    const pct = projectProgress(p.id);
    const row = document.createElement('div');
    row.className = 'project-list-row';
    row.innerHTML = `
      <div class="project-color-bar" style="background:${p.color}"></div>
      <div class="project-info">
        <div class="project-name">${p.name}</div>
        <div class="project-desc">${p.desc || 'No description'}</div>
      </div>
      <div class="project-progress-wrap">
        <div class="project-progress-label"><span>Progress</span><span>${pct}%</span></div>
        <div class="project-progress-bar">
          <div class="project-progress-fill" style="width:${pct}%;background:${p.color}"></div>
        </div>
      </div>
      <span class="project-status-badge ps-${p.status}">${p.status}</span>
      <button class="project-del-btn" title="Delete">✕</button>
    `;
    row.querySelector('.project-del-btn').addEventListener('click', e => { e.stopPropagation(); deleteProject(p.id); });
    row.addEventListener('click', () => openProjectModal(p.id));
    el.appendChild(row);
  });
}

// ══════════════════════════════════════════════════════════════
//  GOALS
// ══════════════════════════════════════════════════════════════
const goalSlider = document.getElementById('goalProgress');
const goalSliderVal = document.getElementById('goalProgressVal');
goalSlider.addEventListener('input', () => { goalSliderVal.textContent = goalSlider.value + '%'; });

function openGoalModal(id = null) {
  editingId = id;
  const g = id ? state.goals.find(x => x.id === id) : null;
  document.getElementById('goalModalTitle').textContent = id ? 'Edit Goal' : 'New Goal';
  document.getElementById('goalTitle').value = g ? g.title : '';
  document.getElementById('goalArea').value  = g ? (g.area || 'personal') : 'personal';
  document.getElementById('goalDue').value   = g ? (g.due || '') : '';
  document.getElementById('goalDesc').value  = g ? (g.desc || '') : '';
  goalSlider.value = g ? g.progress : 0;
  goalSliderVal.textContent = (g ? g.progress : 0) + '%';
  openModal('goalModal');
}

document.getElementById('saveGoalBtn').addEventListener('click', () => {
  const title = document.getElementById('goalTitle').value.trim();
  if (!title) return;
  const data = {
    title,
    area:     document.getElementById('goalArea').value,
    due:      document.getElementById('goalDue').value,
    desc:     document.getElementById('goalDesc').value,
    progress: +goalSlider.value,
  };
  if (editingId) {
    Object.assign(state.goals.find(g => g.id === editingId), data);
  } else {
    state.goals.push({ id: uid(), createdAt: today(), ...data });
  }
  save(); closeModal(); rerenderCurrent();
});

function renderGoalGrid(el) {
  el.innerHTML = '';
  if (!state.goals.length) {
    el.innerHTML = '<div class="task-empty" style="width:100%">No goals yet. Add your first goal!</div>';
    return;
  }
  state.goals.forEach(g => {
    const autoPct = goalProgress(g.id);
    const pct     = autoPct ?? g.progress;
    const autoTag = autoPct !== null ? '<span class="auto-progress-tag">auto</span>' : '';
    const card = document.createElement('div');
    card.className = 'goal-card';
    card.innerHTML = `
      <div class="goal-actions">
        <button class="goal-action-btn edit-btn">✎</button>
        <button class="goal-action-btn del">✕</button>
      </div>
      <span class="goal-area-badge area-${g.area}">${g.area}</span>
      <div class="goal-title">${g.title}</div>
      <div class="goal-desc">${g.desc || ''}</div>
      <div class="goal-progress-label"><span>Progress${autoTag}</span><span>${pct}%</span></div>
      <div class="goal-progress-bar">
        <div class="goal-progress-fill" style="width:${pct}%"></div>
      </div>
      ${g.due ? `<div class="goal-due">Target: ${fmtDate(g.due)}</div>` : ''}
    `;
    card.querySelector('.edit-btn').addEventListener('click', e => { e.stopPropagation(); openGoalModal(g.id); });
    card.querySelector('.del').addEventListener('click', e => {
      e.stopPropagation();
      state.goals = state.goals.filter(x => x.id !== g.id);
      state.tasks.forEach(t => { if (t.goalId === g.id) t.goalId = ''; });
      save(); renderGoalGrid(el);
    });
    el.appendChild(card);
  });
}

// ══════════════════════════════════════════════════════════════
//  UPCOMING TASKS (next 7 days)
// ══════════════════════════════════════════════════════════════
function renderUpcoming() {
  const t = today();
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 7);
  const endStr = endDate.toISOString().slice(0, 10);

  const upcoming = state.tasks
    .filter(task => task.type === 'once' && task.status !== 'completed' && task.due)
    .filter(task => task.due >= t && task.due <= endStr)
    .sort((a, b) => a.due > b.due ? 1 : -1);

  const badge = document.getElementById('upcomingCount');
  badge.textContent = upcoming.length || '';

  const el = document.getElementById('dashUpcoming');
  el.innerHTML = '';
  if (!upcoming.length) {
    el.innerHTML = '<div class="empty-hint">No tasks due in the next 7 days ✓</div>';
    return;
  }
  upcoming.forEach(task => {
    const d = document.createElement('div');
    d.className = 'dash-item';
    d.style.cursor = 'pointer';
    d.innerHTML = `
      <span class="cat-pill cat-pill-${task.category}">${task.category}</span>
      <span class="dash-item-text">${task.name}</span>
      <span class="priority-badge pb-${task.priority}">${task.priority}</span>
      <span class="dash-item-sub${task.due === t ? ' overdue' : ''}">${fmtDate(task.due)}</span>
    `;
    d.addEventListener('click', () => openTaskModal(task.id));
    el.appendChild(d);
  });
}

// ══════════════════════════════════════════════════════════════
//  WEEKLY HABIT GRID
// ══════════════════════════════════════════════════════════════
function calcStreak(task) {
  if (!task.repeatDays.length) return 0;
  let streak = 0;
  const d = new Date();
  for (let i = 0; i < 365; i++) {
    const ds  = d.toISOString().slice(0, 10);
    const dow = d.getDay();
    if (task.repeatDays.includes(dow)) {
      if (state.routineLog[ds]?.[task.id]) streak++;
      else break;
    }
    d.setDate(d.getDate() - 1);
  }
  return streak;
}

function renderHabitGrid() {
  const el = document.getElementById('dashHabitGrid');
  const routines = state.tasks.filter(t => t.type === 'routine');

  if (!routines.length) {
    el.innerHTML = '<div class="empty-hint">No routines yet — add routines to track habits here</div>';
    return;
  }

  const now = new Date();
  const weekDates = [];
  for (let i = 0; i < 7; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() - now.getDay() + i); // Sun=0 … Sat=6
    weekDates.push(d.toISOString().slice(0, 10));
  }
  const todayStr = today();

  const grid = document.createElement('div');
  grid.className = 'habit-grid';

  // Header row
  const headerRow = document.createElement('div');
  headerRow.className = 'habit-row habit-header';
  headerRow.innerHTML = `
    <div class="habit-name-col"></div>
    ${weekDates.map((d, i) => `
      <div class="habit-day-col${d === todayStr ? ' habit-today-col' : ''}">
        <div>${DOW_SHORT[i]}</div>
        <div class="habit-day-date">${+d.slice(8)}</div>
      </div>`).join('')}
    <div class="habit-stat-label">Streak</div>
    <div class="habit-stat-label">Week</div>
  `;
  grid.appendChild(headerRow);

  routines.forEach(t => {
    const streak = calcStreak(t);
    const scheduledInWeek = weekDates.filter((_, i) => t.repeatDays.includes(i));
    const pastScheduled   = scheduledInWeek.filter(d => d <= todayStr);
    const loggedInWeek    = pastScheduled.filter(d => state.routineLog[d]?.[t.id]);
    const weekPct = pastScheduled.length
      ? Math.round(loggedInWeek.length / pastScheduled.length * 100)
      : 0;

    const row = document.createElement('div');
    row.className = 'habit-row';

    const cells = weekDates.map((d, i) => {
      const scheduled = t.repeatDays.includes(i);
      const isFuture  = d > todayStr;
      const logged    = !!(state.routineLog[d]?.[t.id]);
      const isToday   = d === todayStr;

      let cls = 'habit-cell';
      let content = '';
      if (!scheduled) {
        cls += ' habit-unscheduled'; content = '·';
      } else if (isFuture) {
        cls += ' habit-future'; content = '○';
      } else if (logged) {
        cls += ' habit-logged'; content = '✓';
      } else {
        cls += ' habit-missed'; content = '○';
      }
      if (isToday) cls += ' habit-today-cell';

      return `<div class="${cls}" data-task="${t.id}" data-date="${d}" data-scheduled="${scheduled && !isFuture}">${content}</div>`;
    }).join('');

    row.innerHTML = `
      <div class="habit-name-col">${t.name}</div>
      ${cells}
      <div class="habit-stat-col"><span class="streak-val">${streak > 0 ? streak + '🔥' : '—'}</span></div>
      <div class="habit-stat-col">${weekPct}%</div>
    `;

    row.querySelectorAll('.habit-cell[data-scheduled="true"]').forEach(cell => {
      cell.addEventListener('click', () => {
        const dateKey = cell.dataset.date;
        const taskId  = cell.dataset.task;
        if (!state.routineLog[dateKey]) state.routineLog[dateKey] = {};
        state.routineLog[dateKey][taskId] = !state.routineLog[dateKey][taskId];
        save(); renderDashboard();
      });
    });

    grid.appendChild(row);
  });

  el.innerHTML = '';
  el.appendChild(grid);
}

// ══════════════════════════════════════════════════════════════
//  DASHBOARD
// ══════════════════════════════════════════════════════════════
function renderDashboard() {
  ['work','personal'].forEach(cat => {
    const catTasks     = state.tasks.filter(t => t.category === cat && t.type === 'once');
    const pendingTasks = catTasks.filter(t => t.status === 'pending');
    const inprogress   = catTasks.filter(t => t.status === 'inprogress').length;
    const completed    = catTasks.filter(t => t.status === 'completed').length;

    document.getElementById(`${cat}-pending-count`).textContent  = pendingTasks.length;
    document.getElementById(`${cat}-inprog-count`).textContent   = inprogress;
    document.getElementById(`${cat}-done-count`).textContent     = completed;

    // Pending list
    const pendingEl = document.getElementById(`dash-${cat}-pending`);
    pendingEl.innerHTML = '';
    if (!pendingTasks.length) {
      pendingEl.innerHTML = '<div class="empty-hint">All clear ✓</div>';
    } else {
      pendingTasks.slice(0, 6).forEach(t => {
        const d = document.createElement('div');
        d.className = 'dash-item';
        d.innerHTML = `
          <span class="priority-badge pb-${t.priority}">${t.priority}</span>
          <span class="dash-item-text">${t.name}</span>
          ${t.due ? `<span class="dash-item-sub${isOverdue(t.due)?' overdue':''}">${fmtDate(t.due)}</span>` : ''}
        `;
        d.style.cursor = 'pointer';
        d.addEventListener('click', () => openTaskModal(t.id));
        pendingEl.appendChild(d);
      });
    }
  });

  // Work projects
  const wpEl = document.getElementById('dash-work-projects');
  wpEl.innerHTML = '';
  const wProjs = state.projects.filter(p => p.category === 'work' && p.status === 'active').slice(0, 4);
  if (!wProjs.length) {
    wpEl.innerHTML = '<div class="empty-hint">No active projects</div>';
  } else {
    wProjs.forEach(p => {
      const pct = projectProgress(p.id);
      const d = document.createElement('div');
      d.className = 'dash-item';
      d.style.flexDirection = 'column';
      d.style.alignItems = 'flex-start';
      d.innerHTML = `
        <div style="display:flex;align-items:center;gap:8px;width:100%">
          <span style="width:8px;height:8px;border-radius:50%;background:${p.color};flex-shrink:0;display:inline-block"></span>
          <span class="dash-item-text">${p.name}</span>
          <span class="dash-item-sub">${pct}%</span>
        </div>
        <div class="dash-proj-bar"><div class="dash-proj-fill" style="width:${pct}%;background:${p.color}"></div></div>
      `;
      wpEl.appendChild(d);
    });
  }

  // Personal goals
  const pgEl = document.getElementById('dash-personal-goals');
  pgEl.innerHTML = '';
  const goals = state.goals.slice(0, 4);
  if (!goals.length) {
    pgEl.innerHTML = '<div class="empty-hint">No goals yet</div>';
  } else {
    goals.forEach(g => {
      const pct = goalProgress(g.id) ?? g.progress;
      const d = document.createElement('div');
      d.className = 'dash-item';
      d.innerHTML = `
        <span class="goal-area-badge area-${g.area}" style="margin:0">${g.area}</span>
        <span class="dash-item-text">${g.title}</span>
        <span class="dash-item-sub">${pct}%</span>
      `;
      pgEl.appendChild(d);
    });
  }

  renderUpcoming();
  renderHabitGrid();
}

// ══════════════════════════════════════════════════════════════
//  CALENDAR
// ══════════════════════════════════════════════════════════════
const calState = {
  year:  new Date().getFullYear(),
  month: new Date().getMonth()
};

const MONTH_NAMES = ['January','February','March','April','May','June',
                     'July','August','September','October','November','December'];

// Build day headers once
const calDayHeadersEl = document.getElementById('calDayHeaders');
DOW_LABELS.forEach(l => {
  const d = document.createElement('div');
  d.className = 'cal-day-header';
  d.textContent = l.slice(0,1);
  calDayHeadersEl.appendChild(d);
});

function getCalDays(year, month) {
  const firstDOW    = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const prevDays    = new Date(year, month, 0).getDate();
  const cells = [];

  for (let i = firstDOW - 1; i >= 0; i--) {
    const d = prevDays - i;
    const m = month === 0 ? 12 : month;
    const y = month === 0 ? year - 1 : year;
    cells.push({ dateStr: `${y}-${pad(m)}-${pad(d)}`, current: false });
  }
  for (let d = 1; d <= daysInMonth; d++) {
    cells.push({ dateStr: `${year}-${pad(month+1)}-${pad(d)}`, current: true });
  }
  let next = 1;
  while (cells.length < 42) {
    const m = month === 11 ? 1 : month + 2;
    const y = month === 11 ? year + 1 : year;
    cells.push({ dateStr: `${y}-${pad(m)}-${pad(next++)}`, current: false });
  }
  return cells;
}

function getTasksForDay(dateStr) {
  const dow = new Date(dateStr + 'T00:00:00').getDay();
  const onceTasks    = state.tasks.filter(t => t.type === 'once' && t.due === dateStr);
  const routineTasks = state.tasks.filter(t => t.type === 'routine' && t.repeatDays.includes(dow));
  return [...onceTasks, ...routineTasks];
}

function renderCalendar() {
  document.getElementById('calMonthLabel').textContent =
    `${MONTH_NAMES[calState.month]} ${calState.year}`;

  const todayStr = today();
  const grid     = document.getElementById('calGrid');
  grid.innerHTML = '';

  // Pre-group tasks: once-tasks by date, routines by DOW
  const onceByDate = {};
  const routineByDow = {};
  state.tasks.forEach(t => {
    if (t.type === 'once' && t.due) {
      (onceByDate[t.due] ??= []).push(t);
    } else if (t.type === 'routine') {
      t.repeatDays.forEach(d => (routineByDow[d] ??= []).push(t));
    }
  });

  getCalDays(calState.year, calState.month).forEach(({ dateStr, current }) => {
    const dayNum  = +dateStr.slice(8);
    const dow     = new Date(dateStr + 'T00:00:00').getDay();
    const tasks   = [...(onceByDate[dateStr] || []), ...(routineByDow[dow] || [])];
    const isToday = dateStr === todayStr;

    const cell = document.createElement('div');
    cell.className = `cal-cell${!current?' other-month':''}${isToday?' today':''}`;

    const workDots     = tasks.filter(t => t.category === 'work' && t.type === 'once').slice(0, 2);
    const personalDots = tasks.filter(t => t.category === 'personal' && t.type === 'once').slice(0, 2);
    const routineDots  = tasks.filter(t => t.type === 'routine').slice(0, 2);

    const makeDots = (arr, cls) => arr.map(() => `<div class="cal-task-dot ${cls}"></div>`).join('');

    cell.innerHTML = `
      <div class="cal-cell-num">${dayNum}</div>
      <div class="cal-task-dots">
        ${makeDots(workDots, 'work-dot')}
        ${makeDots(personalDots, 'personal-dot')}
        ${makeDots(routineDots, 'routine-dot')}
      </div>
    `;

    cell.addEventListener('click', () => showDayDetail(dateStr));
    grid.appendChild(cell);
  });

  // Close detail panel when switching months
  document.getElementById('calDayDetail').classList.remove('open');
}

function showDayDetail(dateStr) {
  calDetailDateStr = dateStr;
  const tasks   = getTasksForDay(dateStr);
  const detailEl = document.getElementById('calDayDetail');
  const listEl   = document.getElementById('calDayDetailList');
  const titleEl  = document.getElementById('calDayDetailTitle');

  titleEl.textContent = new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric'
  });
  listEl.innerHTML = '';

  if (!tasks.length) {
    listEl.innerHTML = '<div class="task-empty">No tasks on this day</div>';
  } else {
    tasks.forEach(t => listEl.appendChild(makeTaskRow(t, true)));
  }
  detailEl.classList.add('open');
}

document.getElementById('calDayDetailClose').addEventListener('click', () => {
  document.getElementById('calDayDetail').classList.remove('open');
});

let calDetailDateStr = null;

document.getElementById('calDayAddBtn').addEventListener('click', () => {
  if (calDetailDateStr) openTaskModal(null, 'work', calDetailDateStr);
});

function navigateMonth(delta) {
  calState.month += delta;
  if (calState.month < 0)  { calState.month = 11; calState.year--; }
  if (calState.month > 11) { calState.month = 0;  calState.year++; }
  renderCalendar();
}
document.getElementById('calPrevBtn').addEventListener('click', () => navigateMonth(-1));
document.getElementById('calNextBtn').addEventListener('click', () => navigateMonth(1));

// ══════════════════════════════════════════════════════════════
//  ROUTINES
// ══════════════════════════════════════════════════════════════
document.getElementById('addRoutineBtn').addEventListener('click', () => {
  openTaskModal(null, 'work');
  // Pre-select routine type
  taskTypeSelect.value = 'routine';
  applyTaskModalConditions();
});

function toggleRoutineLog(taskId) {
  const t = today();
  if (!state.routineLog[t]) state.routineLog[t] = {};
  state.routineLog[t][taskId] = !state.routineLog[t][taskId];
  save(); renderRoutines(); updateBadges();
}

function renderRoutines() {
  const todayDOW = new Date().getDay();

  // DOW toolbar row
  const dowRow = document.getElementById('routineDOWRow');
  dowRow.innerHTML = '';
  DOW_LABELS.forEach((label, i) => {
    const pill = document.createElement('div');
    pill.className = `dow-pill${i === todayDOW ? ' today-dow' : ''}`;
    pill.textContent = label.slice(0, 3);
    dowRow.appendChild(pill);
  });

  const routines  = state.tasks.filter(t => t.type === 'routine');
  const todayStr  = today(); // cache — used inside inner loop
  const sectionsEl = document.getElementById('routinesSections');
  sectionsEl.innerHTML = '';

  if (!routines.length) {
    sectionsEl.innerHTML = '<div class="task-empty">No routines yet. Create one with "+ New Routine"</div>';
    return;
  }

  ['work','personal'].forEach(cat => {
    const catRoutines = routines.filter(t => t.category === cat);
    if (!catRoutines.length) return;

    const section = document.createElement('div');
    section.className = 'routine-section';
    section.innerHTML = `<div class="routine-section-label">${cat === 'work' ? '◫ WORK' : '◎ PERSONAL'} ROUTINES</div>`;

    const cards = document.createElement('div');
    cards.className = 'routine-cards';

    catRoutines.forEach(t => {
      const scheduledToday = t.repeatDays.includes(todayDOW);
      const logged = !!(state.routineLog[todayStr]?.[t.id]); // use cached value

      const card = document.createElement('div');
      card.className = `routine-card${scheduledToday ? ' today-active' : ''}`;

      const pips = DOW_SHORT.map((lbl, i) => {
        const isScheduled = t.repeatDays.includes(i);
        const isToday     = i === todayDOW;
        const cls = [
          'routine-dow-pip',
          isScheduled ? 'scheduled' : '',
          isToday     ? 'today-marker' : ''
        ].filter(Boolean).join(' ');
        return `<div class="${cls}">${lbl}</div>`;
      }).join('');

      const reminderTag = t.reminderTime
        ? `<span class="reminder-tag">⏰ ${t.reminderTime}</span>`
        : '';
      card.innerHTML = `
        <div class="routine-card-info">
          <div class="routine-card-name">${t.name}
            <span class="cat-pill cat-pill-${t.category}" style="margin-left:6px">${t.category}</span>
            <span class="status-badge sb-${t.status}" style="margin-left:4px">${t.status}</span>
            ${reminderTag}
          </div>
          <div class="routine-dow-pips">${pips}</div>
        </div>
        <button class="routine-log-btn${logged ? ' logged' : ''}" title="${logged?'Logged today':'Mark done today'}">
          ${logged ? '✓' : '○'}
        </button>
        <button class="routine-del-btn" title="Delete">✕</button>
      `;
      card.querySelector('.routine-log-btn').addEventListener('click', e => {
        e.stopPropagation(); toggleRoutineLog(t.id);
      });
      card.querySelector('.routine-del-btn').addEventListener('click', e => {
        e.stopPropagation(); deleteTask(t.id);
      });
      card.addEventListener('click', () => openTaskModal(t.id));
      cards.appendChild(card);
    });

    section.appendChild(cards);
    sectionsEl.appendChild(section);
  });
}

// ══════════════════════════════════════════════════════════════
//  CSV IMPORT / EXPORT
// ══════════════════════════════════════════════════════════════
function downloadCsvTemplate() {
  const rows = [
    'name,category,type,status,due,priority,project,goal,repeatDays,notes',
    'Write quarterly report,work,once,pending,2025-04-01,high,My Project,,,Add charts and tables',
    'Review pull requests,work,once,pending,2025-03-20,medium,,,,',
    'Morning workout,personal,routine,pending,,medium,,,1 2 3 4 5,30 min cardio',
    'Read book,personal,once,pending,2025-03-31,low,,Health Goal,,15 pages per day',
  ];
  const blob = new Blob([rows.join('\n')], { type: 'text/csv' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url; a.download = 'lifeplanner-tasks-template.csv';
  a.click(); URL.revokeObjectURL(url);
}

function importCsvFile(file) {
  const reader = new FileReader();
  reader.onload = e => {
    const lines = e.target.result.replace(/\r/g, '').split('\n').filter(l => l.trim());
    if (lines.length < 2) { alert('CSV appears empty or has no data rows.'); return; }

    const headers = lines[0].split(',').map(h => h.trim().toLowerCase());
    const get = (vals, key) => (vals[headers.indexOf(key)] || '').trim();

    let imported = 0;
    for (let i = 1; i < lines.length; i++) {
      const vals     = lines[i].split(',');
      const name     = get(vals, 'name');
      if (!name) continue;

      const category = ['work','personal'].includes(get(vals,'category')) ? get(vals,'category') : 'work';
      const type     = ['once','routine'].includes(get(vals,'type'))       ? get(vals,'type')     : 'once';
      const status   = ['pending','inprogress','completed'].includes(get(vals,'status')) ? get(vals,'status') : 'pending';
      const priority = ['low','medium','high','urgent'].includes(get(vals,'priority'))   ? get(vals,'priority') : 'medium';

      const projName = get(vals, 'project');
      const goalName = get(vals, 'goal');
      const proj = projName ? state.projects.find(p => p.name.toLowerCase() === projName.toLowerCase()) : null;
      const goal = goalName ? state.goals.find(g => g.title.toLowerCase() === goalName.toLowerCase()) : null;

      const rdRaw = get(vals, 'repeatdays');
      const repeatDays = type === 'routine'
        ? rdRaw.split(/[\s,]+/).map(Number).filter(n => n >= 0 && n <= 6)
        : [];

      state.tasks.push({
        id: uid(), createdAt: today(), name, category, type, status, priority,
        due:       type === 'once' ? (get(vals,'due') || null) : null,
        notes:     get(vals, 'notes'),
        projectId: proj ? proj.id : '',
        goalId:    goal ? goal.id : '',
        repeatDays: (type === 'routine' && !repeatDays.length) ? [1,2,3,4,5] : repeatDays,
      });
      imported++;
    }
    if (imported > 0) {
      save(); rerenderCurrent(); updateBadges();
      alert(`✓ Imported ${imported} task${imported !== 1 ? 's' : ''}.`);
    } else {
      alert('No valid tasks found in the CSV.');
    }
  };
  reader.readAsText(file);
}

document.getElementById('csvTemplateBtn').addEventListener('click', downloadCsvTemplate);
document.getElementById('csvImportBtn').addEventListener('click', () => {
  document.getElementById('csvFileInput').click();
});
document.getElementById('csvFileInput').addEventListener('change', e => {
  if (e.target.files[0]) { importCsvFile(e.target.files[0]); e.target.value = ''; }
});

// ══════════════════════════════════════════════════════════════
//  SETTINGS PAGE
// ══════════════════════════════════════════════════════════════
document.getElementById('exportJsonBtn').addEventListener('click', () => {
  const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
  const url  = URL.createObjectURL(blob);
  const a    = document.createElement('a');
  a.href = url;
  a.download = `planner-backup-${today()}.json`;
  a.click();
  URL.revokeObjectURL(url);
});

document.getElementById('importJsonBtn').addEventListener('click', () => {
  document.getElementById('jsonFileInput').click();
});

document.getElementById('jsonFileInput').addEventListener('change', e => {
  const file = e.target.files[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = ev => {
    try {
      const imported = JSON.parse(ev.target.result);
      if (!imported.tasks || !imported.projects) { alert('Invalid backup file.'); return; }
      if (!confirm('This will replace ALL current data. Continue?')) return;
      state = { ...state, ...imported };
      save(); rerenderCurrent(); updateBadges();
      alert('✓ Data restored successfully.');
    } catch { alert('Could not read the file. Make sure it is a valid Planner backup.'); }
  };
  reader.readAsText(file);
  e.target.value = '';
});

document.getElementById('clearDataBtn').addEventListener('click', () => {
  if (!confirm('Delete ALL tasks, projects, goals and routines? This cannot be undone.')) return;
  state.tasks = []; state.projects = []; state.goals = [];
  state.routineLog = {}; state.taskHistory = {};
  save(); rerenderCurrent(); updateBadges();
  alert('✓ All data cleared.');
});

// ══════════════════════════════════════════════════════════════
//  ROUTINE REMINDERS (browser notifications)
// ══════════════════════════════════════════════════════════════
const _reminderTimers = [];

function scheduleReminders() {
  // Clear any previously scheduled timers
  _reminderTimers.forEach(id => clearTimeout(id));
  _reminderTimers.length = 0;

  if (Notification.permission === 'denied') return;

  const now    = new Date();
  const todayDOW = now.getDay();

  state.tasks
    .filter(t => t.type === 'routine' && t.reminderTime && t.repeatDays.includes(todayDOW))
    .forEach(t => {
      const [h, m] = t.reminderTime.split(':').map(Number);
      const fireAt  = new Date();
      fireAt.setHours(h, m, 0, 0);
      const ms = fireAt - now;
      if (ms <= 0) return; // already passed today

      const id = setTimeout(() => {
        if (Notification.permission === 'granted') {
          new Notification('Planner — Routine Reminder', {
            body: `Time for: ${t.name}`,
            icon: 'icons/icon-192.png',
            tag:  t.id, // prevents duplicate notifications
          });
        }
      }, ms);
      _reminderTimers.push(id);
    });
}

function requestNotificationPermission() {
  if (!('Notification' in window)) return;
  if (Notification.permission === 'default') {
    Notification.requestPermission().then(scheduleReminders);
  } else {
    scheduleReminders();
  }
}

// ══════════════════════════════════════════════════════════════
//  BADGES & TOTALS
// ══════════════════════════════════════════════════════════════
function updateBadges() {
  const workPending     = state.tasks.filter(t => t.category === 'work'     && t.status === 'pending').length;
  const personalPending = state.tasks.filter(t => t.category === 'personal' && t.status === 'pending').length;
  const total           = workPending + personalPending;

  document.getElementById('workBadge').textContent     = workPending     || '';
  document.getElementById('personalBadge').textContent = personalPending || '';
  document.getElementById('pendingTotal').textContent  = total;
}

// ── Re-render current page ────────────────────────────────────
function rerenderCurrent() { showPage(currentPage); }

// ── Init ──────────────────────────────────────────────────────
showPage('dashboard');
updateBadges();
requestNotificationPermission();