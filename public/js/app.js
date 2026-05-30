// --- State ---
let allTools = [];
let categories = [];
let activeCategory = '';
let activePricing = '';
let activeSort = 'trending';
let searchQuery = '';
let compareTools = JSON.parse(sessionStorage.getItem('compareTools') || '[]');
let showAllTools = false;
const INITIAL_TOOL_COUNT = 48;

// --- Init ---
async function init() {
  initTheme();

  const [toolsRes, catsRes] = await Promise.all([
    fetch('/api/tools'),
    fetch('/api/categories')
  ]);
  allTools = await toolsRes.json();
  categories = await catsRes.json();

  renderHeroStats();
  renderCategoryFilters();
  bindEvents();
  initCommandK();
  initHomepageSections();
  renderCompareBar();

  // Check for ?q= param from tag links
  const params = new URLSearchParams(window.location.search);
  const qParam = params.get('q');
  if (qParam) {
    searchQuery = qParam;
    document.getElementById('search').value = qParam;
    applyFilters();
    // Scroll to results
    setTimeout(() => {
      document.getElementById('filters-section').scrollIntoView({ behavior: 'smooth' });
    }, 100);
  } else {
    applyFilters();
  }
}

// --- Theme ---
function initTheme() {
  const saved = localStorage.getItem('theme');
  if (saved === 'dark' || (!saved && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('theme-icon').textContent = '☀️';
  }
}

function toggleTheme() {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  if (isDark) {
    document.documentElement.removeAttribute('data-theme');
    document.getElementById('theme-icon').textContent = '🌙';
    localStorage.setItem('theme', 'light');
  } else {
    document.documentElement.setAttribute('data-theme', 'dark');
    document.getElementById('theme-icon').textContent = '☀️';
    localStorage.setItem('theme', 'dark');
  }
}

// --- Hero stats ---
function renderHeroStats() {
  const cats = new Set(allTools.map(t => t.category));
  const container = document.getElementById('hero-stats');
  container.innerHTML = `
    <div class="hero-stat">
      <span class="hero-stat-value">${allTools.length >= 1000 ? Math.floor(allTools.length / 1000) * 1000 + '+' : allTools.length}</span>
      <span class="hero-stat-label">AI Tools</span>
    </div>
    <div class="hero-stat">
      <span class="hero-stat-value">${cats.size}</span>
      <span class="hero-stat-label">Categories</span>
    </div>
    <div class="hero-stat">
      <span class="hero-stat-value">100%</span>
      <span class="hero-stat-label">Free to Browse</span>
    </div>
  `;
}

// --- Render category filter pills ---
function renderCategoryFilters() {
  const container = document.getElementById('category-filters');
  const allPill = document.createElement('button');
  allPill.className = 'pill active';
  allPill.dataset.category = '';
  allPill.textContent = 'All';
  container.appendChild(allPill);

  // Only show categories that have tools
  const activeCats = new Set(allTools.map(t => t.category));
  categories.filter(c => activeCats.has(c.id)).forEach(cat => {
    const pill = document.createElement('button');
    pill.className = 'pill';
    pill.dataset.category = cat.id;
    pill.textContent = `${cat.icon} ${cat.name}`;
    container.appendChild(pill);
  });
}

// --- Render tool cards ---
function renderTools(tools) {
  const grid = document.getElementById('tools-grid');
  const empty = document.getElementById('tools-empty');
  const count = document.getElementById('tools-count');

  const toolCountDisplay = tools.length >= 1000 ? Math.floor(tools.length / 1000) * 1000 + '+' : tools.length;
  count.textContent = `${toolCountDisplay} tools`;

  if (tools.length === 0) {
    grid.innerHTML = '';
    empty.style.display = 'block';
    // Remove load-more if present
    const lm = document.getElementById('load-more-wrap');
    if (lm) lm.remove();
    return;
  }

  empty.style.display = 'none';
  const isFiltered = searchQuery || activeCategory || activePricing;
  const displayTools = (!isFiltered && !showAllTools) ? tools.slice(0, INITIAL_TOOL_COUNT) : tools;

  grid.innerHTML = displayTools.map((tool, i) => {
    const isCompared = compareTools.includes(tool.slug);
    const platformHtml = (tool.platforms && tool.platforms.length > 0)
      ? `<div class="card-platforms">${tool.platforms.slice(0, 4).map(p => `<span class="card-platform">${p}</span>`).join('')}</div>`
      : '';
    const freeTrialHtml = tool.freeTrial ? '<span class="card-freetrial">Free Trial</span>' : '';
    const integrationsHtml = (tool.integrations && tool.integrations.length > 0)
      ? `<span class="card-integrations">${tool.integrations.length} integration${tool.integrations.length !== 1 ? 's' : ''}</span>`
      : '';

    return `
    <div class="tool-card" onclick="goToTool('${tool.slug}')" style="position:relative;animation: fadeUp 300ms ${Math.min(i * 40, 400)}ms ease both">
      ${tool.trendingScore >= 80 ? '<span class="card-badge trending">\uD83D\uDD25 Trending</span>' : ''}
      <div class="tool-card-header">
        <div class="tool-logo">
          ${tool.logo ? `<img src="${tool.logo}" alt="${tool.name}" onerror="this.onerror=null;this.style.display='none';this.parentElement.innerHTML='${getCategoryIcon(tool.category)}';">` : getCategoryIcon(tool.category)}
        </div>
        <div>
          <div class="tool-card-title">${tool.name}</div>
        </div>
      </div>
      <div class="tool-card-desc">${tool.description}</div>
      ${tool.bestFor && tool.bestFor.length > 0 ? `<span class="card-bestfor">Best for ${tool.bestFor[0].toLowerCase().replace(/-/g, ' ')}</span>` : ''}
      <div class="card-extras">${platformHtml}${freeTrialHtml}${integrationsHtml}</div>
      <div class="tool-card-meta">
        <span class="pricing-badge ${tool.pricing}">${formatPricing(tool.pricing)}</span>
        ${tool.tags.slice(0, 3).map(t => `<span class="tag">${t}</span>`).join('')}
      </div>
      <div class="tool-card-footer">
        <div class="stars">${renderStars(tool.rating)}</div>
        <button class="card-compare-btn ${isCompared ? 'active' : ''}" onclick="event.stopPropagation();toggleCompare('${tool.slug}')">${isCompared ? 'Added' : 'Compare'}</button>
        <a href="/go/${tool.slug}" class="visit-btn" onclick="event.stopPropagation()" target="_blank" rel="noopener">Visit &rarr;</a>
      </div>
    </div>`;
  }).join('');

  // Load more button
  let lmWrap = document.getElementById('load-more-wrap');
  if (!isFiltered && !showAllTools && tools.length > INITIAL_TOOL_COUNT) {
    if (!lmWrap) {
      lmWrap = document.createElement('div');
      lmWrap.id = 'load-more-wrap';
      lmWrap.className = 'load-more-wrap';
      grid.parentElement.appendChild(lmWrap);
    }
    lmWrap.innerHTML = `<button class="load-more-btn" onclick="showAllTools=true;renderTools(allTools)">Show all ${tools.length >= 1000 ? Math.floor(tools.length / 1000) * 1000 + '+' : tools.length} tools</button>`;
  } else if (lmWrap) {
    lmWrap.remove();
  }
}

// --- Helpers ---
function getCategoryIcon(catId) {
  const cat = categories.find(c => c.id === catId);
  return cat ? cat.icon : '🤖';
}

function formatPricing(p) {
  const map = { free: 'Free', freemium: 'Freemium', paid: 'Paid', 'open-source': 'Open Source' };
  return map[p] || p;
}

function renderStars(rating) {
  const full = Math.round(rating);
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += i <= full ? '★' : '<span class="empty">★</span>';
  }
  return html;
}

function goToTool(slug) {
  window.location.href = `/tool/${slug}`;
}

// --- Filtering ---
let aiSearchTimeout = null;

function applyFilters() {
  let filtered = [...allTools];

  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.longDescription && t.longDescription.toLowerCase().includes(q)) ||
      (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q))) ||
      (t.bestFor && t.bestFor.some(b => b.toLowerCase().includes(q))) ||
      (t.useCases && t.useCases.some(u => u.toLowerCase().includes(q))) ||
      (t.category && t.category.toLowerCase().includes(q))
    );

    // If few results and query is 3+ words, auto-trigger AI search
    const wordCount = searchQuery.trim().split(/\s+/).length;
    if (wordCount >= 3 && filtered.length < 5) {
      clearTimeout(aiSearchTimeout);
      aiSearchTimeout = setTimeout(() => triggerAiSearch(searchQuery), 600);
    }
  }

  if (activeCategory) {
    filtered = filtered.filter(t => t.category === activeCategory);
  }

  if (activePricing) {
    filtered = filtered.filter(t => t.pricing === activePricing);
  }

  // Sort
  if (activeSort === 'trending') {
    filtered.sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0));
  } else if (activeSort === 'rating') {
    filtered.sort((a, b) => b.rating - a.rating);
  } else if (activeSort === 'newest') {
    filtered.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
  } else if (activeSort === 'popular') {
    filtered.sort((a, b) => b.clicks - a.clicks);
  } else if (activeSort === 'name') {
    filtered.sort((a, b) => a.name.localeCompare(b.name));
  }

  renderTools(filtered);
  toggleHomepageSections();
}

function toggleHomepageSections() {
  const isFiltered = searchQuery || activeCategory || activePricing;
  const sections = document.querySelectorAll('.homepage-section');
  sections.forEach(s => s.style.display = isFiltered ? 'none' : '');
}

// --- Events ---
function bindEvents() {
  const searchInput = document.getElementById('search');

  // Search with debounce
  let debounce;
  searchInput.addEventListener('input', () => {
    clearTimeout(debounce);
    debounce = setTimeout(() => {
      searchQuery = searchInput.value.trim();
      applyFilters();
      if (searchQuery) {
        document.getElementById('filters-section').scrollIntoView({ behavior: 'smooth' });
      }
    }, 200);
  });

  // "/" keyboard shortcut to focus search
  document.addEventListener('keydown', e => {
    if (e.key === '/' && document.activeElement !== searchInput) {
      e.preventDefault();
      searchInput.focus();
      searchInput.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
    if (e.key === 'Escape' && document.activeElement === searchInput) {
      searchInput.blur();
    }
  });

  // Category pills
  document.getElementById('category-filters').addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll('#category-filters .pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activeCategory = pill.dataset.category;
    applyFilters();
  });

  // Pricing pills
  document.getElementById('pricing-filters').addEventListener('click', e => {
    const pill = e.target.closest('.pill');
    if (!pill) return;
    document.querySelectorAll('#pricing-filters .pill').forEach(p => p.classList.remove('active'));
    pill.classList.add('active');
    activePricing = pill.dataset.pricing;
    applyFilters();
  });

  // Sort
  document.getElementById('sort-select').addEventListener('change', e => {
    activeSort = e.target.value;
    applyFilters();
  });

  // Theme toggle
  document.getElementById('theme-toggle').addEventListener('click', toggleTheme);

  // Back to top
  const btt = document.getElementById('back-to-top');
  window.addEventListener('scroll', () => {
    btt.classList.toggle('visible', window.scrollY > 400);
  }, { passive: true });
  btt.addEventListener('click', () => {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });
}

// --- AI Search Integration ---
async function triggerAiSearch(query) {
  const status = document.getElementById('search-ai-status');
  if (status) status.style.display = 'block';

  try {
    const res = await fetch('/api/ai-search?q=' + encodeURIComponent(query));
    const tools = await res.json();
    if (tools.length > 0) {
      renderTools(tools);
      const count = document.getElementById('tools-count');
      if (count) count.innerHTML = `✨ AI found ${tools.length} tool${tools.length !== 1 ? 's' : ''} for "<em>${query}</em>"`;
    }
  } catch(e) {
    // Silently fail — regular results are already shown
  } finally {
    if (status) status.style.display = 'none';
  }
}

// --- Command-K Search ---
function initCommandK() {
  const overlay = document.getElementById('cmdk-overlay');
  const input = document.getElementById('cmdk-input');
  const results = document.getElementById('cmdk-results');
  let selectedIndex = -1;
  let currentResults = [];

  // Open with Cmd+K or Ctrl+K
  document.addEventListener('keydown', e => {
    if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
      e.preventDefault();
      overlay.style.display = 'flex';
      input.value = '';
      input.focus();
      renderCmdKResults('');
      selectedIndex = -1;
    }
    if (e.key === 'Escape' && overlay.style.display === 'flex') {
      overlay.style.display = 'none';
    }
  });

  // Close on overlay click
  overlay.addEventListener('click', e => {
    if (e.target === overlay) overlay.style.display = 'none';
  });

  // Search as you type
  input.addEventListener('input', () => {
    selectedIndex = -1;
    renderCmdKResults(input.value.trim());
  });

  // Keyboard navigation
  input.addEventListener('keydown', e => {
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      selectedIndex = Math.min(selectedIndex + 1, currentResults.length - 1);
      updateSelection();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      selectedIndex = Math.max(selectedIndex - 1, 0);
      updateSelection();
    } else if (e.key === 'Enter' && selectedIndex >= 0 && currentResults[selectedIndex]) {
      window.location.href = '/tool/' + currentResults[selectedIndex].slug;
    }
  });

  function renderCmdKResults(query) {
    if (!query) {
      // Show trending/popular tools when empty
      currentResults = allTools
        .filter(t => t.trendingScore >= 80)
        .sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0))
        .slice(0, 8);

      results.innerHTML = '<div class="cmdk-section-label">\uD83D\uDD25 Trending</div>' +
        currentResults.map((t, i) => renderCmdKItem(t, i)).join('');
      return;
    }

    const q = query.toLowerCase();

    // Score-based search for relevance
    const scored = allTools.map(t => {
      let score = 0;
      const name = t.name.toLowerCase();
      const desc = t.description.toLowerCase();

      // Exact name match
      if (name === q) score += 100;
      // Name starts with query
      else if (name.startsWith(q)) score += 80;
      // Name contains query
      else if (name.includes(q)) score += 60;
      // Description contains query
      if (desc.includes(q)) score += 30;
      // Tag match
      if (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q))) score += 40;
      // Category match
      if (t.category && t.category.toLowerCase().includes(q)) score += 35;
      // Boost by rating and trending
      score += (t.rating || 0) * 2;
      score += (t.trendingScore || 0) * 0.05;

      return { tool: t, score };
    }).filter(s => s.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 8);

    currentResults = scored.map(s => s.tool);

    if (currentResults.length === 0) {
      results.innerHTML = '<div class="cmdk-empty">No tools found for "' + query + '"</div>';
      return;
    }

    let html = '<div class="cmdk-section-label">Results</div>' +
      currentResults.map((t, i) => renderCmdKItem(t, i)).join('');

    if (query.split(' ').length >= 3) {
      html += '<div class="cmdk-ai-divider"><button class="cmdk-ai-btn" onclick="cmdkAiSearch(\'' + query.replace(/'/g, "\\'") + '\')">\u2728 Ask AI to find the best tool</button></div>';
    }

    results.innerHTML = html;
  }

  function renderCmdKItem(t, index) {
    const catObj = categories.find(c => c.id === t.category);
    const catIcon = catObj ? catObj.icon : '\uD83E\uDD16';
    return `<a href="/tool/${t.slug}" class="cmdk-item" data-index="${index}">
      <div class="cmdk-item-logo">${t.logo ? '<img src="' + t.logo + '" alt="' + t.name + '">' : catIcon}</div>
      <div class="cmdk-item-info">
        <span class="cmdk-item-name">${t.name}</span>
        <span class="cmdk-item-desc">${t.description}</span>
      </div>
      <div class="cmdk-item-meta">
        <span class="pricing-badge ${t.pricing}">${formatPricing(t.pricing)}</span>
      </div>
    </a>`;
  }

  function updateSelection() {
    document.querySelectorAll('.cmdk-item').forEach((el, i) => {
      el.classList.toggle('cmdk-selected', i === selectedIndex);
      if (i === selectedIndex) el.scrollIntoView({ block: 'nearest' });
    });
  }
}

// AI-powered search via Command-K
async function cmdkAiSearch(query) {
  const results = document.getElementById('cmdk-results');
  results.innerHTML = '<div class="cmdk-loading">\u2728 AI is thinking...</div>';
  try {
    const res = await fetch('/api/ai-search?q=' + encodeURIComponent(query));
    const tools = await res.json();
    if (tools.length === 0) {
      results.innerHTML = '<div class="cmdk-empty">AI couldn\'t find a match. Try different words.</div>';
      return;
    }
    const catMap = {};
    categories.forEach(c => { catMap[c.id] = c.icon; });
    results.innerHTML = '<div class="cmdk-section-label">\u2728 AI Recommendations</div>' +
      tools.map((t, i) => {
        const icon = catMap[t.category] || '\uD83E\uDD16';
        return `<a href="/tool/${t.slug}" class="cmdk-item">
          <div class="cmdk-item-logo">${t.logo ? '<img src="' + t.logo + '" alt="' + t.name + '">' : icon}</div>
          <div class="cmdk-item-info">
            <span class="cmdk-item-name">${t.name}</span>
            <span class="cmdk-item-desc">${t.description}</span>
          </div>
          <div class="cmdk-item-meta"><span class="pricing-badge ${t.pricing}">${formatPricing(t.pricing)}</span></div>
        </a>`;
      }).join('');
  } catch(e) {
    results.innerHTML = '<div class="cmdk-empty">AI search unavailable. Try regular search.</div>';
  }
}

// --- Newsletter ---
function subscribeNewsletter(e) {
  e.preventDefault();
  const email = document.getElementById('nl-email').value.trim();
  const btn = document.getElementById('nl-btn');
  const msg = document.getElementById('nl-msg');
  if (!email) return false;

  btn.textContent = 'Subscribing...';
  btn.disabled = true;

  fetch('/api/newsletter', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email })
  }).then(r => r.json()).then(data => {
    if (data.ok) {
      msg.style.display = 'block';
      msg.style.color = '#16a34a';
      msg.textContent = data.already ? 'You\'re already subscribed!' : 'You\'re in! Check your email to confirm.';
      document.getElementById('nl-email').value = '';
    } else {
      msg.style.display = 'block';
      msg.style.color = '#ea580c';
      msg.textContent = data.error || 'Something went wrong.';
    }
    btn.textContent = 'Subscribe';
    btn.disabled = false;
  }).catch(() => {
    msg.style.display = 'block';
    msg.style.color = '#ea580c';
    msg.textContent = 'Failed to connect. Try again.';
    btn.textContent = 'Subscribe';
    btn.disabled = false;
  });
  return false;
}

// --- Submit Tool ---
function submitTool(e) {
  e.preventDefault();
  const form = document.getElementById('submit-form');
  const btn = document.getElementById('st-submit');
  const body = {
    toolName: form.querySelector('[name="st-name"]').value.trim(),
    url: form.querySelector('[name="st-url"]').value.trim(),
    category: form.querySelector('[name="st-category"]').value,
    pricing: form.querySelector('[name="st-pricing"]').value,
    description: form.querySelector('[name="st-desc"]').value.trim(),
    email: form.querySelector('[name="st-email"]').value.trim()
  };
  if (!body.toolName || !body.url || !body.description || !body.email) return false;

  btn.textContent = 'Submitting...';
  btn.disabled = true;

  fetch('/api/submissions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  }).then(r => {
    if (r.ok) {
      form.style.display = 'none';
      document.getElementById('st-success').style.display = 'block';
      setTimeout(() => {
        document.getElementById('submit-modal').style.display = 'none';
        form.style.display = '';
        document.getElementById('st-success').style.display = 'none';
        form.reset();
        btn.textContent = 'Submit Tool';
        btn.disabled = false;
      }, 3000);
    } else {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }).catch(() => { btn.textContent = 'Failed — try again'; btn.disabled = false; });
  return false;
}

// --- Feedback ---
let fbType = 'feedback';

function pickFbType(btn, type) {
  fbType = type;
  document.querySelectorAll('#fb-type-row button').forEach(b => { b.style.background = 'none'; b.style.color = 'var(--text)'; });
  btn.style.background = 'var(--text)';
  btn.style.color = 'var(--bg)';
}

function submitFeedback() {
  const message = document.getElementById('fb-message').value.trim();
  const email = document.getElementById('fb-email').value.trim();
  const btn = document.getElementById('fb-submit');
  if (!message || message.length < 3) { alert('Please enter a message'); return; }

  btn.textContent = 'Sending...';
  btn.disabled = true;

  fetch('/api/feedback', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: fbType, message, email, page: window.location.pathname })
  }).then(r => {
    if (r.ok) {
      document.getElementById('feedback-form').style.display = 'none';
      document.getElementById('fb-success').style.display = 'block';
      setTimeout(() => {
        document.getElementById('feedback-modal').style.display = 'none';
        document.getElementById('feedback-form').style.display = '';
        document.getElementById('fb-success').style.display = 'none';
        document.getElementById('fb-message').value = '';
        document.getElementById('fb-email').value = '';
        btn.textContent = 'Send';
        btn.disabled = false;
        fbType = 'feedback';
        pickFbType(document.querySelector('#fb-type-row button'), 'feedback');
      }, 2000);
    } else {
      btn.textContent = 'Failed — try again';
      btn.disabled = false;
    }
  }).catch(() => { btn.textContent = 'Failed — try again'; btn.disabled = false; });
}

// --- Homepage Sections ---
function initHomepageSections() {
  renderFeaturedSpotlight();
  renderTrendingSection();
  renderUseCasesSection();
  renderPopularComparisons();
  renderRecentlyAdded();
  initScrollArrows();
}

function renderFeaturedSpotlight() {
  const featured = allTools.filter(t => t.featured).sort((a, b) => b.rating - a.rating);
  const grid = document.getElementById('featured-grid');
  if (!grid || featured.length === 0) return;

  grid.innerHTML = featured.map(tool => `
    <div class="featured-card" onclick="goToTool('${tool.slug}')">
      <div class="featured-card-header">
        <div class="featured-logo">
          ${tool.logo ? `<img src="${tool.logo}" alt="${tool.name}" onerror="this.style.display='none';this.parentElement.textContent='${getCategoryIcon(tool.category)}'">` : getCategoryIcon(tool.category)}
        </div>
        <div>
          <div class="featured-name">${tool.name}</div>
          <span class="pricing-badge ${tool.pricing}">${formatPricing(tool.pricing)}</span>
        </div>
      </div>
      <div class="featured-desc">${tool.description}</div>
      <div class="featured-badges">
        ${(tool.bestFor || []).slice(0, 2).map(b => `<span class="featured-bestfor">${b}</span>`).join('')}
      </div>
      <div class="featured-footer">
        <div class="stars">${renderStars(tool.rating)}</div>
        <span style="font-size:12px;color:var(--text-muted)">${tool.rating}/5</span>
      </div>
    </div>
  `).join('');
}

function renderTrendingSection() {
  const trending = allTools
    .filter(t => t.trendingScore >= 80)
    .sort((a, b) => b.trendingScore - a.trendingScore)
    .slice(0, 10);
  const grid = document.getElementById('trending-grid');
  if (!grid || trending.length === 0) return;

  grid.innerHTML = trending.map(tool => `
    <div class="trending-card" onclick="goToTool('${tool.slug}')">
      <div class="trending-card-header">
        <div class="trending-logo">
          ${tool.logo ? `<img src="${tool.logo}" alt="${tool.name}" onerror="this.style.display='none';this.parentElement.textContent='${getCategoryIcon(tool.category)}'">` : getCategoryIcon(tool.category)}
        </div>
        <div>
          <div class="trending-name">${tool.name}</div>
          <div class="trending-cat">${getCategoryIcon(tool.category)} ${getCategoryName(tool.category)}</div>
        </div>
      </div>
      <div class="trending-score-row">
        <div class="trending-bar"><div class="trending-bar-fill" style="width:${tool.trendingScore}%"></div></div>
        <span class="trending-score-num">${tool.trendingScore}</span>
      </div>
      <div class="trending-footer">
        <span class="pricing-badge ${tool.pricing}">${formatPricing(tool.pricing)}</span>
        <div class="stars">${renderStars(tool.rating)}</div>
      </div>
    </div>
  `).join('');
}

function renderUseCasesSection() {
  const grid = document.getElementById('usecases-grid');
  if (!grid) return;

  // Aggregate bestFor values
  const counts = {};
  allTools.forEach(t => {
    (t.bestFor || []).forEach(b => {
      const key = b.toLowerCase().trim();
      if (!counts[key]) counts[key] = { name: b, count: 0 };
      counts[key].count++;
    });
  });

  const useCases = Object.values(counts)
    .sort((a, b) => b.count - a.count)
    .slice(0, 8);

  const emojiMap = {
    'developers': '\uD83D\uDC68\u200D\uD83D\uDCBB', 'designers': '\uD83C\uDFA8', 'writers': '\u270D\uFE0F',
    'marketers': '\uD83D\uDCC8', 'students': '\uD83C\uDF93', 'researchers': '\uD83D\uDD2C',
    'content creators': '\uD83C\uDFA5', 'teams': '\uD83D\uDC65', 'businesses': '\uD83C\uDFE2',
    'entrepreneurs': '\uD83D\uDE80', 'educators': '\uD83D\uDCDA', 'freelancers': '\uD83D\uDCBC',
    'musicians': '\uD83C\uDFB5', 'data analysts': '\uD83D\uDCCA', 'non-technical users': '\uD83D\uDE4B',
    'photographers': '\uD83D\uDCF7', 'video editors': '\uD83C\uDFAC', 'sales teams': '\uD83D\uDCB0',
    'product managers': '\uD83D\uDCCB', 'hr professionals': '\uD83D\uDC64'
  };

  grid.innerHTML = useCases.map(uc => {
    const emoji = emojiMap[uc.name.toLowerCase()] || '\u2728';
    return `
    <div class="usecase-card" onclick="filterByUseCase('${uc.name.replace(/'/g, "\\'")}')">
      <span class="usecase-emoji">${emoji}</span>
      <div class="usecase-info">
        <span class="usecase-name">Best for ${uc.name}</span>
        <span class="usecase-count">${uc.count} tools</span>
      </div>
    </div>`;
  }).join('');
}

function filterByUseCase(useCase) {
  const filtered = allTools.filter(t =>
    (t.bestFor || []).some(b => b.toLowerCase() === useCase.toLowerCase())
  );
  searchQuery = '';
  activeCategory = '';
  activePricing = '';
  document.getElementById('search').value = '';
  document.querySelectorAll('#category-filters .pill').forEach(p => p.classList.toggle('active', !p.dataset.category));
  document.querySelectorAll('#pricing-filters .pill').forEach(p => p.classList.toggle('active', !p.dataset.pricing));
  showAllTools = true;
  renderTools(filtered);
  document.getElementById('tools-count').innerHTML = `${filtered.length} tools best for <em>${useCase}</em>`;
  document.getElementById('filters-section').scrollIntoView({ behavior: 'smooth' });
}

function renderPopularComparisons() {
  const grid = document.getElementById('comparisons-grid');
  if (!grid) return;

  const pairs = [
    ['chatgpt', 'claude'], ['chatgpt', 'gemini'], ['midjourney', 'dall-e'],
    ['cursor', 'github-copilot'], ['claude', 'gemini'], ['notion-ai', 'jasper']
  ];

  grid.innerHTML = pairs.map(([s1, s2]) => {
    const t1 = allTools.find(t => t.slug === s1);
    const t2 = allTools.find(t => t.slug === s2);
    if (!t1 || !t2) return '';
    return `
    <a href="/compare?tools=${s1},${s2}" class="comparison-card">
      <div class="comparison-logos">
        <div class="comparison-logo">${t1.logo ? `<img src="${t1.logo}" alt="${t1.name}">` : getCategoryIcon(t1.category)}</div>
        <span class="comparison-vs">vs</span>
        <div class="comparison-logo">${t2.logo ? `<img src="${t2.logo}" alt="${t2.name}">` : getCategoryIcon(t2.category)}</div>
      </div>
      <span class="comparison-label">${t1.name} vs ${t2.name}</span>
      <span class="comparison-arrow">&rarr;</span>
    </a>`;
  }).filter(Boolean).join('');
}

function renderRecentlyAdded() {
  const recent = [...allTools]
    .sort((a, b) => {
      const d = new Date(b.dateAdded) - new Date(a.dateAdded);
      return d !== 0 ? d : (b.trendingScore || 0) - (a.trendingScore || 0);
    })
    .slice(0, 10);
  const grid = document.getElementById('recent-grid');
  if (!grid || recent.length === 0) return;

  grid.innerHTML = recent.map(tool => `
    <div class="featured-card" onclick="goToTool('${tool.slug}')">
      <div class="featured-card-header">
        <div class="featured-logo">
          ${tool.logo ? `<img src="${tool.logo}" alt="${tool.name}" onerror="this.style.display='none';this.parentElement.textContent='${getCategoryIcon(tool.category)}'">` : getCategoryIcon(tool.category)}
        </div>
        <div>
          <div class="featured-name">${tool.name}</div>
          <span class="pricing-badge ${tool.pricing}">${formatPricing(tool.pricing)}</span>
        </div>
      </div>
      <div class="featured-desc">${tool.description}</div>
      <div class="featured-footer">
        <div class="stars">${renderStars(tool.rating)}</div>
        <span style="font-size:12px;color:var(--text-muted)">${getCategoryIcon(tool.category)} ${getCategoryName(tool.category)}</span>
      </div>
    </div>
  `).join('');
}

// --- Scroll arrows ---
function initScrollArrows() {
  document.querySelectorAll('.scroll-arrow').forEach(btn => {
    btn.addEventListener('click', () => {
      const row = btn.parentElement.querySelector('.scroll-row');
      if (row) row.scrollBy({ left: btn.dataset.dir * 320, behavior: 'smooth' });
    });
  });
}

// --- Compare ---
function toggleCompare(slug) {
  const idx = compareTools.indexOf(slug);
  if (idx >= 0) {
    compareTools.splice(idx, 1);
  } else if (compareTools.length < 3) {
    compareTools.push(slug);
  }
  sessionStorage.setItem('compareTools', JSON.stringify(compareTools));
  renderCompareBar();
  // Update button states
  document.querySelectorAll('.card-compare-btn').forEach(btn => {
    const s = btn.getAttribute('onclick').match(/'([^']+)'/)?.[1];
    if (s) {
      btn.classList.toggle('active', compareTools.includes(s));
      btn.textContent = compareTools.includes(s) ? 'Added' : 'Compare';
    }
  });
}

function renderCompareBar() {
  const bar = document.getElementById('compare-bar');
  const toolsDiv = document.getElementById('compare-bar-tools');
  const btn = document.getElementById('compare-bar-btn');
  if (!bar) return;

  if (compareTools.length === 0) {
    bar.style.display = 'none';
    return;
  }

  bar.style.display = 'flex';
  toolsDiv.innerHTML = compareTools.map(slug => {
    const tool = allTools.find(t => t.slug === slug);
    if (!tool) return '';
    return `<div class="compare-bar-tool">
      ${tool.logo ? `<img src="${tool.logo}" alt="${tool.name}">` : ''}
      <span>${tool.name}</span>
      <button class="compare-bar-tool-remove" onclick="toggleCompare('${slug}')">&times;</button>
    </div>`;
  }).join('');

  btn.href = `/compare?tools=${compareTools.join(',')}`;
  btn.textContent = `Compare ${compareTools.length} tools`;
}

function clearCompare() {
  compareTools = [];
  sessionStorage.setItem('compareTools', JSON.stringify(compareTools));
  renderCompareBar();
  document.querySelectorAll('.card-compare-btn').forEach(btn => {
    btn.classList.remove('active');
    btn.textContent = 'Compare';
  });
}

// --- Helper ---
function getCategoryName(catId) {
  const cat = categories.find(c => c.id === catId);
  return cat ? cat.name : catId;
}

// --- Start ---
init();
