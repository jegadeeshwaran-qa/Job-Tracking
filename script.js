'use strict';
/* JobTrack – all data lives in LocalStorage under one key. */
const KEY = 'jobtrack.v1';
const STATUSES = ['Applied','Follow-up Due','Recruiter Replied','Interview Scheduled','Assessment Pending','On Hold','Rejected','Offer Received','Withdrawn'];
const METHODS = ['Direct Email','Company Website','LinkedIn','Recruitment Agency','Job Portal','Referral','Other'];
const TYPES = ['Full-time','Contract','Internship','Temporary'];
const CLOSED = ['Rejected','Withdrawn','Offer Received'];
const FIELDS = ['company','title','recruiter','email','url','appDate','method','jobType','location','salary','sponsor','status','interval','nextFollowUp','lastFollowUp','notes'];

const DEFAULT_TEMPLATES = {
  initial: { label: 'Initial job application email', subject: 'Application for {title} – {name}',
    body: 'Dear {recruiter},\n\nI am writing to apply for the {title} position at {company}. My resume is attached for your consideration.\n\nI would be glad to discuss the role with you. Thank you for your time.\n\nKind regards,\n{name}' },
  followup1: { label: 'First follow-up after applying', subject: 'Following up: {title} application',
    body: 'Dear {recruiter},\n\nI applied for the {title} position at {company} on {date} and wanted to follow up on my application. I remain interested in the role and would be happy to provide any further information.\n\nThank you for your time.\n\nKind regards,\n{name}' },
  followup2: { label: 'Second follow-up after no response', subject: 'Second follow-up: {title} at {company}',
    body: 'Dear {recruiter},\n\nI am following up again on my application for the {title} position at {company}, submitted on {date}. I understand you may be busy, and I would appreciate an update on the status when convenient.\n\nThank you for your consideration.\n\nKind regards,\n{name}' },
  thankyou: { label: 'Thank-you email after an interview', subject: 'Thank you – {title} interview',
    body: 'Dear {recruiter},\n\nThank you for taking the time to speak with me about the {title} role at {company}. I enjoyed learning more about the team and the position.\n\nPlease let me know if you need anything further from me.\n\nKind regards,\n{name}' },
  response: { label: 'Recruiter response after submitting a resume', subject: 'Re: {title} – {company}',
    body: 'Dear {recruiter},\n\nThank you for getting back to me about the {title} position at {company}. I am happy to proceed and can share any additional details you need.\n\nKind regards,\n{name}' }
};

let state = { apps: [], sampleOn: false, name: '', templates: {} };
let currentId = null;      // application used by the detail / email dialogs
let editingId = null;      // application being edited in the form
let followDirty = false;   // true when user typed their own follow-up date
const notified = new Set();

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

/* ---------- helpers ---------- */
function esc(v) {
  return String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]));
}
const pad = n => String(n).padStart(2, '0');
const toISO = d => d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate());
const today = () => toISO(new Date());
function parseISO(s) { const p = s.split('-').map(Number); return new Date(p[0], p[1] - 1, p[2]); }
function addWorkingDays(startISO, n) {
  const d = parseISO(startISO);
  let left = Math.max(1, Number(n) || 1);
  while (left > 0) { d.setDate(d.getDate() + 1); if (d.getDay() !== 0 && d.getDay() !== 6) left--; }
  return toISO(d);
}
function fmtDate(s) { return s ? parseISO(s).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; }
function newId() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function validEmail(s) { return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(s); }
function validUrl(s) { try { const u = new URL(s); return u.protocol === 'http:' || u.protocol === 'https:'; } catch (e) { return false; } }
function isDup(a, exceptId) {
  const k = x => (x.company + '|' + x.title + '|' + x.appDate).toLowerCase().trim();
  return state.apps.some(o => o.id !== exceptId && k(o) === k(a));
}
function followState(a) {
  if (CLOSED.includes(a.status) || !a.nextFollowUp) return 'none';
  const t = today();
  return a.nextFollowUp < t ? 'overdue' : a.nextFollowUp === t ? 'due' : 'upcoming';
}
function addHistory(a, text) { a.history.push({ date: today(), text }); }

/* ---------- storage ---------- */
function normalize(a) {
  const o = { id: String(a.id), history: Array.isArray(a.history) ? a.history.filter(h => h && h.text) : [], sample: !!a.sample };
  FIELDS.forEach(f => { o[f] = typeof a[f] === 'string' || typeof a[f] === 'number' ? String(a[f]) : ''; });
  if (!STATUSES.includes(o.status)) o.status = 'Applied';
  if (!/^\d{4}-\d{2}-\d{2}$/.test(o.appDate)) o.appDate = today();
  return o;
}
function load() {
  try {
    const d = JSON.parse(localStorage.getItem(KEY) || '{}') || {};
    state.apps = Array.isArray(d.apps) ? d.apps.filter(a => a && a.id && a.company && a.title).map(normalize) : [];
    state.sampleOn = !!d.sampleOn;
    state.name = typeof d.name === 'string' ? d.name : '';
    state.templates = d.templates && typeof d.templates === 'object' ? d.templates : {};
  } catch (e) { state.apps = []; }
}
function save() {
  try { localStorage.setItem(KEY, JSON.stringify(state)); }
  catch (e) { alert('Could not save to LocalStorage (it may be full or blocked). Export a CSV backup now.'); }
  renderAll();
}
function getTemplate(k) {
  const t = state.templates[k];
  return t && typeof t.subject === 'string' && typeof t.body === 'string' ? t : DEFAULT_TEMPLATES[k];
}

/* ---------- rendering ---------- */
function badgeClass(status) {
  if (status === 'Offer Received') return 's-Offer';
  if (status === 'Interview Scheduled') return 's-Interview';
  if (status === 'Rejected' || status === 'Withdrawn') return 's-' + status;
  return '';
}
function statusBadges(a) {
  const f = followState(a);
  const label = { overdue: 'Overdue', due: 'Due today', upcoming: 'Upcoming' }[f];
  return '<span class="badge ' + badgeClass(a.status) + '">' + esc(a.status) + '</span>' + (label ? '<span class="badge ' + f + '">' + label + '</span>' : '');
}
function renderDashboard() {
  const t = today();
  const wk = parseISO(t); wk.setDate(wk.getDate() - ((wk.getDay() + 6) % 7));
  const weekStart = toISO(wk);
  const n = fn => state.apps.filter(fn).length;
  const stats = [
    ['Total applications', state.apps.length, ''],
    ['Submitted this week', n(a => a.appDate >= weekStart && a.appDate <= t), ''],
    ['Follow-ups due today', n(a => followState(a) === 'due'), ''],
    ['Overdue follow-ups', n(a => followState(a) === 'overdue'), n(a => followState(a) === 'overdue') ? 'bad' : ''],
    ['Interviews scheduled', n(a => a.status === 'Interview Scheduled'), ''],
    ['Offers received', n(a => a.status === 'Offer Received'), '']
  ];
  $('#stats').innerHTML = stats.map(s => '<div class="stat ' + s[2] + '"><b>' + s[1] + '</b><span>' + s[0] + '</span></div>').join('');
  const up = state.apps.filter(a => followState(a) !== 'none').sort((a, b) => a.nextFollowUp.localeCompare(b.nextFollowUp)).slice(0, 6);
  $('#upcoming').innerHTML = up.length ? up.map(a =>
    '<div class="row"><span><a href="#" data-act="view" data-id="' + a.id + '">' + esc(a.company) + '</a> – ' + esc(a.title) + '</span><span>' + fmtDate(a.nextFollowUp) + ' ' + statusBadges(a).split('</span>').pop() + '</span></div>').join('')
    : '<p class="empty">No follow-ups scheduled.</p>';
  const acts = [];
  state.apps.forEach(a => a.history.forEach(h => acts.push({ d: h.date, text: a.company + ': ' + h.text })));
  acts.sort((x, y) => y.d.localeCompare(x.d));
  $('#activity').innerHTML = acts.length ? acts.slice(0, 8).map(x => '<div class="row"><span>' + esc(x.text) + '</span><span>' + fmtDate(x.d) + '</span></div>').join('')
    : '<p class="empty">No activity yet. Add your first application.</p>';
}
function filteredApps() {
  const q = $('#search').value.trim().toLowerCase();
  let list = state.apps.filter(a => (!q || (a.company + ' ' + a.title).toLowerCase().includes(q))
    && (!$('#fStatus').value || a.status === $('#fStatus').value)
    && (!$('#fMethod').value || a.method === $('#fMethod').value)
    && (!$('#fFollow').value || followState(a) === $('#fFollow').value));
  const s = $('#sort').value;
  list.sort((a, b) => s === 'oldest' ? a.appDate.localeCompare(b.appDate)
    : s === 'follow' ? (a.nextFollowUp || '9999').localeCompare(b.nextFollowUp || '9999')
    : b.appDate.localeCompare(a.appDate));
  return list;
}
function renderList() {
  const list = filteredApps();
  $('#list').innerHTML = list.length ? list.map(a =>
    '<div class="card ' + followState(a) + '"><h4>' + esc(a.company) + ' – ' + esc(a.title) + '</h4>' +
    '<div>' + statusBadges(a) + '</div>' +
    '<div class="meta">Applied ' + fmtDate(a.appDate) + ' via ' + esc(a.method) + ' · Next follow-up: ' + fmtDate(a.nextFollowUp) + '</div>' +
    '<div class="actions"><button data-act="view" data-id="' + a.id + '">View</button><button data-act="email" data-id="' + a.id + '">Follow-up</button>' +
    '<button data-act="edit" data-id="' + a.id + '">Edit</button><button class="del" data-act="delete" data-id="' + a.id + '">Delete</button></div></div>').join('')
    : '<p class="empty">' + (state.apps.length ? 'No applications match your filters.' : 'No applications yet. Click “Add application” to start.') + '</p>';
}
function renderTemplates() {
  $('#yourName').value = state.name;
  $('#tplList').innerHTML = Object.keys(DEFAULT_TEMPLATES).map(k => {
    const t = getTemplate(k);
    return '<h4>' + DEFAULT_TEMPLATES[k].label + '</h4><label>Subject<input data-tpl="' + k + '" data-part="subject" value="' + esc(t.subject) + '"></label>' +
      '<label>Body<textarea rows="7" data-tpl="' + k + '" data-part="body">' + esc(t.body) + '</textarea></label>';
  }).join('');
}
function renderAll() { renderDashboard(); renderList(); $('#sampleToggle').checked = state.sampleOn; }

/* ---------- views ---------- */
function showView(name) {
  $$('section[id^="view-"]').forEach(s => s.hidden = s.id !== 'view-' + name);
  $$('#nav button').forEach(b => b.classList.toggle('active', b.dataset.view === name));
  $('#viewTitle').textContent = { dashboard: 'Dashboard', applications: 'Applications', templates: 'Email templates', settings: 'Backup & data' }[name];
  if (name === 'templates') renderTemplates();
}

/* ---------- add / edit form ---------- */
function fillSelect(sel, items, anyLabel) {
  sel.innerHTML = (anyLabel ? '<option value="">' + anyLabel + '</option>' : '') + items.map(i => '<option>' + i + '</option>').join('');
}
function suggestFollowUp() {
  const f = $('#appForm');
  if (!followDirty && f.appDate.value) f.nextFollowUp.value = addWorkingDays(f.appDate.value, f.interval.value);
}
function openForm(id) {
  const f = $('#appForm');
  f.reset(); $('#formError').textContent = '';
  editingId = id || null;
  $('#formTitle').textContent = id ? 'Edit application' : 'Add application';
  if (id) {
    const a = state.apps.find(x => x.id === id);
    FIELDS.forEach(k => { if (f.elements[k]) f.elements[k].value = a[k]; });
    followDirty = true;
  } else {
    f.appDate.value = today(); followDirty = false; suggestFollowUp();
  }
  $('#formDialog').showModal();
}
function saveForm(e) {
  e.preventDefault();
  const f = $('#appForm'), v = {};
  FIELDS.forEach(k => { if (f.elements[k]) v[k] = f.elements[k].value.trim(); });
  const errs = [];
  if (!v.company) errs.push('Company name is required.');
  if (!v.title) errs.push('Job title is required.');
  if (!v.appDate) errs.push('Application date is required.');
  if (v.email && !validEmail(v.email)) errs.push('Recruiter email is not a valid email address.');
  if (v.url && !validUrl(v.url)) errs.push('Job URL must start with http:// or https://.');
  if (!(Number(v.interval) >= 1 && Number(v.interval) <= 60)) errs.push('Follow-up interval must be 1–60 working days.');
  if (v.nextFollowUp && v.appDate && v.nextFollowUp < v.appDate) errs.push('Next follow-up cannot be before the application date.');
  const old = editingId ? state.apps.find(x => x.id === editingId) : null;
  const rec = Object.assign({ lastFollowUp: old ? old.lastFollowUp : '' }, v, { lastFollowUp: old ? old.lastFollowUp : '' });
  if (!errs.length && isDup(rec, editingId)) errs.push('This looks like a duplicate: same company, title and application date already exist.');
  if (errs.length) { $('#formError').textContent = errs.join('\n'); return; }
  if (old) {
    if (old.status !== v.status) addHistory(old, 'Status changed from ' + old.status + ' to ' + v.status);
    else addHistory(old, 'Application details edited');
    Object.assign(old, v);   // appDate only changes if the user edits it here
  } else {
    const a = Object.assign({ id: newId(), history: [], sample: false }, rec);
    addHistory(a, 'Application added (' + a.status + ')');
    state.apps.push(a);
  }
  $('#formDialog').close();
  save();
}

/* ---------- delete ---------- */
function deleteApp(id) {
  const a = state.apps.find(x => x.id === id);
  if (!a || !confirm('Permanently delete the application to ' + a.company + ' (' + a.title + ')? This cannot be undone.')) return;
  state.apps = state.apps.filter(x => x.id !== id);
  $('#detailDialog').close();
  save();
}

/* ---------- detail view, history, follow-up completion ---------- */
function openDetail(id) {
  const a = state.apps.find(x => x.id === id);
  if (!a) return;
  currentId = id;
  const rows = [['Status', a.status], ['Applied', fmtDate(a.appDate)], ['Method', a.method], ['Job type', a.jobType], ['Recruiter', a.recruiter], ['Email', a.email],
    ['URL', a.url], ['Location', a.location], ['Expected salary', a.salary], ['Work pass needed', a.sponsor], ['Follow-up interval', a.interval + ' working days'],
    ['Next follow-up', fmtDate(a.nextFollowUp)], ['Last follow-up', fmtDate(a.lastFollowUp)], ['Notes', a.notes]];
  const link = v => validUrl(v) ? '<a href="' + esc(v) + '" target="_blank" rel="noopener noreferrer">' + esc(v) + '</a>' : esc(v);
  $('#detailBody').innerHTML = '<div class="detail"><h3>' + esc(a.company) + ' – ' + esc(a.title) + '</h3><div>' + statusBadges(a) + '</div><dl>' +
    rows.map(r => '<dt>' + r[0] + '</dt><dd>' + (r[0] === 'URL' ? link(r[1]) : esc(r[1] || '—')) + '</dd>').join('') + '</dl>' +
    '<label>Note / recruiter response<input id="dNote" placeholder="e.g. Recruiter replied, interview next week"></label>' +
    '<div class="actions" style="justify-content:flex-start"><button data-act="logResponse">Log recruiter response</button><button data-act="complete" class="primary">Mark follow-up completed</button></div>' +
    '<h4>History</h4><ul class="hist">' + a.history.slice().reverse().map(h => '<li>' + fmtDate(h.date) + ' – ' + esc(h.text) + '</li>').join('') + '</ul>' +
    '<div class="actions"><button data-act="email" data-id="' + a.id + '">Follow-up email</button><button data-act="edit" data-id="' + a.id + '">Edit</button><button class="del" data-act="delete" data-id="' + a.id + '">Delete</button><button class="close">Close</button></div></div>';
  if (!$('#detailDialog').open) $('#detailDialog').showModal();
}
function logResponse() {
  const a = state.apps.find(x => x.id === currentId), note = $('#dNote').value.trim();
  if (!note) { alert('Type a note first.'); return; }
  addHistory(a, 'Recruiter response: ' + note);
  if (a.status === 'Applied' || a.status === 'Follow-up Due') { a.status = 'Recruiter Replied'; addHistory(a, 'Status changed to Recruiter Replied'); }
  save(); openDetail(a.id);
}
function completeFollowUp() {
  const a = state.apps.find(x => x.id === currentId), note = $('#dNote').value.trim();
  a.lastFollowUp = today();   // the original application date is never touched
  addHistory(a, 'Follow-up completed' + (note ? ': ' + note : ''));
  const suggestion = addWorkingDays(today(), a.interval);
  if (confirm('Follow-up recorded. Set the next follow-up to ' + fmtDate(suggestion) + '?\n\nOK = use this date, Cancel = no follow-up scheduled (you can set one later via Edit).')) a.nextFollowUp = suggestion;
  else a.nextFollowUp = '';
  save(); openDetail(a.id);
}

/* ---------- follow-up email ---------- */
function fillTemplate(text, a) {
  return text.replace(/\{company\}/g, a.company).replace(/\{title\}/g, a.title).replace(/\{recruiter\}/g, a.recruiter || 'Hiring Manager')
    .replace(/\{date\}/g, fmtDate(a.appDate)).replace(/\{name\}/g, state.name || '[Your name]');
}
function loadEmail() {
  const a = state.apps.find(x => x.id === currentId), t = getTemplate($('#emTpl').value);
  $('#emSubject').value = fillTemplate(t.subject, a);
  $('#emBody').value = fillTemplate(t.body, a);
}
function openEmail(id) {
  const a = state.apps.find(x => x.id === id);
  if (!a) return;
  currentId = id;
  $('#emTpl').innerHTML = Object.keys(DEFAULT_TEMPLATES).map(k => '<option value="' + k + '">' + DEFAULT_TEMPLATES[k].label + '</option>').join('');
  $('#emTpl').value = a.lastFollowUp ? 'followup2' : 'followup1';
  $('#emTo').value = a.email;
  loadEmail();
  if ($('#detailDialog').open) $('#detailDialog').close();
  $('#emailDialog').showModal();
}
function copyEmail() {
  const text = 'Subject: ' + $('#emSubject').value + '\n\n' + $('#emBody').value;
  const fallback = () => { const t = $('#emBody'); t.select(); document.execCommand('copy'); alert('Copied.'); };
  if (navigator.clipboard) navigator.clipboard.writeText(text).then(() => alert('Copied to clipboard.'), fallback); else fallback();
}
function openMailApp() {
  const to = $('#emTo').value.trim();
  if (!validEmail(to)) { alert('Enter a valid recipient email first.'); return; }
  location.href = 'mailto:' + encodeURIComponent(to) + '?subject=' + encodeURIComponent($('#emSubject').value) + '&body=' + encodeURIComponent($('#emBody').value);
}
function logEmailSent() {
  if (!confirm('Only confirm if you actually sent this email. Log it in the history?')) return;
  const a = state.apps.find(x => x.id === currentId);
  a.lastFollowUp = today();
  addHistory(a, 'Email sent by you: ' + $('#emSubject').value);
  $('#emailDialog').close();
  save(); openDetail(a.id);
}

/* ---------- CSV ---------- */
function csvCell(v) { v = String(v == null ? '' : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
function exportCSV() {
  if (!state.apps.length) { alert('There is nothing to export yet.'); return false; }
  const lines = [FIELDS.join(',')].concat(state.apps.map(a => FIELDS.map(f => csvCell(a[f])).join(',')));
  const blob = new Blob(['\uFEFF' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob); link.download = 'jobtrack-backup-' + today() + '.csv';
  document.body.appendChild(link); link.click(); link.remove();
  return true;
}
function parseCSV(text) {
  const rows = []; let row = [], cell = '', q = false;
  text = text.replace(/^\uFEFF/, '');
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) { if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c; }
    else if (c === '"') q = true;
    else if (c === ',') { row.push(cell); cell = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && text[i + 1] === '\n') i++; row.push(cell); rows.push(row); row = []; cell = ''; }
    else cell += c;
  }
  if (cell || row.length) { row.push(cell); rows.push(row); }
  return rows.filter(r => r.some(c => c.trim()));
}
function importCSV(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const rows = parseCSV(String(reader.result));
    if (rows.length < 2 || !rows[0].includes('company')) { alert('This file is not a JobTrack CSV backup.'); return; }
    const head = rows[0].map(h => h.trim());
    let added = 0, skipped = 0;
    rows.slice(1).forEach(r => {
      const obj = {}; head.forEach((h, i) => { obj[h] = r[i] || ''; });
      if (!obj.company || !obj.title) { skipped++; return; }
      const a = normalize(Object.assign(obj, { id: newId(), history: [] }));
      if (isDup(a)) { skipped++; return; }
      addHistory(a, 'Imported from CSV'); state.apps.push(a); added++;
    });
    save(); alert('Imported ' + added + ' application(s). Skipped ' + skipped + ' (duplicates or invalid rows).');
  };
  reader.readAsText(file);
}

/* ---------- sample data, clear, notifications ---------- */
function setSample(on) {
  state.sampleOn = on;
  state.apps = state.apps.filter(a => !a.sample);
  if (on) {
    const ago = n => { const d = new Date(); d.setDate(d.getDate() - n); return toISO(d); };
    [['Example Pte Ltd', 'QA Automation Engineer', 'Company Website', 'Applied', 9, 5],
     ['Sample Tech', 'Test Engineer', 'LinkedIn', 'Interview Scheduled', 3, 5],
     ['Demo Bank', 'SDET', 'Recruitment Agency', 'Applied', 1, 5]].forEach(s => {
      const a = normalize({ id: newId(), company: s[0], title: s[1], method: s[2], status: s[3], appDate: ago(s[4]), interval: s[5], jobType: 'Full-time', sponsor: 'No', sample: true });
      a.sample = true; a.nextFollowUp = addWorkingDays(a.appDate, s[5]); addHistory(a, 'Sample application added');
      state.apps.push(a);
    });
  }
  save();
}
function clearAll() {
  if (!confirm('Delete ALL applications and settings? A CSV backup will be downloaded first.')) return;
  if (state.apps.length && !exportCSV()) return;
  state.apps = []; state.sampleOn = false; state.templates = {};
  save();
}
function checkDue() {
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  state.apps.forEach(a => {
    const f = followState(a), key = a.id + today();
    if ((f === 'due' || f === 'overdue') && !notified.has(key)) {
      notified.add(key);
      new Notification('Follow-up ' + (f === 'due' ? 'due today' : 'overdue'), { body: a.company + ' – ' + a.title });
    }
  });
}
function enableNotifications() {
  if (!('Notification' in window)) { $('#notifyMsg').textContent = 'This browser does not support notifications.'; return; }
  Notification.requestPermission().then(p => {
    $('#notifyMsg').textContent = p === 'granted' ? 'Enabled. You will be notified of due follow-ups while this page is open. Nothing is sent when the browser is closed.' : 'Permission was not granted, so no notifications will be shown.';
    checkDue();
  });
}

/* ---------- wiring ---------- */
function init() {
  load();
  fillSelect($('#fStatus'), STATUSES, 'All statuses');
  fillSelect($('#fMethod'), METHODS, 'All methods');
  const f = $('#appForm');
  fillSelect(f.method, METHODS); fillSelect(f.jobType, TYPES); fillSelect(f.status, STATUSES);

  $('#nav').addEventListener('click', e => { if (e.target.dataset.view) showView(e.target.dataset.view); });
  $('#addBtn').addEventListener('click', () => openForm());
  f.addEventListener('submit', saveForm);
  f.appDate.addEventListener('change', suggestFollowUp);
  f.interval.addEventListener('input', suggestFollowUp);
  f.nextFollowUp.addEventListener('input', () => { followDirty = true; });
  ['search', 'fStatus', 'fMethod', 'fFollow', 'sort'].forEach(id => $('#' + id).addEventListener('input', renderList));

  document.addEventListener('click', e => {
    if (e.target.classList.contains('close')) { e.target.closest('dialog').close(); return; }
    const el = e.target.closest('[data-act]');
    if (!el) return;
    e.preventDefault();
    const act = el.dataset.act, id = el.dataset.id;
    if (act === 'view') { if (id) openDetail(id); }
    else if (act === 'edit') { $('#detailDialog').close(); openForm(id); }
    else if (act === 'delete') deleteApp(id);
    else if (act === 'email') openEmail(id);
    else if (act === 'logResponse') logResponse();
    else if (act === 'complete') completeFollowUp();
  });

  $('#emTpl').addEventListener('change', loadEmail);
  $('#emCopy').addEventListener('click', copyEmail);
  $('#emOpen').addEventListener('click', openMailApp);
  $('#emSent').addEventListener('click', logEmailSent);

  $('#saveTpl').addEventListener('click', () => {
    state.name = $('#yourName').value.trim();
    $$('[data-tpl]').forEach(el => {
      const k = el.dataset.tpl;
      state.templates[k] = Object.assign({}, getTemplate(k), { [el.dataset.part]: el.value });
    });
    save(); alert('Templates saved.');
  });
  $('#resetTpl').addEventListener('click', () => { if (confirm('Reset all templates to the defaults?')) { state.templates = {}; save(); renderTemplates(); } });

  $('#exportBtn').addEventListener('click', exportCSV);
  $('#importFile').addEventListener('change', e => { if (e.target.files[0]) importCSV(e.target.files[0]); e.target.value = ''; });
  $('#sampleToggle').addEventListener('change', e => setSample(e.target.checked));
  $('#clearBtn').addEventListener('click', clearAll);
  $('#notifyBtn').addEventListener('click', enableNotifications);

  renderAll();
  checkDue();
  setInterval(checkDue, 60000);
}
init();
