import { h, render } from 'preact';
import { useState, useEffect, useMemo, useRef, useCallback } from 'preact/hooks';
import htm from 'htm';
import { CONFIG } from './config.js';
import { createStore } from './store.js';

const html = htm.bind(h);
const STAGES = CONFIG.stages;
const EMPTY = { projects: [], project_members: [], tasks: [], notes: [], submissions: [] };

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

function parseHash() {
  const m = location.hash.match(/p=([\w-]+)/);
  return m ? m[1] : null;
}

// ── Generic inputs ─────────────────────────────────────────────────────────

// Text field that keeps a local draft and saves on blur / Enter.
function Text({ value, onSave, multiline, ...rest }) {
  const [draft, setDraft] = useState(value ?? '');
  const focused = useRef(false);
  useEffect(() => { if (!focused.current) setDraft(value ?? ''); }, [value]);
  const commit = () => {
    focused.current = false;
    if (draft !== (value ?? '')) onSave(draft);
  };
  const Tag = multiline ? 'textarea' : 'input';
  return html`<${Tag}
    ...${rest}
    value=${draft}
    onFocus=${() => { focused.current = true; }}
    onInput=${(e) => setDraft(e.target.value)}
    onBlur=${commit}
    onKeyDown=${(e) => {
      if (!multiline && e.key === 'Enter') e.target.blur();
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
  const [view, setView] = useState('board');
  const [openId, setOpenId] = useState(parseHash);
  const [query, setQuery] = useState('');
  const [person, setPerson] = useState('');
  const [showArchived, setShowArchived] = useState(false);
  const [toast, setToast] = useState(null);
  const toastTimer = useRef();

  const notify = useCallback((msg) => {
    setToast(msg);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), 4500);
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

  const createProject = async () => {
    try {
      const first = data.projects.filter((p) => p.stage === STAGES[0].id);
      const row = await store.insert('projects', {
        title: 'Untitled project',
        stage: STAGES[0].id,
        position: Math.min(0, ...first.map((p) => p.position)) - 1,
      });
      await refresh();
      setView('board');
      open(row.id);
    } catch (e) { notify(e.message); }
  };

  const deleteProject = (p) => {
    if (!confirm(`Delete "${p.title}" and all of its tasks, notes and submissions? This cannot be undone.`)) return;
    open(null);
    api.remove('projects', p.id);
  };

  if (user === undefined) return html`<p class="boot">Loading…</p>`;
  if (user === null) return html`<${Login} store=${store} />`;

  const people = [...new Set(data.project_members.map((m) => m.email))].sort();
  const q = query.trim().toLowerCase();
  const projects = data.projects.filter((p) =>
    (showArchived || !p.archived) &&
    (!person || data.project_members.some((m) => m.project_id === p.id && m.email === person)) &&
    (!q || [p.title, p.summary, p.lead, p.target_journal, ...(p.tags || [])].join(' ').toLowerCase().includes(q)));
  const current = openId && data.projects.find((p) => p.id === openId);

  return html`
    ${store.demo && html`<${DemoBar} store=${store} user=${user} />`}
    <header class="top">
      <div class="brand"><img src="icon.svg" alt="" width="26" height="26" /><span>${CONFIG.programName}</span></div>
      <nav class="tabs" role="tablist">
        <button role="tab" aria-selected=${view === 'board'} class=${view === 'board' ? 'on' : ''} onClick=${() => setView('board')}>Board</button>
        <button role="tab" aria-selected=${view === 'tasks'} class=${view === 'tasks' ? 'on' : ''} onClick=${() => setView('tasks')}>Tasks</button>
      </nav>
      <div class="filters">
        <input class="search" type="search" placeholder="Search projects…" value=${query} onInput=${(e) => setQuery(e.target.value)} />
        ${user.isAdmin && people.length > 0 && html`
          <select class="person" value=${person} onChange=${(e) => setPerson(e.target.value)} aria-label="Filter by collaborator">
            <option value="">All collaborators</option>
            ${people.map((e) => html`<option value=${e}>${e}</option>`)}
          </select>`}
        <label class="check"><input type="checkbox" checked=${showArchived} onChange=${(e) => setShowArchived(e.target.checked)} /> Archived</label>
      </div>
      <div class="actions">
        ${user.isAdmin && html`<button class="primary" onClick=${createProject}>+ New project</button>`}
        ${!store.demo && html`
          <span class="me" title=${user.email}><${Avatar} who=${user.email} /></span>
          <button class="ghost" onClick=${() => store.signOut()}>Sign out</button>`}
      </div>
    </header>

    <main>
      ${view === 'board'
        ? html`<${Board} projects=${projects} data=${data} roleOf=${roleOf} onOpen=${open}
            onMove=${(id, stage, position) => api.update('projects', id, { stage, position })} />`
        : html`<${TaskList} data=${data} projects=${projects} user=${user} roleOf=${roleOf} api=${api} onOpen=${open} />`}
      ${!data.projects.length && html`
        <div class="blank">
          ${user.isAdmin
            ? html`<p>No projects yet.</p><button class="primary" onClick=${createProject}>Create your first project</button>`
            : html`<p>No projects have been shared with <strong>${user.email}</strong> yet.</p><p class="muted">Ask the project owner to add this email address.</p>`}
        </div>`}
    </main>

    ${current && html`<${ProjectDetail} key=${current.id} p=${current} data=${data} role=${roleOf(current.id)}
      user=${user} api=${api} onClose=${() => open(null)} onDelete=${() => deleteProject(current)} />`}
    ${toast && html`<div class="toast" role="status">${toast}</div>`}
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

function Login({ store }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState('idle');
  const [error, setError] = useState('');
  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setState('sending');
    try {
      await store.signIn(email.trim().toLowerCase());
      setState('sent');
    } catch (err) {
      setError(err.message || String(err));
      setState('idle');
    }
  };
  return html`<div class="login">
    <form class="login-card" onSubmit=${submit}>
      <img src="icon.svg" alt="" width="44" height="44" />
      <h1>${CONFIG.programName}</h1>
      ${state === 'sent'
        ? html`<p>Check <strong>${email}</strong> for a sign-in link. You can close this tab once you've clicked it.</p>
               <button type="button" class="ghost" onClick=${() => setState('idle')}>Use a different email</button>`
        : html`<p class="muted">Sign in with the email your projects were shared with. We'll email you a link — no password needed.</p>
               <input type="email" required autocomplete="email" placeholder="you@university.edu" value=${email} onInput=${(e) => setEmail(e.target.value)} />
               <button class="primary" disabled=${state === 'sending'}>${state === 'sending' ? 'Sending…' : 'Email me a sign-in link'}</button>
               ${error && html`<p class="error">${error}</p>`}`}
    </form>
  </div>`;
}

// ── Board ──────────────────────────────────────────────────────────────────

function Board({ projects, data, roleOf, onOpen, onMove }) {
  const [dragId, setDragId] = useState(null);
  const [over, setOver] = useState(null);

  const drop = (stage, beforeId) => {
    if (!dragId) return;
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
  <div class="board">
    ${STAGES.map((s) => {
      const items = projects.filter((p) => p.stage === s.id).sort(byPos);
      return html`<section id=${`col-${s.id}`} class="col ${over === s.id ? 'over' : ''}" style=${{ '--stage': s.color || 'var(--accent)' }}
        onDragOver=${(e) => { if (dragId) { e.preventDefault(); if (over !== s.id) setOver(s.id); } }}
        onDrop=${(e) => { e.preventDefault(); drop(s.id, null); }}>
        <h2><span class="dot"></span>${s.label}<span class="count">${items.length}</span></h2>
        <div class="cards">
          ${items.map((p) => html`<${Card} key=${p.id} p=${p} data=${data} role=${roleOf(p.id)} onOpen=${onOpen}
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

function Card({ p, data, role, onOpen, dragging, onDragStart, onDragEnd, onDrop }) {
  const tasks = data.tasks.filter((t) => t.project_id === p.id);
  const done = tasks.filter((t) => t.done).length;
  const members = data.project_members.filter((m) => m.project_id === p.id);
  const next = tasks.filter((t) => !t.done && t.due_date).sort((a, b) => a.due_date.localeCompare(b.due_date))[0];
  const notes = data.notes.filter((n) => n.project_id === p.id).length;
  const canDrag = role === 'admin' || role === 'editor';
  return html`<article class="card ${p.archived ? 'archived' : ''} ${dragging ? 'dragging' : ''}" tabindex="0"
    draggable=${canDrag} onDragStart=${onDragStart} onDragEnd=${onDragEnd} onDrop=${onDrop}
    onClick=${() => onOpen(p.id)} onKeyDown=${(e) => e.key === 'Enter' && onOpen(p.id)}>
    <h3>${p.title || 'Untitled project'}</h3>
    ${(p.lead || p.target_journal) && html`<p class="meta">${[p.lead, p.target_journal].filter(Boolean).join(' · ')}</p>`}
    ${p.tags?.length > 0 && html`<div class="tags">${p.tags.map((t) => html`<span class="tag">${t}</span>`)}</div>`}
    ${tasks.length > 0 && html`<div class="progress" title="${done} of ${tasks.length} tasks done"><div style=${{ width: `${(100 * done) / tasks.length}%` }}></div></div>`}
    <footer>
      <span class="stat">${tasks.length ? `${done}/${tasks.length} tasks` : 'No tasks'}</span>
      ${notes > 0 && html`<span class="stat">${notes} note${notes > 1 ? 's' : ''}</span>`}
      ${next && html`<span class="stat ${isOverdue(next.due_date) ? 'late' : ''}">Due ${fmtDate(next.due_date)}</span>`}
      ${p.archived && html`<span class="badge">Archived</span>`}
      ${role === 'viewer' && html`<span class="badge">View only</span>`}
      <span class="avatars">${members.slice(0, 4).map((m) => html`<${Avatar} who=${m.email} />`)}${members.length > 4 && html`<span class="av more">+${members.length - 4}</span>`}</span>
    </footer>
  </article>`;
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
            <button class="link" onClick=${() => onOpen(p.id)}>${p.title}</button>
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
  const listId = `people-${p.id}`;

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
        <${Text} class="title-input" value=${p.title} disabled=${!canEdit} placeholder="Project title" aria-label="Project title"
          onSave=${(v) => save({ title: v.trim() || 'Untitled project' })} />
        <button class="icon close" onClick=${onClose} aria-label="Close">✕</button>
      </div>
      <div class="drawer-sub">
        <select class="stage-select" value=${p.stage} disabled=${!canEdit} onChange=${(e) => save({ stage: e.target.value })} aria-label="Stage">
          ${STAGES.map((s) => html`<option value=${s.id}>${s.label}</option>`)}
        </select>
        ${role === 'viewer' && html`<span class="badge">View only</span>`}
        ${p.archived && html`<span class="badge">Archived</span>`}
        <span class="muted">Updated ${timeAgo(p.updated_at)}</span>
      </div>

      <datalist id=${listId}>${members.map((m) => html`<option value=${m.email} />`)}<option value=${user.email} /></datalist>

      <div class="drawer-body">
        <${Section} title="Overview">
          <label class="field"><span>Summary / aims</span>
            <${Text} multiline rows="3" value=${p.summary} disabled=${!canEdit} placeholder="Research question, hypothesis, design…" onSave=${(v) => save({ summary: v })} />
          </label>
          <div class="grid2">
            <label class="field"><span>Lead</span><${Text} value=${p.lead} disabled=${!canEdit} placeholder="Who's leading" onSave=${(v) => save({ lead: v.trim() })} /></label>
            <label class="field"><span>Target journal</span><${Text} value=${p.target_journal} disabled=${!canEdit} placeholder="—" onSave=${(v) => save({ target_journal: v.trim() })} /></label>
            <label class="field"><span>Target date</span><${DateInput} value=${p.target_date} disabled=${!canEdit} onSave=${(v) => save({ target_date: v })} /></label>
            <label class="field"><span>Tags</span><${Text} value=${(p.tags || []).join(', ')} disabled=${!canEdit} placeholder="comma, separated"
              onSave=${(v) => save({ tags: v.split(',').map((s) => s.trim()).filter(Boolean) })} /></label>
          </div>
        </${Section}>

        <${Tasks} p=${p} data=${data} canEdit=${canEdit} api=${api} listId=${listId} />
        <${Notes} p=${p} data=${data} canEdit=${canEdit} user=${user} api=${api} />
        <${Submissions} p=${p} data=${data} canEdit=${canEdit} api=${api} />
        <${Links} p=${p} canEdit=${canEdit} save=${save} />
        <${People} p=${p} members=${members} isAdmin=${isAdmin} api=${api} />

        ${isAdmin && html`<div class="danger-zone">
          <button class="ghost" onClick=${() => save({ archived: !p.archived })}>${p.archived ? 'Restore from archive' : 'Archive project'}</button>
          <button class="ghost danger" onClick=${onDelete}>Delete project</button>
        </div>`}
      </div>
    </aside>`;
}

function Tasks({ p, data, canEdit, api, listId }) {
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
      ${top.map((t) => html`<${TaskRow} key=${t.id} t=${t} subtasks=${kids(t.id)} canEdit=${canEdit} api=${api} listId=${listId}
        onAddSub=${(title) => add(title, t.id)} />`)}
    </ul>
    ${canEdit ? html`<${AddLine} placeholder="+ Add a task and press Enter" onAdd=${(title) => add(title)} />`
      : !all.length && html`<p class="empty">No tasks.</p>`}
  </${Section}>`;
}

function TaskRow({ t, subtasks = [], depth = 0, canEdit, api, listId, onAddSub }) {
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
        <${Text} class="assignee" value=${t.assignee} list=${listId} disabled=${!canEdit} placeholder="Assignee" aria-label="Assignee"
          onSave=${(v) => up({ assignee: v.includes('@') ? v.trim().toLowerCase() : v.trim() })} />
        <${DateInput} value=${t.due_date} disabled=${!canEdit} late=${!t.done && isOverdue(t.due_date)} aria-label="Due date" onSave=${(v) => up({ due_date: v })} />
        ${canEdit && depth === 0 && html`<button class="icon" title="Add subtask" aria-label="Add subtask" onClick=${() => setAdding(true)}>＋</button>`}
        ${canEdit && html`<button class="icon" title="Delete" aria-label="Delete task" onClick=${del}>✕</button>`}
      </div>
    </div>
    ${(subtasks.length > 0 || adding) && html`<ul class="subtasks">
      ${subtasks.map((s) => html`<${TaskRow} key=${s.id} t=${s} depth=${1} canEdit=${canEdit} api=${api} listId=${listId} />`)}
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

function Submissions({ p, data, canEdit, api }) {
  const subs = data.submissions.filter((s) => s.project_id === p.id).sort((a, b) => (a.submitted_on || '').localeCompare(b.submitted_on || ''));
  const add = () => api.insert('submissions', { project_id: p.id, journal: p.target_journal || '', submitted_on: today() });
  return html`<${Section} title="Submission history" aside=${subs.length ? String(subs.length) : ''}>
    ${subs.length > 0 && html`<div class="subs">
      ${subs.map((s) => {
        const up = (patch) => api.update('submissions', s.id, patch);
        return html`<div class="sub" key=${s.id}>
          <${Text} class="sub-journal" value=${s.journal} disabled=${!canEdit} placeholder="Journal" aria-label="Journal" onSave=${(v) => up({ journal: v.trim() })} />
          <label class="mini"><span>Submitted</span><${DateInput} value=${s.submitted_on} disabled=${!canEdit} onSave=${(v) => up({ submitted_on: v })} /></label>
          <label class="mini"><span>Decision</span>
            <select value=${s.decision} disabled=${!canEdit} class="decision d-${s.decision.split(' ')[0].toLowerCase()}" onChange=${(e) => up({ decision: e.target.value })}>
              ${CONFIG.decisions.map((d) => html`<option value=${d}>${d}</option>`)}
            </select>
          </label>
          <label class="mini"><span>Decision date</span><${DateInput} value=${s.decision_on} disabled=${!canEdit} onSave=${(v) => up({ decision_on: v })} /></label>
          <${Text} class="sub-comments" value=${s.comments} disabled=${!canEdit} placeholder="Comments (reviewers, deadlines…)" aria-label="Comments" onSave=${(v) => up({ comments: v })} />
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
