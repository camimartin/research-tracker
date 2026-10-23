// Sample data for demo mode only. Ignored once Supabase is configured.

const day = (offset) => {
  const d = new Date();
  d.setDate(d.getDate() + offset);
  return d.toLocaleDateString('en-CA'); // YYYY-MM-DD
};
const ago = (days) => new Date(Date.now() - days * 864e5).toISOString();

const OWNER = 'you@yourlab.org';
const ALEX = 'alex.rivera@partner.edu';
const SAM = 'sam.chen@university.edu';

export const demoSeed = {
  users: [
    { email: OWNER, name: 'You (owner, sees everything)', isAdmin: true },
    { email: ALEX, name: 'Alex Rivera (collaborator)' },
    { email: SAM, name: 'Sam Chen (collaborator)' },
  ],
  data: {
    projects: [
      { id: 'p1', title: 'Donor milk fortification and early growth trajectories', summary: 'Hypothesis: individualized fortification improves weight z-score at 36 weeks PMA versus standard fortification.', stage: 'idea', position: 1, lead: 'You', target_journal: '', target_date: null, tags: ['NICU', 'nutrition'], links: [], archived: false, created_at: ago(20), updated_at: ago(2) },
      { id: 'p2', title: 'Maternal diet and milk fatty-acid profile', summary: 'Pilot idea for a dietary recall substudy.', stage: 'idea', position: 2, lead: 'You', target_journal: '', target_date: null, tags: ['pilot'], links: [], archived: false, created_at: ago(9), updated_at: ago(9) },
      { id: 'p3', title: 'Probiotic exposure and gut microbiome in very preterm infants', summary: 'Prospective cohort; stool samples at 2, 4 and 6 weeks.', stage: 'design', position: 1, lead: 'You', target_journal: '', target_date: day(60), tags: ['microbiome', 'cohort'], links: [{ label: 'Protocol draft', url: 'https://example.com/protocol' }], archived: false, created_at: ago(40), updated_at: ago(1) },
      { id: 'p4', title: 'Multi-site breast milk biobank', summary: 'Collect and process postpartum milk samples across 3 sites.', stage: 'collection', position: 1, lead: 'Alex Rivera', target_journal: '', target_date: day(120), tags: ['biobank', 'multi-site'], links: [], archived: false, created_at: ago(200), updated_at: ago(3) },
      { id: 'p5', title: 'Lipidomics of preterm milk and bronchopulmonary dysplasia', summary: 'Targeted lipid panel; mixed models adjusting for GA and site.', stage: 'analysis', position: 1, lead: 'You', target_journal: 'Pediatric Research', target_date: day(45), tags: ['metabolomics', 'BPD'], links: [{ label: 'Analysis repo', url: 'https://github.com/' }], archived: false, created_at: ago(300), updated_at: ago(1) },
      { id: 'p6', title: 'Milk metabolome and retinopathy of prematurity', summary: 'Untargeted metabolomics of postpartum milk in extremely preterm infants.', stage: 'drafting', position: 1, lead: 'You', target_journal: 'JAMA Network Open', target_date: day(21), tags: ['metabolomics', 'ROP'], links: [], archived: false, created_at: ago(400), updated_at: ago(0) },
      { id: 'p7', title: 'Validation of a feeding-tolerance scoring tool', summary: '', stage: 'submitted', position: 1, lead: 'Sam Chen', target_journal: 'Journal of Perinatology', target_date: null, tags: ['methods'], links: [], archived: false, created_at: ago(500), updated_at: ago(14) },
      { id: 'p8', title: 'Human milk oligosaccharides and late-onset sepsis', summary: '', stage: 'revision', position: 1, lead: 'You', target_journal: 'Pediatrics', target_date: day(10), tags: ['HMO', 'infection'], links: [], archived: false, created_at: ago(600), updated_at: ago(4) },
      { id: 'p9', title: 'Trends in exclusive human milk feeding at NICU discharge', summary: '', stage: 'published', position: 1, lead: 'You', target_journal: 'Breastfeeding Medicine', target_date: null, tags: ['epidemiology'], links: [{ label: 'Article', url: 'https://example.com/article' }], archived: false, created_at: ago(800), updated_at: ago(60) },
    ],
    project_members: [
      { id: 'm1', project_id: 'p3', email: ALEX, role: 'editor', created_at: ago(40) },
      { id: 'm2', project_id: 'p4', email: ALEX, role: 'editor', created_at: ago(200) },
      { id: 'm3', project_id: 'p4', email: SAM, role: 'viewer', created_at: ago(100) },
      { id: 'm4', project_id: 'p5', email: SAM, role: 'editor', created_at: ago(300) },
      { id: 'm5', project_id: 'p6', email: ALEX, role: 'editor', created_at: ago(400) },
      { id: 'm6', project_id: 'p7', email: SAM, role: 'editor', created_at: ago(500) },
      { id: 'm7', project_id: 'p8', email: ALEX, role: 'viewer', created_at: ago(600) },
    ],
    tasks: [
      { id: 't1', project_id: 'p1', parent_id: null, title: 'Literature scan on individualized fortification', done: false, assignee: OWNER, due_date: day(7), position: 1 },
      { id: 't2', project_id: 'p3', parent_id: null, title: 'IRB submission', done: false, assignee: OWNER, due_date: day(14), position: 1 },
      { id: 't3', project_id: 'p3', parent_id: 't2', title: 'Consent form (parent version)', done: true, assignee: ALEX, due_date: day(-3), position: 1 },
      { id: 't4', project_id: 'p3', parent_id: 't2', title: 'Data management plan', done: false, assignee: OWNER, due_date: day(5), position: 2 },
      { id: 't5', project_id: 'p3', parent_id: 't2', title: 'Sample collection SOP', done: false, assignee: ALEX, due_date: day(10), position: 3 },
      { id: 't6', project_id: 'p3', parent_id: null, title: 'Power calculation', done: true, assignee: OWNER, due_date: null, position: 2 },
      { id: 't7', project_id: 'p4', parent_id: null, title: 'Site 2 enrollment to 40 dyads', done: false, assignee: ALEX, due_date: day(30), position: 1 },
      { id: 't8', project_id: 'p4', parent_id: null, title: 'Freezer inventory audit', done: false, assignee: ALEX, due_date: day(-2), position: 2 },
      { id: 't9', project_id: 'p5', parent_id: null, title: 'Run mixed models', done: false, assignee: SAM, due_date: day(9), position: 1 },
      { id: 't10', project_id: 'p5', parent_id: 't9', title: 'Check missingness and imputation', done: true, assignee: SAM, due_date: null, position: 1 },
      { id: 't11', project_id: 'p5', parent_id: 't9', title: 'Sensitivity analysis excluding site 3', done: false, assignee: SAM, due_date: day(12), position: 2 },
      { id: 't12', project_id: 'p5', parent_id: null, title: 'Figures 1–3 draft', done: false, assignee: OWNER, due_date: day(20), position: 2 },
      { id: 't13', project_id: 'p6', parent_id: null, title: 'Draft discussion', done: false, assignee: OWNER, due_date: day(4), position: 1 },
      { id: 't14', project_id: 'p6', parent_id: null, title: 'Co-author review round', done: false, assignee: ALEX, due_date: day(14), position: 2 },
      { id: 't15', project_id: 'p6', parent_id: null, title: 'Tables and figures finalized', done: true, assignee: OWNER, due_date: null, position: 3 },
      { id: 't16', project_id: 'p8', parent_id: null, title: 'Respond to Reviewer 2', done: false, assignee: OWNER, due_date: day(6), position: 1 },
      { id: 't17', project_id: 'p8', parent_id: 't16', title: 'Re-run analysis with adjusted covariates', done: false, assignee: OWNER, due_date: day(3), position: 1 },
    ].map((t) => ({ created_at: ago(10), updated_at: ago(1), ...t })),
    notes: [
      { id: 'n1', project_id: 'p6', body: 'Meeting with co-authors: agreed to move the sensitivity analysis to the supplement. Target submission before the holiday break.', author_email: OWNER, created_at: ago(2) },
      { id: 'n2', project_id: 'p6', body: 'Uploaded revised Table 2 to the shared folder.', author_email: ALEX, created_at: ago(0.3) },
      { id: 'n3', project_id: 'p4', body: 'Site 3 courier delayed — samples held at −80 °C on site until Monday.', author_email: ALEX, created_at: ago(3) },
      { id: 'n4', project_id: 'p5', body: 'Batch effects look minimal after normalization.', author_email: SAM, created_at: ago(5) },
    ],
    submissions: [
      { id: 's1', project_id: 'p7', journal: 'Journal of Perinatology', submitted_on: day(-14), decision: 'Under review', decision_on: null, comments: '', created_at: ago(14), updated_at: ago(14) },
      { id: 's2', project_id: 'p8', journal: 'JAMA Pediatrics', submitted_on: day(-150), decision: 'Rejected', decision_on: day(-120), comments: 'Out of scope.', created_at: ago(150), updated_at: ago(120) },
      { id: 's3', project_id: 'p8', journal: 'Pediatrics', submitted_on: day(-90), decision: 'Major revision', decision_on: day(-20), comments: '2 reviewers; due in 60 days.', created_at: ago(90), updated_at: ago(20) },
      { id: 's4', project_id: 'p9', journal: 'Breastfeeding Medicine', submitted_on: day(-240), decision: 'Accepted', decision_on: day(-90), comments: '', created_at: ago(240), updated_at: ago(90) },
    ],
  },
};
