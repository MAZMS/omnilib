// --- Theme ---
(function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('theme-icon').textContent = '\u2600\uFE0F';
  }
  document.getElementById('theme-toggle').addEventListener('click', () => {
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
    if (isDark) {
      document.documentElement.removeAttribute('data-theme');
      document.getElementById('theme-icon').textContent = '\uD83C\uDF19';
      localStorage.setItem('theme', 'light');
    } else {
      document.documentElement.setAttribute('data-theme', 'dark');
      document.getElementById('theme-icon').textContent = '\u2600\uFE0F';
      localStorage.setItem('theme', 'dark');
    }
  });
})();

// --- State ---
let adminKey = localStorage.getItem('adminKey') || '';
let tools = [];
let categories = [];
let editingId = null;
let tableSearch = '';
let tableCatFilter = '';
let tablePricingFilter = '';
let tableSort = { key: 'name', dir: 'asc' };
let tablePage = 1;
const PAGE_SIZE = 30;

// --- AI Budget config ---
const AI_BUDGETS = {
  premium: { limit: 250000, label: 'Premium Models', models: 'gpt-5.4, gpt-4.1, gpt-4o, o1, o3' },
  mini: { limit: 2500000, label: 'Mini Models', models: 'gpt-4.1-nano, gpt-4.1-mini, gpt-4o-mini, o1-mini, o3-mini, o4-mini' }
};

// Model classification
function getModelTier(model) {
  const mini = ['nano', 'mini'];
  return mini.some(m => model.includes(m)) ? 'mini' : 'premium';
}

// --- Init ---
async function init() {
  if (adminKey) await tryAuth();
  bindEvents();
}

async function tryAuth() {
  try {
    const res = await fetch('/api/tools');
    if (res.ok) {
      tools = await res.json();
      const catsRes = await fetch('/api/categories');
      categories = await catsRes.json();
      showPanel();
    }
  } catch (e) {
    console.error('Failed to load tools');
  }
}

function showPanel() {
  document.getElementById('admin-auth').style.display = 'none';
  document.getElementById('admin-panel').style.display = 'block';
  populateCategorySelect();
  populateAdminCatFilter();
  renderStats();
  renderTable();
  loadFeedbackBadge();
  loadSubsBadge();
}

// --- Tabs ---
function switchTab(tabId) {
  document.querySelectorAll('.admin-tab').forEach(t => t.classList.toggle('active', t.dataset.tab === tabId));
  document.querySelectorAll('.admin-tab-content').forEach(c => c.style.display = 'none');
  document.getElementById('tab-' + tabId).style.display = '';

  if (tabId === 'subscribers') loadSubscribers();
  if (tabId === 'submissions') loadSubmissions();
  if (tabId === 'feedback') loadFeedback();
  if (tabId === 'traffic') loadTraffic();
  if (tabId === 'ai-usage') loadAiUsage();
  if (tabId === 'analytics') renderAnalytics();
}

// --- Render Stats ---
function renderStats() {
  const totalClicks = tools.reduce((sum, t) => sum + t.clicks, 0);
  const featured = tools.filter(t => t.featured).length;
  const trending = tools.filter(t => t.trendingScore >= 80).length;
  const catCount = new Set(tools.map(t => t.category)).size;
  document.getElementById('admin-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${tools.length}</div><div class="stat-label">Total Tools</div></div>
    <div class="stat-card"><div class="stat-value">${totalClicks}</div><div class="stat-label">Total Clicks</div></div>
    <div class="stat-card"><div class="stat-value">${featured}</div><div class="stat-label">Featured</div></div>
    <div class="stat-card"><div class="stat-value">${trending}</div><div class="stat-label">Trending</div></div>
    <div class="stat-card"><div class="stat-value">${catCount}</div><div class="stat-label">Categories</div></div>
  `;
}

// --- Table with search, sort, pagination ---
function getFilteredTools() {
  let filtered = [...tools];
  if (tableSearch) {
    const q = tableSearch.toLowerCase();
    filtered = filtered.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.slug.toLowerCase().includes(q) ||
      (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)))
    );
  }
  if (tableCatFilter) filtered = filtered.filter(t => t.category === tableCatFilter);
  if (tablePricingFilter) filtered = filtered.filter(t => t.pricing === tablePricingFilter);

  // Sort
  filtered.sort((a, b) => {
    let va = a[tableSort.key], vb = b[tableSort.key];
    if (typeof va === 'string') va = va.toLowerCase();
    if (typeof vb === 'string') vb = vb.toLowerCase();
    if (typeof va === 'boolean') { va = va ? 1 : 0; vb = vb ? 1 : 0; }
    if (va < vb) return tableSort.dir === 'asc' ? -1 : 1;
    if (va > vb) return tableSort.dir === 'asc' ? 1 : -1;
    return 0;
  });

  return filtered;
}

function renderTable() {
  const filtered = getFilteredTools();
  const totalPages = Math.ceil(filtered.length / PAGE_SIZE);
  if (tablePage > totalPages) tablePage = totalPages || 1;

  const start = (tablePage - 1) * PAGE_SIZE;
  const pageTools = filtered.slice(start, start + PAGE_SIZE);

  document.getElementById('admin-result-count').textContent = `${filtered.length} of ${tools.length}`;

  const tbody = document.getElementById('admin-table-body');
  tbody.innerHTML = pageTools.map(t => `
    <tr>
      <td><strong>${t.name}</strong><div style="font-size:11px;color:var(--text-muted)">${t.slug}</div></td>
      <td>${t.category}</td>
      <td><span class="pricing-badge ${t.pricing}" style="font-size:11px;">${t.pricing}</span></td>
      <td>${t.rating}</td>
      <td>${t.clicks}</td>
      <td>${t.featured ? 'Yes' : '-'}</td>
      <td class="actions">
        <button class="btn btn-sm" onclick="editTool('${t.id}')">Edit</button>
        <button class="btn btn-sm btn-danger" onclick="deleteTool('${t.id}')">Delete</button>
      </td>
    </tr>
  `).join('');

  // Sort indicators
  document.querySelectorAll('.sortable').forEach(th => {
    th.classList.toggle('sort-active', th.dataset.sort === tableSort.key);
    th.classList.toggle('sort-desc', th.dataset.sort === tableSort.key && tableSort.dir === 'desc');
  });

  renderPagination(filtered.length, totalPages);
}

function renderPagination(total, totalPages) {
  const container = document.getElementById('admin-pagination');
  if (totalPages <= 1) { container.innerHTML = ''; return; }

  let html = '';
  html += `<button class="btn btn-sm" ${tablePage <= 1 ? 'disabled' : ''} onclick="goPage(${tablePage - 1})">&larr;</button>`;
  for (let p = 1; p <= totalPages; p++) {
    if (p === 1 || p === totalPages || Math.abs(p - tablePage) <= 2) {
      html += `<button class="btn btn-sm ${p === tablePage ? 'btn-primary' : ''}" onclick="goPage(${p})">${p}</button>`;
    } else if (Math.abs(p - tablePage) === 3) {
      html += '<span style="padding:0 6px;color:var(--text-muted)">...</span>';
    }
  }
  html += `<button class="btn btn-sm" ${tablePage >= totalPages ? 'disabled' : ''} onclick="goPage(${tablePage + 1})">&rarr;</button>`;
  container.innerHTML = html;
}

function goPage(p) { tablePage = p; renderTable(); }

function populateAdminCatFilter() {
  const select = document.getElementById('admin-cat-filter');
  categories.forEach(c => {
    const opt = document.createElement('option');
    opt.value = c.id;
    opt.textContent = `${c.icon} ${c.name}`;
    select.appendChild(opt);
  });
}

function populateCategorySelect() {
  const select = document.getElementById('form-category');
  select.innerHTML = categories.map(c =>
    `<option value="${c.id}">${c.icon} ${c.name}</option>`
  ).join('');
}

// --- Subscribers ---
async function loadSubscribers() {
  try {
    const res = await fetch('/api/admin/subscribers', { headers: { 'Authorization': `Bearer ${adminKey}` } });
    if (!res.ok) return;
    const subs = await res.json();
    const badge = document.getElementById('subs-count-badge');
    if (badge) badge.textContent = subs.length;
    document.getElementById('subs-total').textContent = subs.length + ' subscribers';

    if (subs.length === 0) {
      document.getElementById('subscribers-list').innerHTML = '<div style="text-align:center;padding:60px 0;color:#666"><div style="font-size:32px;margin-bottom:8px">&#x1F4E7;</div>No subscribers yet</div>';
      return;
    }

    document.getElementById('subscribers-list').innerHTML = `
      <div style="background:#141414;border:1px solid #252525;border-radius:12px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse;font-size:13px">
          <thead><tr>
            <th style="text-align:left;padding:12px 16px;border-bottom:1px solid #252525;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">#</th>
            <th style="text-align:left;padding:12px 16px;border-bottom:1px solid #252525;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Email</th>
            <th style="text-align:left;padding:12px 16px;border-bottom:1px solid #252525;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Date</th>
            <th style="text-align:right;padding:12px 16px;border-bottom:1px solid #252525;color:#888;font-size:11px;text-transform:uppercase;letter-spacing:0.5px">Action</th>
          </tr></thead>
          <tbody>${subs.map((s, i) => `<tr style="border-bottom:1px solid #252525">
            <td style="padding:10px 16px;color:#888">${i + 1}</td>
            <td style="padding:10px 16px;font-weight:600">${escapeHtml(s.email)}</td>
            <td style="padding:10px 16px;color:#888">${new Date(s.date).toLocaleDateString()}</td>
            <td style="padding:10px 16px;text-align:right"><button onclick="removeSub('${s.email}')" style="padding:4px 12px;font-family:var(--font);font-size:11px;border:1px solid #333;border-radius:6px;background:none;color:#ea580c;cursor:pointer">Remove</button></td>
          </tr>`).join('')}</tbody>
        </table>
      </div>`;
  } catch {
    document.getElementById('subscribers-list').innerHTML = '<p style="color:#666">Failed to load.</p>';
  }
}

async function removeSub(email) {
  if (!confirm('Remove ' + email + '?')) return;
  await fetch('/api/admin/subscribers/' + encodeURIComponent(email), {
    method: 'DELETE', headers: { 'Authorization': `Bearer ${adminKey}` }
  });
  loadSubscribers();
}

// --- Submissions ---
let subsData = [];
let subsFilter = '';

async function loadSubsBadge() {
  try {
    const res = await fetch('/api/admin/submissions', { headers: { 'Authorization': `Bearer ${adminKey}` } });
    if (!res.ok) return;
    subsData = await res.json();
    const newCount = subsData.filter(s => s.status === 'new').length;
    const badge = document.getElementById('submissions-badge');
    if (badge) { badge.textContent = newCount; badge.style.display = newCount > 0 ? 'inline' : 'none'; }
  } catch {}
}

async function loadSubmissions() {
  try {
    const res = await fetch('/api/admin/submissions', { headers: { 'Authorization': `Bearer ${adminKey}` } });
    if (!res.ok) return;
    subsData = await res.json();
    renderSubsList();
  } catch {
    document.getElementById('submissions-list').innerHTML = '<p style="color:#666">Failed to load submissions.</p>';
  }
}

function filterSubs(status) {
  subsFilter = status;
  document.querySelectorAll('#sub-filters button').forEach((b, i) => {
    const isActive = (i === 0 && !status) || b.textContent.toLowerCase().trim() === status;
    b.style.background = isActive ? '#f5f5f5' : 'none';
    b.style.color = isActive ? '#0a0a0a' : '#888';
    b.style.border = isActive ? 'none' : '1px solid #333';
  });
  renderSubsList();
}

function renderSubsList() {
  const filtered = subsFilter ? subsData.filter(s => s.status === subsFilter) : subsData;
  const list = document.getElementById('submissions-list');

  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:60px 0;color:#666"><div style="font-size:32px;margin-bottom:8px">&#x1F4E5;</div>No submissions yet</div>';
    return;
  }

  const statusColors = { 'new': '#7c3aed', approved: '#16a34a', rejected: '#ea580c', reviewed: '#2563eb' };
  const catLabels = { chatbots: 'Chatbots', 'image-generation': 'Image Gen', writing: 'Writing', coding: 'Coding', video: 'Video', audio: 'Audio', productivity: 'Productivity', research: 'Research', design: 'Design', marketing: 'Marketing' };
  const pricingLabels = { free: 'Free', freemium: 'Freemium', paid: 'Paid', 'open-source': 'Open Source' };

  list.innerHTML = filtered.map(s => {
    const color = statusColors[s.status] || '#888';
    const ago = timeAgo(s.date);
    return `<div style="background:#141414;border:1px solid ${s.status === 'new' ? color : '#252525'};border-radius:12px;padding:24px;margin-bottom:12px;${s.status !== 'new' ? 'opacity:0.8' : ''}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:14px;flex-wrap:wrap">
        <span style="padding:3px 10px;font-size:11px;font-weight:600;border-radius:999px;background:${color}22;color:${color};text-transform:uppercase">${s.status}</span>
        <span style="font-size:11px;color:#888">${ago}</span>
        <span style="font-size:11px;color:#888;margin-left:auto">${s.email}</span>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px;margin-bottom:14px">
        <div style="background:#1a1a1a;border:1px solid #252525;border-radius:8px;padding:12px">
          <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Tool Name</div>
          <div style="font-size:14px;font-weight:700">${escapeHtml(s.toolName)}</div>
        </div>
        <div style="background:#1a1a1a;border:1px solid #252525;border-radius:8px;padding:12px">
          <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Website</div>
          <a href="${escapeHtml(s.url)}" target="_blank" rel="noopener" style="font-size:13px;color:#2563eb;word-break:break-all">${escapeHtml(s.url)}</a>
        </div>
        <div style="background:#1a1a1a;border:1px solid #252525;border-radius:8px;padding:12px">
          <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Category</div>
          <div style="font-size:13px">${catLabels[s.category] || s.category || '—'}</div>
        </div>
        <div style="background:#1a1a1a;border:1px solid #252525;border-radius:8px;padding:12px">
          <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Pricing</div>
          <div style="font-size:13px">${pricingLabels[s.pricing] || s.pricing || '—'}</div>
        </div>
      </div>
      <div style="background:#1a1a1a;border:1px solid #252525;border-radius:8px;padding:12px;margin-bottom:14px">
        <div style="font-size:10px;color:#888;text-transform:uppercase;letter-spacing:0.5px;margin-bottom:4px">Description</div>
        <p style="font-size:13px;line-height:1.7;white-space:pre-wrap">${escapeHtml(s.description)}</p>
      </div>
      <div style="display:flex;gap:8px">
        ${s.status === 'new' ? `<button onclick="updateSub('${s.id}','approved')" style="padding:6px 16px;font-family:var(--font);font-size:12px;font-weight:600;border:none;border-radius:6px;background:#16a34a;color:#fff;cursor:pointer">Approve</button>` : ''}
        ${s.status === 'new' ? `<button onclick="updateSub('${s.id}','rejected')" style="padding:6px 16px;font-family:var(--font);font-size:12px;font-weight:600;border:1px solid #333;border-radius:6px;background:none;color:#ea580c;cursor:pointer">Reject</button>` : ''}
        ${s.status !== 'new' ? `<button onclick="updateSub('${s.id}','new')" style="padding:6px 16px;font-family:var(--font);font-size:12px;font-weight:600;border:1px solid #333;border-radius:6px;background:none;color:#888;cursor:pointer">Reopen</button>` : ''}
        <button onclick="deleteSub('${s.id}')" style="padding:6px 16px;font-family:var(--font);font-size:12px;font-weight:600;border:1px solid #333;border-radius:6px;background:none;color:#ea580c;cursor:pointer;margin-left:auto">Delete</button>
      </div>
    </div>`;
  }).join('');
}

async function updateSub(id, status) {
  await fetch(`/api/admin/submissions/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
    body: JSON.stringify({ status })
  });
  loadSubmissions();
  loadSubsBadge();
}

async function deleteSub(id) {
  if (!confirm('Delete this submission?')) return;
  await fetch(`/api/admin/submissions/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminKey}` }
  });
  loadSubmissions();
  loadSubsBadge();
}

// --- Feedback ---
let feedbackData = [];
let feedbackFilter = '';

async function loadFeedbackBadge() {
  try {
    const res = await fetch('/api/admin/feedback', { headers: { 'Authorization': `Bearer ${adminKey}` } });
    if (!res.ok) return;
    feedbackData = await res.json();
    const unread = feedbackData.filter(f => !f.read).length;
    const badge = document.getElementById('feedback-badge');
    if (badge) { badge.textContent = unread; badge.style.display = unread > 0 ? 'inline' : 'none'; }
  } catch {}
}

async function loadFeedback() {
  try {
    const res = await fetch('/api/admin/feedback', { headers: { 'Authorization': `Bearer ${adminKey}` } });
    if (!res.ok) return;
    feedbackData = await res.json();
    renderFeedbackList();
  } catch {
    document.getElementById('feedback-list').innerHTML = '<p style="color:#666">Failed to load feedback.</p>';
  }
}

function filterFeedback(type) {
  feedbackFilter = type;
  // Update filter buttons
  document.querySelectorAll('#feedback-filters button').forEach((b, i) => {
    const isActive = (i === 0 && !type) || b.textContent.toLowerCase().includes(type);
    b.style.background = isActive ? '#f5f5f5' : 'none';
    b.style.color = isActive ? '#0a0a0a' : '#888';
    b.style.border = isActive ? 'none' : '1px solid #333';
  });
  renderFeedbackList();
}

function renderFeedbackList() {
  const filtered = feedbackFilter ? feedbackData.filter(f => f.type === feedbackFilter) : feedbackData;
  const list = document.getElementById('feedback-list');

  if (filtered.length === 0) {
    list.innerHTML = '<div style="text-align:center;padding:60px 0;color:#666"><div style="font-size:32px;margin-bottom:8px">&#x1F4ED;</div>No feedback yet</div>';
    return;
  }

  const typeColors = { feedback: '#2563eb', bug: '#ea580c', feature: '#7c3aed', other: '#888' };
  const typeLabels = { feedback: 'Feedback', bug: 'Bug', feature: 'Feature', other: 'Other' };

  list.innerHTML = filtered.map(f => {
    const color = typeColors[f.type] || '#888';
    const ago = timeAgo(f.date);
    return `<div style="background:#141414;border:1px solid ${f.read ? '#252525' : color};border-radius:12px;padding:20px;margin-bottom:12px;${f.read ? 'opacity:0.7' : ''}">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <span style="padding:3px 10px;font-size:11px;font-weight:600;border-radius:999px;background:${color}22;color:${color}">${typeLabels[f.type] || f.type}</span>
        <span style="font-size:11px;color:#888">${ago}</span>
        ${f.email ? `<span style="font-size:11px;color:#888;margin-left:auto">${f.email}</span>` : ''}
        ${f.page && f.page !== '/' ? `<span style="font-size:11px;color:#555">${f.page}</span>` : ''}
      </div>
      <p style="font-size:14px;line-height:1.7;margin-bottom:12px;white-space:pre-wrap">${escapeHtml(f.message)}</p>
      <div style="display:flex;gap:8px">
        ${f.read ? '' : `<button onclick="markRead('${f.id}')" style="padding:4px 12px;font-family:var(--font);font-size:11px;font-weight:600;border:1px solid #333;border-radius:6px;background:none;color:#888;cursor:pointer">Mark read</button>`}
        <button onclick="deleteFeedback('${f.id}')" style="padding:4px 12px;font-family:var(--font);font-size:11px;font-weight:600;border:1px solid #333;border-radius:6px;background:none;color:#ea580c;cursor:pointer">Delete</button>
      </div>
    </div>`;
  }).join('');
}

function escapeHtml(s) {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function timeAgo(date) {
  const s = Math.floor((Date.now() - new Date(date)) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return Math.floor(s / 60) + 'm ago';
  if (s < 86400) return Math.floor(s / 3600) + 'h ago';
  return Math.floor(s / 86400) + 'd ago';
}

async function markRead(id) {
  await fetch(`/api/admin/feedback/${id}`, {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
    body: JSON.stringify({ read: true })
  });
  loadFeedback();
  loadFeedbackBadge();
}

async function deleteFeedback(id) {
  if (!confirm('Delete this feedback?')) return;
  await fetch(`/api/admin/feedback/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminKey}` }
  });
  loadFeedback();
  loadFeedbackBadge();
}

// --- Site Traffic ---
let trafficStats = { daily: {}, total: { views: 0, toolViews: 0, affiliateClicks: 0, compareViews: 0, searches: 0 } };
let chartPeriod = 7;
let chartMetric = 'views';

async function loadTraffic() {
  // Render empty state immediately so the chart is always visible
  renderTrafficChart();
  renderTrafficCards();

  // Then fetch real data
  try {
    const res = await fetch('/api/admin/site-stats', {
      headers: { 'Authorization': `Bearer ${adminKey}` }
    });
    if (res.ok) {
      trafficStats = await res.json();
      renderTrafficChart();
      renderTrafficCards();
    }
  } catch (e) { /* empty state already rendered */ }
}

// Global functions so onclick attributes work
function setPeriod(p, btn) {
  chartPeriod = p === 'all' ? 'all' : parseInt(p);
  document.querySelectorAll('#chart-period-pills button').forEach(b => { b.style.background = 'none'; b.style.color = '#888'; });
  btn.style.background = '#fff'; btn.style.color = '#000';
  if (document.documentElement.getAttribute('data-theme') === 'dark') { btn.style.background = '#f5f5f5'; btn.style.color = '#0a0a0a'; }
  renderTrafficChart();
  renderTrafficCards();
}

function setMetric(m, btn) {
  chartMetric = m;
  document.querySelectorAll('#chart-metric-pills button').forEach(b => { b.style.background = 'none'; b.style.color = '#888'; });
  btn.style.background = '#fff'; btn.style.color = '#000';
  if (document.documentElement.getAttribute('data-theme') === 'dark') { btn.style.background = '#f5f5f5'; btn.style.color = '#0a0a0a'; }
  renderTrafficChart();
  renderTrafficCards();
}

function renderTrafficChart() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const numDays = chartPeriod === 'all' ? 30 : chartPeriod;
  const dates = [];
  for (let i = numDays - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(d.toISOString().split('T')[0]); }

  const points = dates.map(date => ({ date, value: (trafficStats.daily[date] || {})[chartMetric] || 0 }));
  const maxVal = Math.max(...points.map(p => p.value), 1);
  const allZero = points.every(p => p.value === 0);
  const showEvery = points.length <= 7 ? 1 : points.length <= 30 ? 5 : 10;
  const gridColor = isDark ? '#333' : '#ddd';
  const barGrad = 'linear-gradient(180deg, #2563eb, #7c3aed)';
  const metricName = { views: 'Views', toolViews: 'Tool Views', affiliateClicks: 'Clicks', searches: 'Searches' }[chartMetric];

  const chartArea = document.getElementById('chart-area');
  if (!chartArea) return;

  // Grid lines (4 horizontal dashed lines)
  let html = '<div style="position:absolute;top:0;left:40px;right:0;bottom:28px;display:flex;flex-direction:column;justify-content:space-between;pointer-events:none">';
  for (let i = 0; i <= 3; i++) {
    const yVal = allZero ? '0' : formatNum(Math.round(maxVal * (1 - i / 3)));
    html += `<div style="border-top:1px dashed ${gridColor};position:relative"><span style="position:absolute;right:100%;top:-8px;padding-right:6px;font-size:10px;color:#888;white-space:nowrap">${i === 3 ? '0' : yVal}</span></div>`;
  }
  html += '</div>';

  // Bars
  html += '<div style="display:flex;align-items:flex-end;gap:2px;height:100%;padding-left:40px;position:relative;z-index:1">';
  points.forEach((p, i) => {
    const pct = allZero ? 0 : (p.value / maxVal * 100);
    const barH = pct > 0 ? pct.toFixed(1) + '%' : '4px';
    const barOpacity = p.value > 0 ? 1 : 0.15;
    const showLabel = i % showEvery === 0 || i === points.length - 1;
    const label = p.date.slice(5);
    html += `<div style="flex:1;display:flex;flex-direction:column;align-items:center;height:100%;justify-content:flex-end;min-width:0">
      <div style="width:100%;max-width:36px;height:${barH};border-radius:4px 4px 0 0;background:${barGrad};opacity:${barOpacity};cursor:pointer;transition:height 400ms ease" title="${p.value} ${metricName} - ${p.date}"></div>
      <span style="font-size:${points.length > 14 ? '8' : '10'}px;color:#888;margin-top:6px;white-space:nowrap">${showLabel ? label : ''}</span>
    </div>`;
  });
  html += '</div>';

  // Empty overlay
  if (allZero) {
    html += `<div style="position:absolute;top:45%;left:50%;transform:translate(-50%,-50%);color:#666;font-size:14px;text-align:center;pointer-events:none;z-index:2">
      <div style="font-size:32px;margin-bottom:8px">📊</div>
      No ${metricName.toLowerCase()} data yet<br><span style="font-size:12px">Traffic will appear as users visit the site</span>
    </div>`;
  }

  chartArea.setAttribute('style', 'height:240px;position:relative;');
  chartArea.innerHTML = html;
}

function renderTrafficCards() {
  const numDays = chartPeriod === 'all' ? 30 : chartPeriod;
  const dates = [];
  for (let i = numDays - 1; i >= 0; i--) { const d = new Date(); d.setDate(d.getDate() - i); dates.push(d.toISOString().split('T')[0]); }

  let pViews = 0, pToolViews = 0, pClicks = 0, pSearches = 0;
  dates.forEach(date => { const d = trafficStats.daily[date] || {}; pViews += d.views || 0; pToolViews += d.toolViews || 0; pClicks += d.affiliateClicks || 0; pSearches += d.searches || 0; });
  const periodLabel = chartPeriod === 'all' ? '30 Days' : chartPeriod + 'D';

  document.getElementById('traffic-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${formatNum(pViews)}</div><div class="stat-label">Views (${periodLabel})</div></div>
    <div class="stat-card"><div class="stat-value">${formatNum(pToolViews)}</div><div class="stat-label">Tool Views</div></div>
    <div class="stat-card"><div class="stat-value">${formatNum(pClicks)}</div><div class="stat-label">Affiliate Clicks</div></div>
    <div class="stat-card"><div class="stat-value">${formatNum(pSearches)}</div><div class="stat-label">Searches</div></div>
    <div class="stat-card"><div class="stat-value">${formatNum(trafficStats.total.views)}</div><div class="stat-label">All-Time</div></div>
  `;

  // Rates
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const bdr = isDark ? '#252525' : '#e5e7eb';
  const tv = pViews || 1;
  const tvRate = ((pToolViews / tv) * 100).toFixed(1);
  const ctr = pToolViews > 0 ? ((pClicks / pToolViews) * 100).toFixed(1) : '0.0';
  const sr = ((pSearches / tv) * 100).toFixed(1);
  const ratesEl = document.getElementById('traffic-rates');
  if (ratesEl) ratesEl.innerHTML = `
    <div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bdr}"><span style="color:#888">Tool View Rate</span><span style="font-size:18px;font-weight:700">${tvRate}%</span></div>
    <div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bdr}"><span style="color:#888">Affiliate CTR</span><span style="font-size:18px;font-weight:700;${parseFloat(ctr) > 5 ? 'color:#16a34a' : ''}">${ctr}%</span></div>
    <div style="display:flex;justify-content:space-between;padding:14px 0;border-bottom:1px solid ${bdr}"><span style="color:#888">Search Rate</span><span style="font-size:18px;font-weight:700">${sr}%</span></div>
    <div style="display:flex;justify-content:space-between;padding:14px 0"><span style="color:#888">Compare Views</span><span style="font-size:18px;font-weight:700">${formatNum(trafficStats.total.compareViews)}</span></div>
  `;

  // Top tools
  const today = new Date().toISOString().split('T')[0];
  const todayData = trafficStats.daily[today] || {};
  const topTools = Object.entries(todayData.topTools || {}).sort((a, b) => b[1] - a[1]).slice(0, 10);
  const ttEl = document.getElementById('traffic-top-tools');
  if (ttEl) ttEl.innerHTML = topTools.length > 0
    ? topTools.map(([slug, views], i) => { const t = tools.find(x => x.slug === slug); return `<div style="display:flex;align-items:center;gap:10px;padding:8px 0;border-bottom:1px solid ${bdr};font-size:13px"><span style="font-weight:700;color:#888;width:20px">${i+1}</span><span>${t ? t.name : slug}</span><span style="margin-left:auto;font-weight:600">${views}</span></div>`; }).join('')
    : '<p style="color:#666;font-size:13px">No tool views today. Visit some tool pages to see data here.</p>';
}

// --- AI Usage ---
async function loadAiUsage() {
  try {
    const res = await fetch('/api/admin/ai-usage', {
      headers: { 'Authorization': `Bearer ${adminKey}` }
    });
    if (!res.ok) return;
    const usage = await res.json();
    renderAiUsage(usage);
  } catch (e) {
    document.getElementById('ai-usage-stats').innerHTML = '<p style="color:var(--text-muted)">Failed to load usage data.</p>';
  }
}

function renderAiUsage(usage) {
  const today = new Date().toISOString().split('T')[0];
  const todayData = usage.daily[today] || { requests: 0, totalTokens: 0, promptTokens: 0, completionTokens: 0 };

  // Stats
  document.getElementById('ai-usage-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${todayData.requests}</div><div class="stat-label">Today's Requests</div></div>
    <div class="stat-card"><div class="stat-value">${formatNum(todayData.totalTokens)}</div><div class="stat-label">Today's Tokens</div></div>
    <div class="stat-card"><div class="stat-value">${formatNum(usage.total.totalTokens)}</div><div class="stat-label">All-Time Tokens</div></div>
    <div class="stat-card"><div class="stat-value">${usage.total.requests}</div><div class="stat-label">All-Time Requests</div></div>
  `;

  // Budget bars — gpt-4.1-nano is a mini model
  const miniUsed = todayData.totalTokens;
  const miniPct = Math.min((miniUsed / AI_BUDGETS.mini.limit) * 100, 100);
  document.getElementById('usage-budgets').innerHTML = `
    <div class="usage-budget-card">
      <div class="usage-budget-header">
        <strong>${AI_BUDGETS.mini.label}</strong>
        <span>${formatNum(miniUsed)} / ${formatNum(AI_BUDGETS.mini.limit)} tokens</span>
      </div>
      <div class="usage-budget-bar"><div class="usage-budget-fill ${miniPct > 80 ? 'warn' : ''}" style="width:${miniPct}%"></div></div>
      <div class="usage-budget-models">${AI_BUDGETS.mini.models}</div>
    </div>
    <div class="usage-budget-card">
      <div class="usage-budget-header">
        <strong>${AI_BUDGETS.premium.label}</strong>
        <span>0 / ${formatNum(AI_BUDGETS.premium.limit)} tokens</span>
      </div>
      <div class="usage-budget-bar"><div class="usage-budget-fill" style="width:0%"></div></div>
      <div class="usage-budget-models">${AI_BUDGETS.premium.models}</div>
    </div>
  `;

  // Daily table
  const days = Object.entries(usage.daily).sort((a, b) => b[0].localeCompare(a[0]));
  document.getElementById('ai-usage-table').innerHTML = days.map(([date, d]) => `
    <tr>
      <td>${date}</td>
      <td>${d.requests}</td>
      <td>${formatNum(d.promptTokens)}</td>
      <td>${formatNum(d.completionTokens)}</td>
      <td>${formatNum(d.totalTokens)}</td>
    </tr>
  `).join('') || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No usage data yet</td></tr>';

  // Recent queries
  const todayQueries = (usage.daily[today]?.queries || []).slice().reverse();
  document.getElementById('ai-usage-queries').innerHTML = todayQueries.length > 0
    ? todayQueries.map(q => `
      <div class="usage-query">
        <span class="usage-query-text">"${q.q}"</span>
        <span class="usage-query-meta">${q.model} &middot; ${q.tokens} tokens &middot; ${new Date(q.time).toLocaleTimeString()}</span>
      </div>`).join('')
    : '<p style="color:var(--text-muted)">No queries today</p>';
}

// --- Analytics ---
function renderAnalytics() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const trackBg = isDark ? '#252525' : '#e5e7eb';
  const rankBg = isDark ? '#252525' : '#f3f4f6';
  const totalClicks = tools.reduce((sum, t) => sum + t.clicks, 0);
  const avgRating = (tools.reduce((sum, t) => sum + t.rating, 0) / tools.length).toFixed(2);
  const withFreeTrial = tools.filter(t => t.freeTrial).length;
  const withIntegrations = tools.filter(t => t.integrations && t.integrations.length > 0).length;

  document.getElementById('analytics-stats').innerHTML = `
    <div class="stat-card"><div class="stat-value">${totalClicks}</div><div class="stat-label">Total Clicks</div></div>
    <div class="stat-card"><div class="stat-value">${avgRating}</div><div class="stat-label">Avg Rating</div></div>
    <div class="stat-card"><div class="stat-value">${withFreeTrial}</div><div class="stat-label">Have Free Trial</div></div>
    <div class="stat-card"><div class="stat-value">${withIntegrations}</div><div class="stat-label">Have Integrations</div></div>
  `;

  // Category breakdown
  const catCounts = {};
  tools.forEach(t => { catCounts[t.category] = (catCounts[t.category] || 0) + 1; });
  const catEntries = Object.entries(catCounts).sort((a, b) => b[1] - a[1]);
  const catMax = catEntries[0] ? catEntries[0][1] : 1;
  document.getElementById('analytics-categories').innerHTML = catEntries.map(([cat, count]) => {
    const c = categories.find(x => x.id === cat);
    const pct = Math.max((count / catMax * 100), 2);
    const label = c ? c.icon + ' ' + c.name : cat;
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;color:${isDark ? '#ccc' : '#333'}">
        <span>${label}</span><span style="font-weight:700">${count}</span>
      </div>
      <div style="height:28px;background:${trackBg};border-radius:6px;overflow:hidden;position:relative">
        <div style="height:100%;width:${pct}%;border-radius:6px;background:linear-gradient(90deg,#2563eb,#7c3aed);display:flex;align-items:center;justify-content:flex-end;padding-right:8px;transition:width 500ms ease">
          <span style="font-size:11px;font-weight:700;color:#fff">${pct >= 15 ? count : ''}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Pricing breakdown
  const priceCounts = {};
  tools.forEach(t => { priceCounts[t.pricing] = (priceCounts[t.pricing] || 0) + 1; });
  const priceEntries = Object.entries(priceCounts).sort((a, b) => b[1] - a[1]);
  const priceMax = priceEntries[0] ? priceEntries[0][1] : 1;
  const priceColors = { free: '#16a34a', freemium: '#2563eb', paid: '#ea580c', 'open-source': '#7c3aed' };
  const priceLabels = { free: 'Free', freemium: 'Freemium', paid: 'Paid', 'open-source': 'Open Source' };
  document.getElementById('analytics-pricing').innerHTML = priceEntries.map(([p, count]) => {
    const pct = Math.max((count / priceMax * 100), 2);
    const pctTotal = (count / tools.length * 100).toFixed(0);
    const color = priceColors[p] || '#2563eb';
    return `<div style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;font-size:12px;margin-bottom:5px;color:${isDark ? '#ccc' : '#333'}">
        <span style="font-weight:600">${priceLabels[p] || p}</span><span style="font-weight:700">${count} <span style="color:${isDark ? '#888' : '#999'}">(${pctTotal}%)</span></span>
      </div>
      <div style="height:28px;background:${trackBg};border-radius:6px;overflow:hidden">
        <div style="height:100%;width:${pct}%;border-radius:6px;background:${color};display:flex;align-items:center;justify-content:flex-end;padding-right:8px;transition:width 500ms ease">
          <span style="font-size:11px;font-weight:700;color:#fff">${pct >= 15 ? count : ''}</span>
        </div>
      </div>
    </div>`;
  }).join('');

  // Top clicks — ALL tools
  renderClicksList('');

  // Top rated — ALL tools
  renderRatedList('');
}

// Sortable lists with search
let allByClicks = [];
let allByRating = [];

function renderClicksList(query) {
  if (allByClicks.length === 0) allByClicks = [...tools].sort((a, b) => b.clicks - a.clicks);
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const q = query.toLowerCase();
  const filtered = q ? allByClicks.filter(t => t.name.toLowerCase().includes(q)) : allByClicks;
  const maxClicks = allByClicks[0] ? allByClicks[0].clicks : 1;

  document.getElementById('clicks-count').textContent = q ? `${filtered.length} of ${allByClicks.length}` : `${allByClicks.length} tools`;
  document.getElementById('analytics-top-clicks').innerHTML = filtered.map((t, i) => {
    const rank = allByClicks.indexOf(t) + 1;
    const barW = maxClicks > 0 ? Math.max((t.clicks / maxClicks * 100), 2) : 2;
    const isTop3 = rank <= 3;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #252525;font-size:12px" data-name="${t.name.toLowerCase()}">
      <span style="width:28px;height:28px;border-radius:999px;background:${isTop3 ? 'linear-gradient(135deg,#2563eb,#7c3aed)' : '#252525'};color:${isTop3 ? '#fff' : '#aaa'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${rank}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</span>
      <div style="width:70px;height:16px;background:#252525;border-radius:3px;overflow:hidden;flex-shrink:0">
        <div style="height:100%;width:${barW}%;background:#2563eb;border-radius:3px"></div>
      </div>
      <span style="font-weight:700;min-width:30px;text-align:right;font-variant-numeric:tabular-nums;font-size:11px">${t.clicks}</span>
    </div>`;
  }).join('') || '<p style="color:#666;padding:20px 0;text-align:center">No matches</p>';
}

function renderRatedList(query) {
  if (allByRating.length === 0) allByRating = [...tools].sort((a, b) => b.rating - a.rating);
  const q = query.toLowerCase();
  const filtered = q ? allByRating.filter(t => t.name.toLowerCase().includes(q)) : allByRating;

  document.getElementById('rated-count').textContent = q ? `${filtered.length} of ${allByRating.length}` : `${allByRating.length} tools`;
  document.getElementById('analytics-top-rated').innerHTML = filtered.map((t, i) => {
    const rank = allByRating.indexOf(t) + 1;
    const starPct = (t.rating / 5 * 100).toFixed(0);
    const isTop3 = rank <= 3;
    return `<div style="display:flex;align-items:center;gap:8px;padding:8px 0;border-bottom:1px solid #252525;font-size:12px">
      <span style="width:28px;height:28px;border-radius:999px;background:${isTop3 ? 'linear-gradient(135deg,#f59e0b,#ea580c)' : '#252525'};color:${isTop3 ? '#fff' : '#aaa'};display:flex;align-items:center;justify-content:center;font-size:10px;font-weight:700;flex-shrink:0">${rank}</span>
      <span style="flex:1;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${t.name}</span>
      <div style="width:70px;height:16px;background:#252525;border-radius:3px;overflow:hidden;flex-shrink:0">
        <div style="height:100%;width:${starPct}%;background:#f59e0b;border-radius:3px"></div>
      </div>
      <span style="font-weight:700;min-width:30px;text-align:right;color:#f59e0b;font-size:11px">${t.rating}</span>
    </div>`;
  }).join('') || '<p style="color:#666;padding:20px 0;text-align:center">No matches</p>';
}

function filterClicksList() {
  renderClicksList(document.getElementById('clicks-search').value.trim());
}

function filterRatedList() {
  renderRatedList(document.getElementById('rated-search').value.trim());
}

// --- Helpers ---
function formatNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M';
  if (n >= 1000) return (n / 1000).toFixed(1) + 'K';
  return n.toString();
}

// --- Modal ---
function openModal(title, tool) {
  editingId = tool ? tool.id : null;
  document.getElementById('modal-title').textContent = title;
  document.getElementById('form-submit-btn').textContent = tool ? 'Save Changes' : 'Add Tool';

  const form = document.getElementById('tool-form');
  if (tool) {
    form.name.value = tool.name;
    form.slug.value = tool.slug;
    form.description.value = tool.description;
    form.longDescription.value = tool.longDescription;
    form.url.value = tool.url;
    form.affiliateUrl.value = tool.affiliateUrl;
    form.category.value = tool.category;
    form.pricing.value = tool.pricing;
    form.pricingDetails.value = tool.pricingDetails;
    form.tags.value = tool.tags.join(', ');
    form.rating.value = tool.rating;
    form.logo.value = tool.logo;
    form.featured.checked = tool.featured;
  } else {
    form.reset();
  }

  document.getElementById('modal-overlay').style.display = 'flex';
}

function closeModal() {
  document.getElementById('modal-overlay').style.display = 'none';
  editingId = null;
}

// --- CRUD ---
async function saveTool(formData) {
  const body = {
    name: formData.get('name'),
    slug: formData.get('slug'),
    description: formData.get('description'),
    longDescription: formData.get('longDescription'),
    url: formData.get('url'),
    affiliateUrl: formData.get('affiliateUrl') || formData.get('url'),
    category: formData.get('category'),
    pricing: formData.get('pricing'),
    pricingDetails: formData.get('pricingDetails'),
    tags: formData.get('tags').split(',').map(t => t.trim()).filter(Boolean),
    rating: parseFloat(formData.get('rating')) || 0,
    logo: formData.get('logo'),
    featured: formData.get('featured') === 'on'
  };

  const url = editingId ? `/api/admin/tools/${editingId}` : '/api/admin/tools';
  const method = editingId ? 'PUT' : 'POST';

  const res = await fetch(url, {
    method,
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${adminKey}` },
    body: JSON.stringify(body)
  });

  if (!res.ok) {
    const err = await res.json();
    alert(err.error || 'Failed to save tool');
    return;
  }

  const toolsRes = await fetch('/api/tools');
  tools = await toolsRes.json();
  renderStats();
  renderTable();
  closeModal();
}

function editTool(id) {
  const tool = tools.find(t => t.id === id);
  if (tool) openModal('Edit Tool', tool);
}

async function deleteTool(id) {
  if (!confirm('Delete this tool?')) return;

  const res = await fetch(`/api/admin/tools/${id}`, {
    method: 'DELETE',
    headers: { 'Authorization': `Bearer ${adminKey}` }
  });

  if (res.ok) {
    tools = tools.filter(t => t.id !== id);
    renderStats();
    renderTable();
  } else {
    alert('Failed to delete tool');
  }
}

// --- Events ---
function bindEvents() {
  // Login
  document.getElementById('admin-login-btn').addEventListener('click', () => {
    adminKey = document.getElementById('admin-key-input').value;
    localStorage.setItem('adminKey', adminKey);
    tryAuth();
  });
  document.getElementById('admin-key-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') document.getElementById('admin-login-btn').click();
  });

  // Tabs
  document.querySelectorAll('.admin-tab').forEach(tab => {
    tab.addEventListener('click', () => switchTab(tab.dataset.tab));
  });

  // Add tool
  document.getElementById('add-tool-btn').addEventListener('click', () => openModal('Add Tool', null));

  // Modal
  document.getElementById('modal-close').addEventListener('click', closeModal);
  document.getElementById('modal-cancel').addEventListener('click', closeModal);
  document.getElementById('modal-overlay').addEventListener('click', e => {
    if (e.target === e.currentTarget) closeModal();
  });

  // Form submit
  document.getElementById('tool-form').addEventListener('submit', e => {
    e.preventDefault();
    saveTool(new FormData(e.target));
  });

  // Table search
  let debounce;
  document.getElementById('admin-search').addEventListener('input', e => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      tableSearch = e.target.value.trim();
      tablePage = 1;
      renderTable();
    }, 200);
  });

  // Category filter
  document.getElementById('admin-cat-filter').addEventListener('change', e => {
    tableCatFilter = e.target.value;
    tablePage = 1;
    renderTable();
  });

  // Pricing filter
  document.getElementById('admin-pricing-filter').addEventListener('change', e => {
    tablePricingFilter = e.target.value;
    tablePage = 1;
    renderTable();
  });

  // Sortable columns
  document.querySelectorAll('.sortable').forEach(th => {
    th.addEventListener('click', () => {
      const key = th.dataset.sort;
      if (tableSort.key === key) {
        tableSort.dir = tableSort.dir === 'asc' ? 'desc' : 'asc';
      } else {
        tableSort = { key, dir: 'asc' };
      }
      renderTable();
    });
  });
}

init();
