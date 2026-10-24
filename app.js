import { h, render } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { CONFIG } from './config.js';
import { createStore } from './store.js';

const html = htm.bind(h);
const EMPTY = { projects: [], project_members: [], tasks: [], notes: [], submissions: [], owners: [] };

// Projects and grants share one table and one set of screens; these settings
// are what differ between the two boards.
const KINDS = {
  project: { stages: CONFIG.stages, decisions: CONFIG.decisions, noun: 'project', plural: 'Projects' },
  grant: { stages: CONFIG.grantStages, decisions: CONFIG.grantDecisions, noun: 'grant', plural: 'Grants' },
};
const kindOf = (p) => (p.kind === 'grant' ? 'grant' : 'project');

// ── Small helpers ──────────────────────────────────────────────────────────

const today = () => new Date().toLocaleDateString('en-CA');
const isOverdue = (d) => !!d && d < today();
const byPos = (a, b) => a.position - b.position || (a.title || '').localeCompare(b.title || '');
const isEmail = (s) => /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(s);
const safeUrl = (u) => (/^https?:\/\//i.test(u) ? u : null);

function fmtDate(d) {
  if (!d) return '';
  return new Date(d + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
}

function timeAgo(iso) {
  if (!iso) return '';
  const s = (Date.now() - new Date(iso)) / 1000;
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)} d ago`;
  return new Date(iso).toLocaleDateString();
}

function initials(who) {
  const name = (who || '?').split('@')[0];
  const parts = name.split(/[\s._-]+/).filter(Boolean);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

const shortName = (who) => (who || '').split('@')[0];

function fmtMoney(n, compact = false) {
  if (n == null || n === '') return '';
  return new Intl.NumberFormat(undefined, {
    style: 'currency', currency: CONFIG.currency || 'USD', maximumFractionDigits: compact ? 1 : 0,
    notation: compact ? 'compact' : 'standard',
  }).format(n);
}

// Accepts "$2,450,000", "250k", "1.5M".
function parseMoney(v) {
  const m = v.replace(/[,\s$€£]/g, '').match(/^(\d*\.?\d+)([kKmM])?$/);
  if (!m) return null;
  return Math.round(parseFloat(m[1]) * ({ k: 1e3, m: 1e6 }[m[2]?.toLowerCase()] || 1));
}

const daysUntil = (d) => Math.round((new Date(d + 'T00:00') - new Date(today() + 'T00:00')) / 864e5);

function readPref(key, fallback) {
  try { return localStorage.getItem(key) || fallback; } catch { return fallback; }
}
function writePref(key, value) {
  try { localStorage.setItem(key, value); } catch {}
}

function parseHash() {
  const m = location.hash.match(/p=([\w-]+)/);
  return m ? m[1] : null;
}

// ── Generic inputs ─────────────────────────────────────────────────────────

// Text field that keeps a local draft and saves on blur / Enter.
function Text({ value, onSave, multiline, ...rest }) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  const saved = useRef(null); // last draft sent, so Enter + blur don't save twice
  useEffect(() => { saved.current = null; if (!focused.current) setDraft(value ?? ''); }, [value]);
  const commit = () => {
    focused.current = false;
    if (draft !== (value ?? '') && draft !== saved.current) {
      saved.current = draft;
      onSave(draft);
    }
  };
  const Tag = multiline ? 'textarea' : 'input';
  return html`<${Tag}
    ...${rest}
    value=${draft}
    onFocus=${() => { focused.current = true; }}
    onInput=${(e) => setDraft(e.target.value)}
    onBlur=${commit}
    onKeyDown=${(e) => {
      if (!multiline && e.key === 'Enter') { commit(); e.target.blur(); }
      if (e.key === 'Escape') { setDraft(value ?? ''); focused.current = false; e.stopPropagation(); }
    }}
  />`;
}

function DateInput({ value, onSave, late, ...rest }) {
  return html`<input type="date" class="date ${late ? 'late' : ''}" ...${rest}
    value=${value || ''} onChange=${(e) => onSave(e.target.value || null)} />`;
}

function AddLine({ placeholder, onAdd, onDone, autoFocus }) {
  const [v, setV] = useState('');
  const ref = useRef();
  useEffect(() => { if (autoFocus) ref.current?.focus(); }, []);
  return html`<input ref=${ref} class="add-line" placeholder=${placeholder} value=${v}
    onInput=${(e) => setV(e.target.value)}
    onKeyDown=${(e) => {
      if (e.key === 'Enter' && v.trim()) { onAdd(v.trim()); setV(''); }
      if (e.key === 'Escape') { e.stopPropagation(); setV(''); onDone?.(); }
    }}
    onBlur=${() => { if (!v.trim()) onDone?.(); }} />`;
}

const Section = ({ title, aside, children }) => html`
  <section class="sec">
    <h4>${title}${aside ? html`<span class="muted">${aside}</span>` : null}</h4>
    ${children}
  </section>`;

const Avatar = ({ who }) => html`<span class="av" title=${who}>${initials(who)}</span>`;

// ── App ────────────────────────────────────────────────────────────────────

function App({ store }) {
  const [user, setUser] = useState(undefined); // undefined = loading, null = signed out
  const [data, setData] = useState(EMPTY);
  const [view, setViewState] = useState(() => {
    const v = readPref('research-tracker-view', 'project');
    return ['project', 'grant', 'tasks'].includes(v) ? v : 'project';
  });
  const setView = (v) => { setViewState(v); writePref('research-tracker-view', v); };
  const [openId, setOpenId] = useState(parseHash);
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [lead, setLead] = useState(''); // lowercase lead name; not remembered, so a 1:1 filter doesn't linger
  const [showArchived, setShowArchived] = useState(false);
  const [showTasks, setShowTasksState] = useState(() => readPref('research-tracker-card-tasks', 'on') === 'on');
  const setShowTasks = (on) => { setShowTasksState(on); writePref('research-tracker-card-tasks', on ? 'on' : 'off'); };
  const [sortBy, setSortByState] = useState(() => {
    const v = readPref('research-tracker-sort', 'manual');
    return ['manual', 'az', 'due'].includes(v) ? v : 'manual';
  });
  const setSortBy = (v) => { setSortByState(v); writePref('research-tracker-sort', v); };
  const [toast, setToast] = useState(null); // { msg, action?: { label, run } }
  const toastTimer = useRef();

  const notify = useCallback((msg, action) => {
    setToast({ msg, action });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), action ? 7000 : 4500);
  }, []);

  const refresh = useCallback(async () => {
    try { setData(await store.loadAll()); } catch (e) { notify(e.message || String(e)); }
  }, []);

  useEffect(() => {
    const check = async () => {
      try { setUser(await store.getUser()); } catch (e) { notify(e.message); setUser(null); }
    };
    check();
    return store.onAuth(check);
  }, []);

  useEffect(() => {
    if (!user) { setData(EMPTY); return; }
    refresh();
    let t;
    const unsub = store.subscribe(() => { clearTimeout(t); t = setTimeout(refresh, 200); });
    return () => { clearTimeout(t); unsub(); };
  }, [user?.email]);

  useEffect(() => {
    const sync = () => setOpenId(parseHash());
    addEventListener('popstate', sync);
    addEventListener('hashchange', sync);
    return () => { removeEventListener('popstate', sync); removeEventListener('hashchange', sync); };
  }, []);

  const open = (id) => {
    history.pushState(null, '', id ? `#p=${id}` : location.pathname + location.search);
    setOpenId(id);
  };

  const roleOf = useCallback((pid) => {
    if (user?.isAdmin) return 'admin';
    return data.project_members.find((m) => m.project_id === pid && m.email === user?.email)?.role ?? null;
  }, [user, data]);

  const run = useCallback(async (fn) => {
    try { await fn(); } catch (e) { notify(e.message || String(e)); }
    await refresh();
  }, []);

  const api = useMemo(() => ({
    insert: (table, row) => run(() => store.insert(table, row)),
    update: (table, id, patch) => {
      // Apply locally first so drags and checkboxes feel instant.
      setData((d) => ({ ...d, [table]: d[table].map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
      return run(() => store.update(table, id, patch));
    },
    remove: (table, id) => run(() => store.remove(table, id)),
  }), []);

  const createItem = async (kind) => {
    try {
      const stage = KINDS[kind].stages[0].id;
      const first = data.projects.filter((p) => kindOf(p) === kind && p.stage === stage);
      const row = await store.insert('projects', {
        kind,
        title: `Untitled ${KINDS[kind].noun}`,
        stage,
        position: Math.min(0, ...first.map((p) => p.position)) - 1,
      });
      await refresh();
      setView(kind);
      open(row.id);
    } catch (e) { notify(e.message); }
  };

  // Ticking a task on a board card hides it, so offer a quick undo.
  const completeTask = (t) => {
    api.update('tasks', t.id, { done: true });
    notify(`Marked “${t.title}” done`, { label: 'Undo', run: () => api.update('tasks', t.id, { done: false }) });
  };

  const deleteProject = (p) => {
    if (!confirm(`Delete "${p.title}" and all of its tasks, notes and submissions? This cannot be undone.`)) return;
    open(null);
    api.remove('projects', p.id);
  };

  if (user === undefined) return html`<p class="boot">Loading…</p>`;
  if (user === null) return html`<${Login} store=${store} />`;

  const people = [...new Set(data.project_members.map((m) => m.email))].sort();
  // Lead names as typed, merged regardless of capitals/extra spaces: lowercase key → display name.
  const leads = new Map();
  for (const p of data.projects) {
    const name = (p.lead || '').trim();
    if (name && !leads.has(name.toLowerCase())) leads.set(name.toLowerCase(), name);
  }
  const leadOptions = [...leads].sort((a, b) => a[1].localeCompare(b[1]));
  const q = query.trim().toLowerCase();
  const projects = data.projects.filter((p) =>
    (showArchived || !p.archived) &&
    (!person || data.project_members.some((m) => m.project_id === p.id && m.email === person)) &&
    (!lead || (p.lead || '').trim().toLowerCase() === lead) &&
    (!q || [p.title, p.summary, p.lead, p.target_journal, p.funder, p.mechanism, ...(p.tags || [])].join(' ').toLowerCase().includes(q)));
  const current = openId && data.projects.find((p) => p.id === openId);
  const boardKind = view === 'grant' ? 'grant' : 'project';
  const hasAny = data.projects.some((p) => kindOf(p) === boardKind);
  const tab = (v, label) => html`<button role="tab" aria-selected=${view === v} class=${view === v ? 'on' : ''} onClick=${() => setView(v)}>${label}</button>`;

  return html`
    ${store.demo && html`<${DemoBar} store=${store} user=${user} />`}
    <header class="top">
      <div class="brand"><img src="icon.svg" alt="" width="26" height="26" /><span>${CONFIG.programName}</span></div>
      <nav class="tabs" role="tablist">
        ${tab('project', 'Projects')}${tab('grant', 'Grants')}${tab('tasks', 'Tasks')}
      </nav>
      <div class="filters">
        <input class="search" type="search" placeholder="Search…" value=${query} onInput=${(e) => setQuery(e.target.value)} />
        ${leadOptions.length > 0 && html`
          <select class="lead-filter ${lead ? 'active' : ''}" value=${lead} onChange=${(e) => setLead(e.target.value)} aria-label="Filter by lead">
            <option value="">Lead: Everyone</option>
            ${lead && !leads.has(lead) && html`<option value=${lead}>Lead: ${lead}</option>`}
            ${leadOptions.map(([key, name]) => html`<option value=${key}>Lead: ${name}</option>`)}
          </select>`}
        ${user.isAdmin && people.length > 0 && html`
          <select class="person" value=${person} onChange=${(e) => setPerson(e.target.value)} aria-label="Filter by collaborator">
            <option value="">All collaborators</option>
            ${people.map((e) => html`<option value=${e}>${e}</option>`)}
          </select>`}
        ${view !== 'tasks' && html`
          <select class="sort" value=${sortBy} onChange=${(e) => setSortBy(e.target.value)} aria-label="Sort cards">
            <option value="manual">Sort: Manual order</option>
            <option value="az">Sort: A–Z</option>
            <option value="due">Sort: Next due date</option>
          </select>
          <label class="check"><input type="checkbox" checked=${showTasks} onChange=${(e) => setShowTasks(e.target.checked)} /> Show tasks</label>`}
        <label class="check"><input type="checkbox" checked=${showArchived} onChange=${(e) => setShowArchived(e.target.checked)} /> Archived</label>
      </div>
      <div class="actions">
        ${user.isAdmin && view !== 'tasks' && html`<button class="primary" onClick=${() => createItem(boardKind)}>+ New ${KINDS[boardKind].noun}</button>`}
        ${!store.demo && html`
          <span class="me" title=${user.email}><${Avatar} who=${user.email} /></span>
          <button class="ghost" onClick=${() => store.signOut()}>Sign out</button>`}
      </div>
    </header>

    <main>
      ${view === 'tasks'
        ? html`<${TaskList} data=${data} projects=${projects} user=${user} roleOf=${roleOf} api=${api} onOpen=${open} />`
        : html`<${Board} key=${boardKind} kind=${boardKind} projects=${projects.filter((p) => kindOf(p) === boardKind)} data=${data} roleOf=${roleOf} onOpen=${open}
            showTasks=${showTasks} onTaskDone=${completeTask} sortBy=${sortBy}
            onMove=${(id, stage, position) => api.update('projects', id, { stage, position })} />`}
      ${view !== 'tasks' && !hasAny && html`
        <div class="blank">
          ${user.isAdmin
            ? html`<p>No ${KINDS[boardKind].noun}s yet.</p><button class="primary" onClick=${() => createItem(boardKind)}>Create your first ${KINDS[boardKind].noun}</button>`
            : html`<p>No ${KINDS[boardKind].noun}s have been shared with <strong>${user.email}</strong> yet.</p><p class="muted">Ask the owner to add this email address.</p>`}
        </div>`}
    </main>

    ${current && html`<${ProjectDetail} key=${current.id} p=${current} data=${data} role=${roleOf(current.id)}
      user=${user} api=${api} onClose=${() => open(null)} onDelete=${() => deleteProject(current)} />`}
    ${toast && html`<div class="toast" role="status">
      <span>${toast.msg}</span>
      ${toast.action && html`<button onClick=${() => { toast.action.run(); setToast(null); }}>${toast.action.label}</button>`}
    </div>`}
  `;
}

function DemoBar({ store, user }) {
  return html`<div class="demobar">
    <strong>Demo mode</strong>
    <span>Data is saved in this browser only. Open a second tab to watch changes sync live.</span>
    <label>Viewing as
      <select value=${user.email} onChange=${(e) => store.switchUser(e.target.value)}>
        ${store.users.map((u) => html`<option value=${u.email}>${u.name}</option>`)}
      </select>
    </label>
    <button class="ghost" onClick=${() => confirm('Reset all demo data?') && store.reset()}>Reset demo</button>
  </div>`;
}

// ── Sign in ────────────────────────────────────────────────────────────────

const SIGNIN_EMAIL_KEY = 'research-tracker-signin-email';

const LINK_ERROR_TEXT =
  'That sign-in link had already been used or had expired. This often happens when a university or ' +
  'hospital email system checks links before you see them. Enter the code from the same email instead.';

function Login({ store }) {
  // If a used/expired link brought them back, go straight to the code step for the email they used.
  const remembered = readPref(SIGNIN_EMAIL_KEY, '');
  const [email, setEmail] = useState(remembered);
  const [code, setCode] = useState('');
  const [step, setStep] = useState(store.linkError && remembered ? 'code' : 'email'); // email | code
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(store.linkError ? LINK_ERROR_TEXT : '');

  const run = async (fn) => {
    setError('');
    setBusy(true);
    try { await fn(); } catch (err) { setError(err.message || String(err)); }
    setBusy(false);
  };

  const sendEmail = (e) => {
    e.preventDefault();
    run(async () => {
      const em = email.trim().toLowerCase();
      await store.signIn(em);
      writePref(SIGNIN_EMAIL_KEY, em);
      setEmail(em);
      setCode('');
      setStep('code');
    });
  };

  // On success the app notices the new session and swaps this page for the board.
  const verify = (e) => {
    e.preventDefault();
    run(async () => {
      try {
        await store.verifyCode(email, code.replace(/\D/g, ''));
      } catch (err) {
        // Keep Supabase's own wording at the end so a failure can be diagnosed.
        const reason = err.message || String(err);
        throw new Error(/expired|invalid/i.test(reason)
          ? `That code didn’t work. Make sure it’s from the newest email — asking for a new code cancels earlier ones — and that it was sent within the last hour. (${reason})`
          : reason);
      }
    });
  };

  return html`<div class="login">
    ${step === 'email'
      ? html`<form class="login-card" onSubmit=${sendEmail}>
          <img src="icon.svg" alt="" width="44" height="44" />
          <h1>${CONFIG.programName}</h1>
          <p class="muted">Sign in with the email your projects were shared with. We'll email you a sign-in code — no password needed.</p>
          <input type="email" required autocomplete="email" placeholder="you@university.edu" value=${email} onInput=${(e) => setEmail(e.target.value)} />
          <button class="primary" disabled=${busy}>${busy ? 'Sending…' : 'Email me a sign-in code'}</button>
          ${error && html`<p class="error">${error}</p>`}
        </form>`
      : html`<form class="login-card" onSubmit=${verify}>
          <img src="icon.svg" alt="" width="44" height="44" />
          <h1>${CONFIG.programName}</h1>
          ${error === LINK_ERROR_TEXT
            ? html`<p class="error">${error}</p>`
            : html`<p>We emailed a sign-in code to <strong>${email}</strong>. Enter it below, or click the link in that email.
                It can take a minute or two to arrive; if you ask for another, use the newest one.</p>`}
          <input class="code-input" inputmode="numeric" autocomplete="one-time-code" placeholder="Code from email" maxlength="12"
            value=${code} onInput=${(e) => setCode(e.target.value)} aria-label="Sign-in code" />
          <button class="primary" disabled=${busy || code.replace(/\D/g, '').length < 6}>${busy ? 'Checking…' : 'Sign in'}</button>
          ${error && error !== LINK_ERROR_TEXT && html`<p class="error">${error}</p>`}
          <p class="muted small">Can't find it? Check spam, or${' '}<button type="button" class="link-inline" disabled=${busy} onClick=${() => run(async () => { await store.signIn(email); setCode(''); })}>send a new code</button>
            · <button type="button" class="link-inline" onClick=${() => { setError(''); setStep('email'); }}>use a different email</button></p>
        </form>`}
  </div>`;
}

// ── Board ──────────────────────────────────────────────────────────────────

// The date a card is "due": its soonest open task, or a grant's submission
// deadline while it's still being prepared, whichever comes first.
function nextDue(p, tasks) {
  let best = kindOf(p) === 'grant' && PRE_SUBMISSION.has(p.stage) ? p.target_date || null : null;
  for (const t of tasks) {
    if (t.project_id === p.id && !t.done && t.due_date && (!best || t.due_date < best)) best = t.due_date;
  }
  return best;
}

const byTitle = (a, b) => (a.title || '').localeCompare(b.title || '', undefined, { sensitivity: 'base' });

function sortCards(items, sortBy, tasks) {
  if (sortBy === 'az') return [...items].sort(byTitle);
  if (sortBy === 'due') {
    const due = new Map(items.map((p) => [p.id, nextDue(p, tasks)]));
    return [...items].sort((a, b) => (due.get(a.id) || '9999').localeCompare(due.get(b.id) || '9999') || byTitle(a, b));
  }
  return [...items].sort(byPos);
}

function Board({ kind, projects, data, roleOf, onOpen, onMove, showTasks, onTaskDone, sortBy }) {
  const STAGES = KINDS[kind].stages;
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  const drop = (stage, beforeId) => {
    if (!dragId) return;
    if (sortBy !== 'manual') beforeId = null; // sorted view: a drop only changes the column
    const items = projects.filter((p) => p.stage === stage && p.id !== dragId).sort(byPos);
    const idx = beforeId ? items.findIndex((p) => p.id === beforeId) : -1;
    let position;
    if (idx === -1) position = (items.at(-1)?.position ?? 0) + 1;
    else if (idx === 0) position = items[0].position - 1;
    else position = (items[idx - 1].position + items[idx].position) / 2;
    onMove(dragId, stage, position);
    setDragId(null);
    setOver(null);
  };

  return html`<nav class="stage-jump" aria-label="Jump to stage">
    ${STAGES.map((s) => html`<button style=${{ '--stage': s.color || 'var(--accent)' }}
      onClick=${() => document.getElementById(`col-${s.id}`)?.scrollIntoView({ behavior: 'smooth', inline: 'start', block: 'nearest' })}>
      <span class="dot"></span>${s.label} <span class="count">${projects.filter((p) => p.stage === s.id).length}</span>
    </button>`)}
  </nav>
  <div class="board" style=${{ '--per-row-2': Math.ceil(STAGES.length / 2), '--per-row-3': Math.ceil(STAGES.length / 3) }}>
    ${STAGES.map((s) => {
      const items = sortCards(projects.filter((p) => p.stage === s.id), sortBy, data.tasks);
      return html`<section id=${`col-${s.id}`} class="col ${over === s.id ? 'over' : ''}" style=${{ '--stage': s.color || 'var(--accent)' }}
        onDragOver=${(e) => { if (dragId) { e.preventDefault(); if (over !== s.id) setOver(s.id); } }}
        onDrop=${(e) => { e.preventDefault(); drop(s.id, null); }}>
        <h2><span class="dot"></span>${s.label}<span class="count">${items.length}</span></h2>
        <div class="cards">
          ${items.map((p) => html`<${Card} key=${p.id} p=${p} data=${data} role=${roleOf(p.id)} onOpen=${onOpen}
            showTasks=${showTasks} onTaskDone=${onTaskDone}
            dragging=${dragId === p.id}
            onDragStart=${(e) => { e.dataTransfer.setData('text/plain', p.id); e.dataTransfer.effectAllowed = 'move'; setDragId(p.id); }}
            onDragEnd=${() => { setDragId(null); setOver(null); }}
            onDrop=${(e) => { e.preventDefault(); e.stopPropagation(); drop(s.id, p.id); }} />`)}
          ${!items.length && html`<p class="empty">Nothing here yet</p>`}
        </div>
      </section>`;
    })}
  </div>`;
}

const CARD_TASK_LIMIT = 5;
const fmtShort = (d) => new Date(d + 'T00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });

// Open tasks on a board card, most urgent first, tickable without opening the project.
function CardTasks({ open, canEdit, onTaskDone }) {
  const shown = open.slice(0, CARD_TASK_LIMIT);
  return html`<ul class="card-tasks">
    ${shown.map((t) => html`<li key=${t.id}>
      <input type="checkbox" disabled=${!canEdit} aria-label=${`Mark “${t.title}” done`}
        onClick=${(e) => e.stopPropagation()} onChange=${() => onTaskDone(t)} />
      <span class="ct-title">${t.parent_id ? html`<span class="muted">↳ </span>` : null}${t.title || 'Untitled task'}</span>
      ${t.assignee && html`<${Avatar} who=${t.assignee} />`}
      ${t.due_date && html`<span class="ct-due ${isOverdue(t.due_date) ? 'late' : ''}">${fmtShort(t.due_date)}</span>`}
    </li>`)}
    ${open.length > shown.length && html`<li class="ct-more">+${open.length - shown.length} more</li>`}
  </ul>`;
}

function Card({ p, data, role, onOpen, dragging, onDragStart, onDragEnd, onDrop, showTasks, onTaskDone }) {
  const tasks = data.tasks.filter((t) => t.project_id === p.id);
  const done = tasks.filter((t) => t.done).length;
  const members = data.project_members.filter((m) => m.project_id === p.id);
  const open = tasks.filter((t) => !t.done)
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || a.position - b.position);
  const next = open.find((t) => t.due_date);
  const notes = data.notes.filter((n) => n.project_id === p.id).length;
  const canDrag = role === 'admin' || role === 'editor';
  return html`<article class="card ${p.archived ? 'archived' : ''} ${dragging ? 'dragging' : ''}" tabindex="0"
    draggable=${canDrag} onDragStart=${onDragStart} onDragEnd=${onDragEnd} onDrop=${onDrop}
    onClick=${() => onOpen(p.id)} onKeyDown=${(e) => e.key === 'Enter' && onOpen(p.id)}>
    <h3>${p.title || 'Untitled'}</h3>
    ${kindOf(p) === 'grant' ? html`<${GrantMeta} p=${p} />`
      : (p.lead || p.target_journal) && html`<p class="meta">${[p.lead, p.target_journal].filter(Boolean).join(' · ')}</p>`}
    ${p.tags?.length > 0 && html`<div class="tags">${p.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>`}
    ${tasks.length > 0 && html`<div class="progress" title="${done} of ${tasks.length} tasks done"><div style=${{ width: `${(100 * done) / tasks.length}%` }}></div></div>`}
    ${showTasks && open.length > 0 && html`<${CardTasks} open=${open} canEdit=${canDrag} onTaskDone=${onTaskDone} />`}
    <footer>
      <span class="stat">${tasks.length ? `${done}/${tasks.length} tasks` : 'No tasks'}</span>
      ${notes > 0 && html`<span class="stat">${notes} note${notes > 1 ? 's' : ''}</span>`}
      ${!showTasks && next && html`<span class="stat ${isOverdue(next.due_date) ? 'late' : ''}">Due ${fmtDate(next.due_date)}</span>`}
      ${p.archived && html`<span class="badge">Archived</span>`}
      ${role === 'viewer' && html`<span class="badge">View only</span>`}
      <span class="avatars">${members.slice(0, 4).map((m) => html`<${Avatar} who=${m.email} />`)}${members.length > 4 && html`<span class="av more">+${members.length - 4}</span>`}</span>
    </footer>
  </article>`;
}

// Deadlines only matter until the grant goes out the door.
const PRE_SUBMISSION = new Set(['idea', 'planning', 'writing', 'routing', 'resubmit']);

function GrantMeta({ p }) {
  const who = [p.role, p.funder, p.mechanism].filter(Boolean).join(' · ');
  const showDeadline = p.target_date && PRE_SUBMISSION.has(p.stage);
  const days = showDeadline ? daysUntil(p.target_date) : null;
  const when = days == null ? '' : days < 0 ? `${-days} d overdue` : days === 0 ? 'today' : `in ${days} d`;
  return html`
    ${who && html`<p class="meta">${who}</p>`}
    ${(p.amount != null || showDeadline || p.end_date) && html`<p class="grant-line">
      ${p.amount != null && html`<span class="amount">${fmtMoney(p.amount, true)}</span>`}
      ${showDeadline && html`<span class="deadline ${days < 0 ? 'late' : days <= 14 ? 'soon' : ''}">Deadline ${fmtDate(p.target_date)} (${when})</span>`}
      ${!showDeadline && p.end_date && html`<span class="muted">Ends ${fmtDate(p.end_date)}</span>`}
    </p>`}`;
}

// ── Tasks view (across projects) ───────────────────────────────────────────

function TaskList({ data, projects, user, roleOf, api, onOpen }) {
  const [scope, setScope] = useState('mine');
  const [showDone, setShowDone] = useState(false);
  const byId = new Map(projects.map((p) => [p.id, p]));
  const taskById = new Map(data.tasks.map((t) => [t.id, t]));
  const tasks = data.tasks
    .filter((t) => byId.has(t.project_id) && (showDone || !t.done) && (scope === 'all' || t.assignee === user.email))
    .sort((a, b) => (a.due_date || '9999').localeCompare(b.due_date || '9999') || byId.get(a.project_id).title.localeCompare(byId.get(b.project_id).title));

  return html`<div class="tasklist">
    <div class="tasklist-head">
      <div class="seg">
        <button class=${scope === 'mine' ? 'on' : ''} onClick=${() => setScope('mine')}>Assigned to me</button>
        <button class=${scope === 'all' ? 'on' : ''} onClick=${() => setScope('all')}>All tasks</button>
      </div>
      <label class="check"><input type="checkbox" checked=${showDone} onChange=${(e) => setShowDone(e.target.checked)} /> Show completed</label>
    </div>
    ${!tasks.length && html`<p class="empty">${scope === 'mine' ? 'Nothing assigned to you. Nice.' : 'No tasks.'}</p>`}
    <ul class="flat">
      ${tasks.map((t) => {
        const p = byId.get(t.project_id);
        const parent = t.parent_id && taskById.get(t.parent_id);
        const canEdit = ['admin', 'editor'].includes(roleOf(p.id));
        return html`<li class="task ${t.done ? 'done' : ''}" key=${t.id}>
          <input type="checkbox" checked=${t.done} disabled=${!canEdit} aria-label="Done" onChange=${(e) => api.update('tasks', t.id, { done: e.target.checked })} />
          <div class="grow">
            <div class="task-name">${parent && html`<span class="muted">${parent.title} › </span>`}${t.title}</div>
            <button class="link" onClick=${() => onOpen(p.id)}>${kindOf(p) === 'grant' && html`<span class="kind">Grant</span>`}${p.title}</button>
          </div>
          ${t.assignee && scope === 'all' && html`<span class="who"><${Avatar} who=${t.assignee} /> ${shortName(t.assignee)}</span>`}
          <span class="due ${!t.done && isOverdue(t.due_date) ? 'late' : ''}">${fmtDate(t.due_date)}</span>
        </li>`;
      })}
    </ul>
  </div>`;
}

// ── Project detail ─────────────────────────────────────────────────────────

function ProjectDetail({ p, data, role, user, api, onClose, onDelete }) {
  const canEdit = role === 'admin' || role === 'editor';
  const isAdmin = role === 'admin';
  const save = (patch) => api.update('projects', p.id, patch);
  const members = data.project_members.filter((m) => m.project_id === p.id);
  // Who tasks can be assigned to: owners (who see everything) plus everyone shared on this item.
  const people = [...new Set([...(data.owners || []), ...(isAdmin ? [user.email] : []), ...members.map((m) => m.email)])];
  const kind = kindOf(p);
  const { stages, noun } = KINDS[kind];
  const stageKnown = stages.some((s) => s.id === p.stage);

  useEffect(() => {
    const onKey = (e) => {
      if (e.key === 'Escape' && !e.target.closest?.('input, textarea, select')) onClose();
    };
    addEventListener('keydown', onKey);
    return () => removeEventListener('keydown', onKey);
  }, []);

  return html`
    <div class="scrim" onClick=${onClose}></div>
    <aside class="drawer" role="dialog" aria-modal="true" aria-label=${p.title}>
      <div class="drawer-head">
        <${Text} class="title-input" value=${p.title} disabled=${!canEdit} placeholder="Title" aria-label="Title"
          onSave=${(v) => save({ title: v.trim() || `Untitled ${noun}` })} />
        <button class="icon close" onClick=${onClose} aria-label="Close">✕</button>
      </div>
      <div class="drawer-sub">
        ${kind === 'grant' && html`<span class="kind">Grant</span>`}
        <select class="stage-select" value=${p.stage} disabled=${!canEdit} onChange=${(e) => save({ stage: e.target.value })} aria-label="Stage">
          ${!stageKnown && html`<option value=${p.stage}>${p.stage}</option>`}
          ${stages.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
        </select>
        ${role === 'viewer' && html`<span class="badge">View only</span>`}
        ${p.archived && html`<span class="badge">Archived</span>`}
        <span class="muted">Updated ${timeAgo(p.updated_at)}</span>
      </div>

      <div class="drawer-body">
        <${Section} title="Overview">
          <label class="field"><span>${kind === 'grant' ? 'Summary / specific aims' : 'Summary / aims'}</span>
            <${Text} multiline rows="3" value=${p.summary} disabled=${!canEdit} placeholder="Research question, hypothesis, design…" onSave=${(v) => save({ summary: v })} />
          </label>
          ${kind === 'grant'
            ? html`<${GrantFields} p=${p} canEdit=${canEdit} save=${save} />`
            : html`<div class="grid2">
              <label class="field"><span>Lead</span><${Text} value=${p.lead} disabled=${!canEdit} placeholder="Who's leading" onSave=${(v) => save({ lead: v.trim() })} /></label>
              <label class="field"><span>Target journal</span><${Text} value=${p.target_journal} disabled=${!canEdit} placeholder="—" onSave=${(v) => save({ target_journal: v.trim() })} /></label>
              <label class="field"><span>Target date</span><${DateInput} value=${p.target_date} disabled=${!canEdit} onSave=${(v) => save({ target_date: v })} /></label>
              <label class="field"><span>Tags</span><${TagsInput} p=${p} canEdit=${canEdit} save=${save} /></label>
            </div>`}
        </${Section}>

        <${Tasks} p=${p} data=${data} canEdit=${canEdit} api=${api} people=${people} me=${user.email} />
        <${Notes} p=${p} data=${data} canEdit=${canEdit} user=${user} api=${api} />
        <${Submissions} p=${p} kind=${kind} data=${data} canEdit=${canEdit} api=${api} />
        <${Links} p=${p} canEdit=${canEdit} save=${save} />
        <${People} p=${p} members=${members} isAdmin=${isAdmin} api=${api} />

        ${isAdmin && html`<div class="danger-zone">
          <button class="ghost" onClick=${() => save({ archived: !p.archived })}>${p.archived ? 'Restore from archive' : `Archive ${noun}`}</button>
          <button class="ghost danger" onClick=${onDelete}>Delete ${noun}</button>
        </div>`}
      </div>
    </aside>`;
}

const TagsInput = ({ p, canEdit, save }) => html`<${Text} value=${(p.tags || []).join(', ')} disabled=${!canEdit} placeholder="comma, separated"
  onSave=${(v) => save({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) })} />`;

function GrantFields({ p, canEdit, save }) {
  const roles = CONFIG.grantRoles || [];
  return html`<div class="grid2">
    <label class="field"><span>Funder</span><${Text} value=${p.funder} disabled=${!canEdit} placeholder="e.g. NIH / NICHD" onSave=${(v) => save({ funder: v.trim() })} /></label>
    <label class="field"><span>Mechanism / announcement</span><${Text} value=${p.mechanism} disabled=${!canEdit} placeholder="e.g. R01, PA-25-301" onSave=${(v) => save({ mechanism: v.trim() })} /></label>
    <label class="field"><span>PI</span><${Text} value=${p.lead} disabled=${!canEdit} placeholder="Principal investigator" onSave=${(v) => save({ lead: v.trim() })} /></label>
    <label class="field"><span>My role</span>
      <select value=${p.role} disabled=${!canEdit} onChange=${(e) => save({ role: e.target.value })}>
        <option value="">—</option>
        ${p.role && !roles.includes(p.role) && html`<option value=${p.role}>${p.role}</option>`}
        ${roles.map((r) => html`<option value=${r}>${r}</option>`)}
      </select>
    </label>
    <label class="field"><span>Submission deadline</span><${DateInput} value=${p.target_date} disabled=${!canEdit} onSave=${(v) => save({ target_date: v })} /></label>
    <label class="field"><span>Total amount</span>
      <${Text} value=${p.amount == null ? '' : fmtMoney(p.amount)} disabled=${!canEdit} placeholder="$0" inputmode="decimal"
        onSave=${(v) => save({ amount: parseMoney(v) })} />
    </label>
    <label class="field"><span>Project start</span><${DateInput} value=${p.start_date} disabled=${!canEdit} onSave=${(v) => save({ start_date: v })} /></label>
    <label class="field"><span>Project end</span><${DateInput} value=${p.end_date} disabled=${!canEdit} onSave=${(v) => save({ end_date: v })} /></label>
    <label class="field"><span>Tags</span><${TagsInput} p=${p} canEdit=${canEdit} save=${save} /></label>
  </div>`;
}

// Dropdown of the people who can see this item, so tasks always land in
// someone's "Assigned to me" list. An old free-text value (e.g. a typed name, or
// someone since removed from the project) stays visible until it's changed.
function AssigneeSelect({ value, people, me, disabled, onSave }) {
  const current = value || '';
  const label = (email) => (email === me ? `Me (${shortName(email)})` : email);
  return html`<select class="assignee" value=${current} disabled=${disabled} aria-label="Assignee" title=${current}
    onChange=${(e) => onSave(e.target.value)}>
    <option value="">Unassigned</option>
    ${current && !people.includes(current) && html`<option value=${current}>${current} (not on project)</option>`}
    ${people.map((email) => html`<option value=${email}>${label(email)}</option>`)}
  </select>`;
}

function Tasks({ p, data, canEdit, api, people, me }) {
  const all = data.tasks.filter((t) => t.project_id === p.id);
  const top = all.filter((t) => !t.parent_id).sort(byPos);
  const kids = (id) => all.filter((t) => t.parent_id === id).sort(byPos);
  const done = all.filter((t) => t.done).length;
  const add = (title, parent_id = null) => {
    const siblings = parent_id ? kids(parent_id) : top;
    api.insert('tasks', { project_id: p.id, parent_id, title, position: (siblings.at(-1)?.position ?? 0) + 1 });
  };
  return html`<${Section} title="Tasks" aside=${all.length ? `${done}/${all.length} done` : ''}>
    ${all.length > 0 && html`<div class="progress big"><div style=${{ width: `${(100 * done) / all.length}%` }}></div></div>`}
    <ul class="tasks">
      ${top.map((t) => html`<${TaskRow} key=${t.id} t=${t} subtasks=${kids(t.id)} canEdit=${canEdit} api=${api} people=${people} me=${me}
        onAddSub=${(title) => add(title, t.id)} />`)}
    </ul>
    ${canEdit ? html`<${AddLine} placeholder="+ Add a task and press Enter" onAdd=${(title) => add(title)} />`
      : !all.length && html`<p class="empty">No tasks.</p>`}
  </${Section}>`;
}

function TaskRow({ t, subtasks = [], depth = 0, canEdit, api, people, me, onAddSub }) {
  const [adding, setAdding] = useState(false);
  const up = (patch) => api.update('tasks', t.id, patch);
  const del = () => {
    if (subtasks.length && !confirm(`Delete "${t.title}" and its ${subtasks.length} subtask(s)?`)) return;
    api.remove('tasks', t.id);
  };
  return html`<li class="task ${t.done ? 'done' : ''}">
    <div class="task-line">
      <input type="checkbox" checked=${t.done} disabled=${!canEdit} aria-label="Done" onChange=${(e) => up({ done: e.target.checked })} />
      <${Text} class="task-title" value=${t.title} disabled=${!canEdit} aria-label="Task" onSave=${(v) => up({ title: v })} />
      <div class="task-meta">
        <${AssigneeSelect} value=${t.assignee} people=${people} me=${me} disabled=${!canEdit} onSave=${(v) => up({ assignee: v })} />
        <${DateInput} value=${t.due_date} disabled=${!canEdit} late=${!t.done && isOverdue(t.due_date)} aria-label="Due date" onSave=${(v) => up({ due_date: v })} />
        ${canEdit && depth === 0 && html`<button class="icon" title="Add subtask" aria-label="Add subtask" onClick=${() => setAdding(true)}>＋</button>`}
        ${canEdit && html`<button class="icon" title="Delete" aria-label="Delete task" onClick=${del}>✕</button>`}
      </div>
    </div>
    ${(subtasks.length > 0 || adding) && html`<ul class="subtasks">
      ${subtasks.map((s) => html`<${TaskRow} key=${s.id} t=${s} depth=${1} canEdit=${canEdit} api=${api} people=${people} me=${me} />`)}
      ${adding && html`<li key="adder"><${AddLine} autoFocus placeholder="Subtask, then Enter (Esc to stop)" onAdd=${onAddSub} onDone=${() => setAdding(false)} /></li>`}
    </ul>`}
  </li>`;
}

function Notes({ p, data, canEdit, user, api }) {
  const [draft, setDraft] = useState('');
  const notes = data.notes.filter((n) => n.project_id === p.id).sort((a, b) => b.created_at.localeCompare(a.created_at));
  const add = () => {
    if (!draft.trim()) return;
    api.insert('notes', { project_id: p.id, body: draft.trim(), author_email: user.email });
    setDraft('');
  };
  return html`<${Section} title="Notes" aside=${notes.length ? String(notes.length) : ''}>
    ${canEdit && html`<div class="note-new">
      <textarea rows="2" placeholder="Meeting notes, decisions, updates…  (⌘/Ctrl + Enter to post)" value=${draft}
        onInput=${(e) => setDraft(e.target.value)} onKeyDown=${(e) => { if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) add(); }}></textarea>
      <button class="primary" disabled=${!draft.trim()} onClick=${add}>Post</button>
    </div>`}
    <ul class="notes">
      ${notes.map((n) => html`<li key=${n.id}>
        <div class="note-head">
          <${Avatar} who=${n.author_email} /><strong>${n.author_email === user.email ? 'You' : shortName(n.author_email)}</strong>
          <span class="muted" title=${new Date(n.created_at).toLocaleString()}>${timeAgo(n.created_at)}</span>
          ${(user.isAdmin || (canEdit && n.author_email === user.email)) && html`<button class="icon" aria-label="Delete note"
            onClick=${() => confirm('Delete this note?') && api.remove('notes', n.id)}>✕</button>`}
        </div>
        <p>${n.body}</p>
      </li>`)}
    </ul>
    ${!notes.length && !canEdit && html`<p class="empty">No notes.</p>`}
  </${Section}>`;
}

function Submissions({ p, kind, data, canEdit, api }) {
  const grant = kind === 'grant';
  const decisions = KINDS[kind].decisions;
  const subs = data.submissions.filter((s) => s.project_id === p.id).sort((a, b) => (a.submitted_on || '').localeCompare(b.submitted_on || ''));
  const add = () => api.insert('submissions', {
    project_id: p.id,
    journal: grant ? [p.funder, p.mechanism].filter(Boolean).join(' – ') : p.target_journal || '',
    decision: decisions[0],
    submitted_on: today(),
  });
  return html`<${Section} title="Submission history" aside=${subs.length ? String(subs.length) : ''}>
    ${subs.length > 0 && html`<div class="subs">
      ${subs.map((s) => {
        const up = (patch) => api.update('submissions', s.id, patch);
        return html`<div class="sub" key=${s.id}>
          <${Text} class="sub-journal" value=${s.journal} disabled=${!canEdit} placeholder=${grant ? 'Funder / mechanism' : 'Journal'} aria-label=${grant ? 'Funder' : 'Journal'} onSave=${(v) => up({ journal: v.trim() })} />
          <label class="mini"><span>Submitted</span><${DateInput} value=${s.submitted_on} disabled=${!canEdit} onSave=${(v) => up({ submitted_on: v })} /></label>
          <label class="mini"><span>Decision</span>
            <select value=${s.decision} disabled=${!canEdit} class="decision d-${s.decision.split(' ')[0].toLowerCase()}" onChange=${(e) => up({ decision: e.target.value })}>
              ${!decisions.includes(s.decision) && html`<option value=${s.decision}>${s.decision}</option>`}
              ${decisions.map((d) => html`<option value=${d}>${d}</option>`)}
            </select>
          </label>
          <label class="mini"><span>Decision date</span><${DateInput} value=${s.decision_on} disabled=${!canEdit} onSave=${(v) => up({ decision_on: v })} /></label>
          <${Text} class="sub-comments" value=${s.comments} disabled=${!canEdit} placeholder=${grant ? 'Score, percentile, summary statement notes…' : 'Comments (reviewers, deadlines…)'} aria-label="Comments" onSave=${(v) => up({ comments: v })} />
          ${canEdit && html`<button class="icon" aria-label="Delete submission" onClick=${() => confirm('Delete this submission record?') && api.remove('submissions', s.id)}>✕</button>`}
        </div>`;
      })}
    </div>`}
    ${canEdit ? html`<button class="ghost" onClick=${add}>+ Add submission</button>` : !subs.length && html`<p class="empty">Not submitted yet.</p>`}
  </${Section}>`;
}

function Links({ p, canEdit, save }) {
  const [label, setLabel] = useState('');
  const [url, setUrl] = useState('');
  const links = p.links || [];
  const add = (e) => {
    e.preventDefault();
    let u = url.trim();
    if (!u) return;
    if (!/^[a-z]+:\/\//i.test(u)) u = 'https://' + u;
    if (!safeUrl(u)) return;
    save({ links: [...links, { label: label.trim() || u.replace(/^https?:\/\//, ''), url: u }] });
    setLabel('');
    setUrl('');
  };
  return html`<${Section} title="Links & files" aside=${links.length ? String(links.length) : ''}>
    <ul class="links">
      ${links.map((l, i) => html`<li>
        ${safeUrl(l.url) ? html`<a href=${l.url} target="_blank" rel="noopener noreferrer">${l.label}</a>` : html`<span>${l.label}</span>`}
        ${canEdit && html`<button class="icon" aria-label="Remove link" onClick=${() => save({ links: links.filter((_, j) => j !== i) })}>✕</button>`}
      </li>`)}
    </ul>
    ${canEdit ? html`<form class="link-form" onSubmit=${add}>
      <input placeholder="Label (e.g. OSF, Overleaf, data folder)" value=${label} onInput=${(e) => setLabel(e.target.value)} />
      <input placeholder="https://…" value=${url} onInput=${(e) => setUrl(e.target.value)} />
      <button class="ghost">Add</button>
    </form>` : !links.length && html`<p class="empty">No links.</p>`}
  </${Section}>`;
}

function People({ p, members, isAdmin, api }) {
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('editor');
  const [error, setError] = useState('');
  const add = (e) => {
    e.preventDefault();
    const em = email.trim().toLowerCase();
    if (!isEmail(em)) return setError('Enter a valid email address.');
    if (members.some((m) => m.email === em)) return setError('Already shared with this person.');
    setError('');
    api.insert('project_members', { project_id: p.id, email: em, role });
    setEmail('');
  };
  return html`<${Section} title="Shared with" aside=${members.length ? String(members.length) : ''}>
    <ul class="people">
      ${members.map((m) => html`<li key=${m.id}>
        <${Avatar} who=${m.email} /><span class="grow">${m.email}</span>
        ${isAdmin ? html`
          <select value=${m.role} aria-label="Permission" onChange=${(e) => api.update('project_members', m.id, { role: e.target.value })}>
            <option value="editor">Can edit</option><option value="viewer">View only</option>
          </select>
          <button class="icon" aria-label="Remove access" onClick=${() => confirm(`Remove ${m.email} from this project?`) && api.remove('project_members', m.id)}>✕</button>`
        : html`<span class="muted">${m.role === 'viewer' ? 'View only' : 'Can edit'}</span>`}
      </li>`)}
    </ul>
    ${!members.length && html`<p class="empty">Only owners can see this project.</p>`}
    ${isAdmin && html`<form class="share-form" onSubmit=${add}>
      <input type="email" placeholder="colleague@university.edu" value=${email} onInput=${(e) => setEmail(e.target.value)} />
      <select value=${role} onChange=${(e) => setRole(e.target.value)}><option value="editor">Can edit</option><option value="viewer">View only</option></select>
      <button class="primary">Share</button>
    </form>
    ${error && html`<p class="error">${error}</p>`}
    <p class="hint">They sign in with this email to see the project. Owners always see every project.</p>`}
  </${Section}>`;
}

// ── Boot ───────────────────────────────────────────────────────────────────

(async () => {
  const root = document.getElementById('app');
  try {
    const store = createStore();
    await store.init();
    root.textContent = '';
    render(html`<${App} store=${store} />`, root);
  } catch (e) {
    root.innerHTML = '<p class="boot">Could not start the tracker. Check config.js and your connection.</p>';
    console.error(e);
  }
})();
