// --- State ---
let allTools = [];
let categories = [];
let selectedSlugs = [];

// --- Init ---
async function init() {
  initTheme();

  const [toolsRes, catsRes] = await Promise.all([
    fetch('/api/tools'),
    fetch('/api/categories')
  ]);
  allTools = await toolsRes.json();
  categories = await catsRes.json();

  // Parse tools from URL
  const params = new URLSearchParams(window.location.search);
  const toolsParam = params.get('tools');
  if (toolsParam) {
    selectedSlugs = toolsParam.split(',').filter(Boolean).slice(0, 3);
  }

  renderSelectedPills();
  initSearch();
  renderComparison();
}

// --- Theme ---
function initTheme() {
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
}

// --- Search dropdown ---
function initSearch() {
  const input = document.getElementById('compare-search');
  const dropdown = document.getElementById('compare-dropdown');

  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    if (!q) { dropdown.style.display = 'none'; return; }

    const results = allTools
      .filter(t => !selectedSlugs.includes(t.slug))
      .filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q)))
      )
      .slice(0, 8);

    if (results.length === 0) {
      dropdown.style.display = 'none';
      return;
    }

    dropdown.style.display = 'block';
    dropdown.innerHTML = results.map(t => `
      <div class="compare-dropdown-item" onclick="addTool('${t.slug}')">
        ${t.logo ? `<img src="${t.logo}" alt="">` : getCategoryIcon(t.category)}
        <span>${t.name}</span>
        <span class="pricing-badge ${t.pricing}" style="margin-left:auto;font-size:10px">${formatPricing(t.pricing)}</span>
      </div>
    `).join('');
  });

  input.addEventListener('keydown', e => {
    if (e.key === 'Escape') { dropdown.style.display = 'none'; input.blur(); }
  });

  document.addEventListener('click', e => {
    if (!e.target.closest('.compare-search-wrap')) dropdown.style.display = 'none';
  });
}

function addTool(slug) {
  if (selectedSlugs.length >= 3 || selectedSlugs.includes(slug)) return;
  selectedSlugs.push(slug);
  updateURL();
  renderSelectedPills();
  renderComparison();
  document.getElementById('compare-search').value = '';
  document.getElementById('compare-dropdown').style.display = 'none';
}

function removeTool(slug) {
  selectedSlugs = selectedSlugs.filter(s => s !== slug);
  updateURL();
  renderSelectedPills();
  renderComparison();
}

function updateURL() {
  const url = selectedSlugs.length > 0
    ? `/compare?tools=${selectedSlugs.join(',')}`
    : '/compare';
  history.replaceState(null, '', url);
}

function renderSelectedPills() {
  const container = document.getElementById('compare-selected');
  const searchWrap = document.querySelector('.compare-search-wrap');
  container.innerHTML = selectedSlugs.map(slug => {
    const tool = allTools.find(t => t.slug === slug);
    if (!tool) return '';
    return `<div class="compare-selected-pill">
      ${tool.logo ? `<img src="${tool.logo}" alt="">` : ''}
      <span>${tool.name}</span>
      <button class="compare-selected-remove" onclick="removeTool('${slug}')">&times;</button>
    </div>`;
  }).join('');
  searchWrap.style.display = selectedSlugs.length >= 3 ? 'none' : '';
}

// --- Comparison Table ---
function renderComparison() {
  const content = document.getElementById('compare-content');
  const tools = selectedSlugs.map(s => allTools.find(t => t.slug === s)).filter(Boolean);

  if (tools.length < 2) {
    content.innerHTML = `<div class="compare-empty">
      <p class="compare-empty-title">${tools.length === 0 ? 'Select tools to compare' : 'Add one more tool'}</p>
      <p>${tools.length === 0 ? 'Use the search above to add 2-3 AI tools for side-by-side comparison.' : 'Add at least one more tool to see the comparison.'}</p>
    </div>`;
    return;
  }

  const cols = tools.length;

  const rows = [
    { label: 'Rating', render: t => `<div class="stars">${renderStars(t.rating)}</div> <strong>${t.rating}</strong>/5` },
    { label: 'Pricing', render: t => `<span class="pricing-badge ${t.pricing}">${formatPricing(t.pricing)}</span>${t.pricingDetails ? `<div style="margin-top:6px;font-size:12px;color:var(--text-secondary)">${t.pricingDetails}</div>` : ''}` },
    { label: 'Free Trial', render: t => t.freeTrial || '<span style="color:var(--text-muted)">No</span>' },
    { label: 'Platforms', render: t => (t.platforms || []).map(p => `<span class="card-platform">${p}</span>`).join(' ') || '<span style="color:var(--text-muted)">\u2014</span>' },
    { label: 'Best For', render: t => (t.bestFor || []).map(b => `<span class="featured-bestfor">${b}</span>`).join(' ') || '\u2014' },
    { label: 'Pros', render: t => (t.pros && t.pros.length > 0) ? `<ul class="compare-list compare-pros">${t.pros.map(p => `<li>\u2713 ${p}</li>`).join('')}</ul>` : '\u2014' },
    { label: 'Cons', render: t => (t.cons && t.cons.length > 0) ? `<ul class="compare-list compare-cons">${t.cons.map(c => `<li>\u2717 ${c}</li>`).join('')}</ul>` : '\u2014' },
    { label: 'Trending', render: t => `<div class="trending-score-row"><div class="trending-bar"><div class="trending-bar-fill" style="width:${t.trendingScore || 0}%"></div></div><span class="trending-score-num">${t.trendingScore || 0}</span></div>` },
    { label: 'Integrations', render: t => (t.integrations && t.integrations.length > 0) ? t.integrations.slice(0, 6).map(i => `<span class="integration-pill">${i}</span>`).join(' ') + (t.integrations.length > 6 ? ` <span style="color:var(--text-muted)">+${t.integrations.length - 6} more</span>` : '') : '\u2014' },
    { label: 'Category', render: t => `${getCategoryIcon(t.category)} ${getCategoryName(t.category)}` },
  ];

  let html = '<table class="compare-table"><thead><tr><th></th>';
  tools.forEach(t => {
    html += `<td class="compare-tool-header">
      <div class="compare-tool-logo">${t.logo ? `<img src="${t.logo}" alt="">` : getCategoryIcon(t.category)}</div>
      <div class="compare-tool-name">${t.name}</div>
      <a href="/go/${t.slug}" class="compare-tool-visit" target="_blank" rel="noopener">Visit &rarr;</a>
    </td>`;
  });
  html += '</tr></thead><tbody>';

  rows.forEach(row => {
    html += `<tr><th>${row.label}</th>`;
    tools.forEach(t => { html += `<td>${row.render(t)}</td>`; });
    html += '</tr>';
  });

  html += '</tbody></table>';
  content.innerHTML = html;
}

// --- Helpers ---
function getCategoryIcon(catId) {
  const cat = categories.find(c => c.id === catId);
  return cat ? cat.icon : '\uD83E\uDD16';
}

function getCategoryName(catId) {
  const cat = categories.find(c => c.id === catId);
  return cat ? cat.name : catId;
}

function formatPricing(p) {
  const map = { free: 'Free', freemium: 'Freemium', paid: 'Paid', 'open-source': 'Open Source' };
  return map[p] || p;
}

function renderStars(rating) {
  const full = Math.round(rating);
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += i <= full ? '\u2605' : '<span class="empty">\u2605</span>';
  }
  return html;
}

// --- Start ---
init();
