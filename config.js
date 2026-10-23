// Edit this file to configure your tracker.
//
// Leave supabaseUrl / supabaseAnonKey empty to run in DEMO MODE: data lives in
// this browser only and you can switch between sample users to preview what
// each person sees. Fill them in (see README.md) to go live with real logins.
//
// The anon key is designed to be public. Access is enforced by the row-level
// security policies in supabase/schema.sql, not by keeping this key secret.

export const CONFIG = {
  programName: 'Research Program',

  supabaseUrl: 'https://qbyrcbqwjpkfkzhndufq.supabase.co',
  supabaseAnonKey: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InFieXJjYnF3anBrZmt6aG5kdWZxIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTI3NjM1NjMsImV4cCI6MjEwODMzOTU2M30.CnZIMqXK34wqeq-DWfYMrfHXu-dc9e7k5EhBRL1prpo',

  // Board columns, left to right. You can rename labels any time.
  // If you change an `id`, update existing projects that use the old id.
  stages: [
    { id: 'idea', label: 'Idea', color: '#8b5cf6' },
    { id: 'design', label: 'Design & IRB', color: '#6366f1' },
    { id: 'collection', label: 'Data collection', color: '#0ea5e9' },
    { id: 'analysis', label: 'Analysis', color: '#14b8a6' },
    { id: 'drafting', label: 'Manuscript drafting', color: '#22c55e' },
    { id: 'submitted', label: 'Submitted', color: '#eab308' },
    { id: 'revision', label: 'Revision', color: '#f97316' },
    { id: 'published', label: 'Published', color: '#64748b' },
  ],

  decisions: [
    'Under review',
    'Minor revision',
    'Major revision',
    'Accepted',
    'Rejected',
    'Desk rejected',
    'Withdrawn',
  ],
};
