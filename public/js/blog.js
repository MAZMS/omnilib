// --- Blog listing page ---
let currentPage = 1;
let activeCategory = '';
let searchQuery = '';
let searchTimer = null;
let aiSearchTimer = null;
const categoryLabels = {
  'ai-news': 'AI News',
  'tool-launches': 'Tool Launches',
  'tutorials': 'Tutorials',
  'industry': 'Industry',
  'research': 'Research'
};

async function loadPosts() {
  const params = new URLSearchParams({ page: currentPage, limit: 12 });
  if (activeCategory) params.set('category', activeCategory);
  if (searchQuery) params.set('q', searchQuery);

  try {
    const res = await fetch('/api/blog?' + params);
    const data = await res.json();
    renderPosts(data.posts);
    renderPagination(data);
  } catch {
    document.getElementById('blog-empty').style.display = '';
  }
}

// AI-powered smart search
async function triggerAiSearch(query) {
  var status = document.getElementById('blog-ai-status');
  if (status) status.style.display = 'block';

  try {
    var res = await fetch('/api/blog/ai-search?q=' + encodeURIComponent(query));
    var posts = await res.json();
    if (posts.length > 0) {
      renderPosts(posts);
      // Hide pagination for AI results
      document.getElementById('blog-pagination').innerHTML =
        '<span class="blog-page-info" style="color:var(--accent)">&#x2728; AI found ' + posts.length + ' relevant articles</span>';
    }
  } catch {}

  if (status) status.style.display = 'none';
}

function renderPosts(posts) {
  var grid = document.getElementById('blog-grid');
  var empty = document.getElementById('blog-empty');

  if (!posts || posts.length === 0) {
    grid.innerHTML = '';
    empty.style.display = '';
    return;
  }

  empty.style.display = 'none';
  grid.innerHTML = posts.map(function(p, i) {
    var date = new Date(p.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
    var catLabel = categoryLabels[p.category] || p.category;
    var tags = (p.tags || []).slice(0, 3).map(function(t) {
      return '<span class="blog-card-tag">' + t + '</span>';
    }).join('');
    return '<a href="/blog/' + p.slug + '" class="blog-card" style="animation-delay:' + (i * 60) + 'ms">' +
      (p.featured_image ? '<div class="blog-card-image"><img src="' + p.featured_image + '" alt="' + p.title + '" loading="lazy"></div>' : '') +
      '<div class="blog-card-body">' +
        '<div class="blog-card-meta"><span class="blog-card-category">' + catLabel + '</span><time>' + date + '</time></div>' +
        '<h2 class="blog-card-title">' + p.title + '</h2>' +
        '<p class="blog-card-excerpt">' + p.excerpt + '</p>' +
        (tags ? '<div class="blog-card-tags">' + tags + '</div>' : '') +
      '</div></a>';
  }).join('');
}

function renderPagination(data) {
  var el = document.getElementById('blog-pagination');
  if (!data || !data.totalPages || data.totalPages <= 1) { el.innerHTML = ''; return; }

  var html = '';
  if (data.page > 1) {
    html += '<button class="blog-page-btn" data-page="' + (data.page - 1) + '">&larr; Prev</button>';
  }
  html += '<span class="blog-page-info">Page ' + data.page + ' of ' + data.totalPages + '</span>';
  if (data.page < data.totalPages) {
    html += '<button class="blog-page-btn" data-page="' + (data.page + 1) + '">Next &rarr;</button>';
  }
  el.innerHTML = html;

  el.querySelectorAll('.blog-page-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      currentPage = parseInt(this.dataset.page);
      loadPosts();
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

// Category filters
document.getElementById('blog-category-filters').addEventListener('click', function(e) {
  var btn = e.target.closest('.pill');
  if (!btn) return;
  this.querySelectorAll('.pill').forEach(function(p) { p.classList.remove('active'); });
  btn.classList.add('active');
  activeCategory = btn.dataset.category || '';
  searchQuery = '';
  document.getElementById('blog-search').value = '';
  currentPage = 1;
  loadPosts();
});

// Theme toggle
(function(){
  var btn=document.getElementById('theme-toggle');
  var icon=document.getElementById('theme-icon');
  function updateIcon(){icon.textContent=document.documentElement.getAttribute('data-theme')==='dark'?'☀️':'🌙';}
  updateIcon();
  btn.addEventListener('click',function(){
    var d=document.documentElement;
    var next=d.getAttribute('data-theme')==='dark'?'light':'dark';
    d.setAttribute('data-theme',next);
    localStorage.setItem('theme',next);
    updateIcon();
  });
})();

// Smart search: instant text filter + delayed AI search
document.getElementById('blog-search').addEventListener('input', function() {
  clearTimeout(searchTimer);
  clearTimeout(aiSearchTimer);
  var val = this.value.trim();

  if (!val) {
    searchQuery = '';
    currentPage = 1;
    document.getElementById('blog-ai-status').style.display = 'none';
    loadPosts();
    return;
  }

  // Instant text search (300ms debounce)
  searchTimer = setTimeout(function() {
    searchQuery = val;
    currentPage = 1;
    loadPosts();
  }, 300);

  // AI search kicks in after 800ms for smart results
  if (val.length >= 3) {
    aiSearchTimer = setTimeout(function() {
      triggerAiSearch(val);
    }, 800);
  }
});

// Init
loadPosts();
