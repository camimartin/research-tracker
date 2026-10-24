// Data layer. Both stores expose the same interface so the UI doesn't care
// which one it talks to:
//   getUser() → { email, isAdmin } | null      onAuth(cb) → unsubscribe
//   signIn(email)  verifyCode(email, code)  signOut()
//   loadAll() → { projects, project_members, tasks, notes, submissions, owners }
//   insert(table, row) → row   update(table, id, patch)   remove(table, id)
//   subscribe(cb) → unsubscribe   (cb fires whenever anyone changes data)

import { CONFIG } from './config.js';
import { demoSeed } from './demo-data.js';

export const TABLES = ['projects', 'project_members', 'tasks', 'notes', 'submissions'];

// Add ?demo to the address to try the sample data even when Supabase is configured.
export function createStore() {
  const forceDemo = new URLSearchParams(location.search).has('demo');
  return CONFIG.supabaseUrl && CONFIG.supabaseAnonKey && !forceDemo ? new SupabaseStore() : new DemoStore();
}

// ── Live store (Supabase) ──────────────────────────────────────────────────

class SupabaseStore {
  demo = false;

  async init() {
    // A sign-in link that was already used or expired comes back with the reason
    // in the address (#error_description=…). Keep it to show on the sign-in page,
    // then tidy the address.
    const params = new URLSearchParams(location.hash.slice(1));
    if (params.get('error_description') || params.get('error')) {
      this.linkError = params.get('error_code') || params.get('error') || 'link_error';
      history.replaceState(null, '', location.pathname + location.search);
    }
    const { createClient } = await import('https://esm.sh/@supabase/supabase-js@2.45.4');
    this.sb = createClient(CONFIG.supabaseUrl, CONFIG.supabaseAnonKey);
  }

  async getUser() {
    const { data: { session } } = await this.sb.auth.getSession();
    if (!session) return null;
    const { data: isAdmin } = await this.sb.rpc('is_admin');
    return { email: session.user.email.toLowerCase(), isAdmin: !!isAdmin };
  }

  onAuth(cb) {
    const { data } = this.sb.auth.onAuthStateChange((event) => {
      if (event !== 'TOKEN_REFRESHED') cb();
    });
    return () => data.subscription.unsubscribe();
  }

  async signIn(email) {
    const { error } = await this.sb.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: location.origin + location.pathname },
    });
    if (error) throw error;
  }

  // The 6-digit code from the sign-in email. Works even when an email security
  // scanner has already "clicked" (and so used up) the one-time link.
  async verifyCode(email, code) {
    const { error } = await this.sb.auth.verifyOtp({ email, token: code, type: 'email' });
    if (error) throw error;
  }

  async signOut() {
    await this.sb.auth.signOut();
  }

  async loadAll() {
    const [owners, ...results] = await Promise.all([
      this.sb.rpc('owner_emails'),
      ...TABLES.map((t) => this.sb.from(t).select('*')),
    ]);
    const out = {};
    results.forEach((r, i) => {
      if (r.error) throw r.error;
      out[TABLES[i]] = r.data;
    });
    // Before 2026-10-owner-list.sql is run the function is missing; just leave owners out.
    out.owners = owners.error ? [] : owners.data;
    return out;
  }

  async insert(table, row) {
    const { data, error } = await this.sb.from(table).insert(row).select().single();
    if (error) throw error;
    return data;
  }

  async update(table, id, patch) {
    const { data, error } = await this.sb.from(table).update(patch).eq('id', id).select('id');
    if (error) throw error;
    if (!data.length) throw new Error("You don't have permission to change that.");
  }

  async remove(table, id) {
    const { data, error } = await this.sb.from(table).delete().eq('id', id).select('id');
    if (error) throw error;
    if (!data.length) throw new Error("You don't have permission to delete that.");
  }

  subscribe(cb) {
    const channel = this.sb.channel('tracker-changes');
    for (const table of TABLES) {
      channel.on('postgres_changes', { event: '*', schema: 'public', table }, cb);
    }
    channel.subscribe();
    return () => this.sb.removeChannel(channel);
  }
}

// ── Demo store (this browser only) ─────────────────────────────────────────
// Mirrors the database permission rules so the demo behaves like the real thing.
// Open the page in two tabs to see changes sync live between them.

const DATA_KEY = 'research-tracker-demo-data-v2';
const USER_KEY = 'research-tracker-demo-user';

const DEFAULTS = {
  projects: {
    kind: 'project', title: 'Untitled project', summary: '', stage: CONFIG.stages[0].id, position: 0, lead: '',
    target_journal: '', target_date: null, tags: [], links: [], archived: false,
    funder: '', mechanism: '', amount: null, role: '', start_date: null, end_date: null,
  },
  project_members: { role: 'editor' },
  tasks: { parent_id: null, title: '', done: false, assignee: '', due_date: null, position: 0 },
  notes: { body: '' },
  submissions: { journal: '', submitted_on: null, decision: 'Under review', decision_on: null, comments: '' },
};

const safeGet = (k) => { try { return localStorage.getItem(k); } catch { return null; } };
const safeSet = (k, v) => { try { localStorage.setItem(k, v); } catch {} };
const clone = (x) => JSON.parse(JSON.stringify(x));

class DemoStore {
  demo = true;
  users = demoSeed.users;
  listeners = new Set();
  authListeners = new Set();
  mem = null;

  async init() {
    this.email = safeGet(USER_KEY) || this.users[0].email;
    if ('BroadcastChannel' in self) {
      this.bc = new BroadcastChannel('research-tracker-demo');
      this.bc.onmessage = () => { this.mem = null; this.emit(); };
    }
  }

  db() {
    if (!this.mem) {
      try { this.mem = JSON.parse(safeGet(DATA_KEY)); } catch {}
      if (!this.mem) this.mem = clone(demoSeed.data);
    }
    return this.mem;
  }

  save() {
    safeSet(DATA_KEY, JSON.stringify(this.mem));
    this.bc?.postMessage('change');
    this.emit();
  }

  emit() { this.listeners.forEach((f) => f()); }
  me() { return this.users.find((u) => u.email === this.email) || this.users[0]; }

  role(projectId) {
    if (this.me().isAdmin) return 'admin';
    return this.db().project_members.find((m) => m.project_id === projectId && m.email === this.email)?.role ?? null;
  }

  async getUser() {
    const u = this.me();
    return { email: u.email, isAdmin: !!u.isAdmin };
  }

  onAuth(cb) { this.authListeners.add(cb); return () => this.authListeners.delete(cb); }
  switchUser(email) { this.email = email; safeSet(USER_KEY, email); this.authListeners.forEach((f) => f()); }
  reset() { this.mem = clone(demoSeed.data); this.save(); }
  async signIn() {}
  async verifyCode() {}
  async signOut() {}
  subscribe(cb) { this.listeners.add(cb); return () => this.listeners.delete(cb); }

  async loadAll() {
    const d = this.db();
    const visible = (pid) => this.role(pid) !== null;
    return clone({
      projects: d.projects.filter((p) => visible(p.id)),
      project_members: d.project_members.filter((r) => visible(r.project_id)),
      tasks: d.tasks.filter((r) => visible(r.project_id)),
      notes: d.notes.filter((r) => visible(r.project_id)),
      submissions: d.submissions.filter((r) => visible(r.project_id)),
      owners: this.users.filter((u) => u.isAdmin).map((u) => u.email),
    });
  }

  check(table, row, action) {
    const role = this.role(table === 'projects' ? row.id : row.project_id);
    const editor = role === 'admin' || role === 'editor';
    let ok;
    if (table === 'projects') ok = action === 'update' ? editor : this.me().isAdmin;
    else if (table === 'project_members') ok = role === 'admin';
    else if (table === 'notes' && action !== 'insert') ok = role === 'admin' || (editor && row.author_email === this.email);
    else ok = editor;
    if (!ok) throw new Error("You don't have permission to do that.");
  }

  async insert(table, row) {
    const now = new Date().toISOString();
    const full = { id: crypto.randomUUID(), created_at: now, updated_at: now, ...DEFAULTS[table], ...row };
    if (table === 'notes') full.author_email = this.email;
    this.check(table, full, 'insert');
    this.db()[table].push(full);
    this.save();
    return clone(full);
  }

  async update(table, id, patch) {
    const row = this.db()[table].find((r) => r.id === id);
    if (!row) throw new Error('Not found.');
    this.check(table, row, 'update');
    Object.assign(row, patch, { updated_at: new Date().toISOString() });
    this.save();
  }

  async remove(table, id) {
    const d = this.db();
    const row = d[table].find((r) => r.id === id);
    if (!row) return;
    this.check(table, row, 'delete');
    d[table] = d[table].filter((r) => r.id !== id);
    if (table === 'projects') {
      for (const t of TABLES.slice(1)) d[t] = d[t].filter((r) => r.project_id !== id);
    }
    if (table === 'tasks') d.tasks = d.tasks.filter((r) => r.parent_id !== id);
    this.save();
  }
}
