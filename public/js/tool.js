// Get slug from URL path
const slug = window.location.pathname.split('/tool/')[1];

async function loadTool() {
  const loading = document.getElementById('tool-loading');
  const container = document.getElementById('tool-detail');

  if (!slug) {
    loading.textContent = 'Tool not found.';
    return;
  }

  try {
    const [res, catsRes, allToolsRes] = await Promise.all([
      fetch(`/api/tools/${slug}`),
      fetch('/api/categories'),
      fetch('/api/tools')
    ]);
    if (!res.ok) throw new Error('Not found');
    const tool = await res.json();
    const categories = await catsRes.json();
    const allTools = await allToolsRes.json();

    const cat = categories.find(c => c.id === tool.category);
    const catIcon = cat ? cat.icon : '';
    const catName = cat ? cat.name : tool.category;

    loading.style.display = 'none';

    const screenshotsHtml = tool.screenshots && tool.screenshots.length > 0
      ? `<section class="detail-section reveal">
          <h2 class="detail-section-title">Screenshots</h2>
          <div class="detail-screenshots-wrap">
            <div class="detail-screenshots" id="screenshots-gallery">
              ${tool.screenshots.map(s => `<img src="${s}" alt="${tool.name} screenshot" loading="lazy" onclick="openLightbox(this.src)" onerror="this.remove();if(!this.parentElement.querySelector('img'))this.parentElement.closest('section').remove()">`).join('')}
            </div>
          </div>
        </section>`
      : `<section class="detail-section reveal">
          <h2 class="detail-section-title">Preview</h2>
          <div class="detail-preview-card">
            <div class="preview-browser">
              <div class="preview-browser-bar">
                <span class="preview-dot"></span><span class="preview-dot"></span><span class="preview-dot"></span>
                <span class="preview-url">${tool.url.replace('https://', '')}</span>
              </div>
              <div class="preview-body">
                <div class="preview-logo">
                  ${tool.logo ? `<img src="${tool.logo}" alt="${tool.name}">` : (catIcon || 'AI')}
                </div>
                <h3>${tool.name}</h3>
                <p>${tool.description}</p>
                <a href="/go/${tool.slug}" class="detail-cta" target="_blank" rel="noopener noreferrer" onclick="showToast()">Open ${tool.name} &rarr;</a>
              </div>
            </div>
          </div>
        </section>`;

    // Build "What's Good" pills
    var goodPills = buildGoodPills(tool);
    var goodHtml = goodPills.length > 0 ? `
          <section class="detail-section">
            <h2 class="detail-section-title">What's Good</h2>
            <div class="detail-good-pills">
              ${goodPills.map(function(p) { return '<span class="good-pill">&#10003; ' + p + '</span>'; }).join('')}
            </div>
          </section>` : '';

    // "How it compares" — compute category average
    var sameCat = allTools.filter(function(t) { return t.category === tool.category; });
    var catAvg = sameCat.length > 0 ? sameCat.reduce(function(sum, t) { return sum + t.rating; }, 0) / sameCat.length : 0;
    var compareBadge = '';
    if (tool.rating >= catAvg + 0.5) {
      compareBadge = '<span class="compare-badge compare-top">&#9650; Top rated in ' + catName + '</span>';
    } else if (tool.rating >= catAvg) {
      compareBadge = '<span class="compare-badge compare-above">&#9650; Above average in ' + catName + '</span>';
    } else {
      compareBadge = '<span class="compare-badge compare-avg">&#9679; Average in ' + catName + '</span>';
    }

    const html = `
      <div class="detail-hero reveal">
        <div class="detail-logo-large">
          ${tool.logo ? `<img src="${tool.logo}" alt="${tool.name} logo" onerror="this.onerror=null;this.style.display='none';this.parentElement.innerHTML='${catIcon}';">` : (catIcon || '<span class="detail-logo-fallback">AI</span>')}
        </div>
        <div class="detail-hero-info">
          <h1 class="detail-name">${tool.name}</h1>
          <div class="detail-name-accent"></div>
          <div class="detail-meta">
            <span class="pricing-badge ${tool.pricing}">${formatPricing(tool.pricing)}</span>
            ${tool.trendingScore >= 80 ? '<span class="hero-trending-badge">\uD83D\uDD25 Trending</span>' : ''}
            <span class="stars">${renderStars(tool.rating)}</span>
            <span class="detail-rating-num" data-target="${tool.rating}">0</span><span class="detail-rating-num-small">/5</span>
            <span class="detail-category-badge">${catIcon} ${catName}</span>
          </div>
          <p class="detail-hero-desc">${tool.description}</p>
        </div>
      </div>

      <div class="detail-hero-actions reveal">
        <a href="/go/${tool.slug}" class="detail-cta" target="_blank" rel="noopener noreferrer" onclick="showToast()">Visit ${tool.name} &rarr;</a>
        <a href="${tool.url}" class="detail-cta-secondary" target="_blank" rel="noopener noreferrer">${tool.url.replace('https://', '').replace('www.', '')} <span class="ext-icon">&#8599;</span></a>
      </div>

      <div class="detail-comparison-bar reveal">
        <div class="comparison-item">
          <span class="comparison-label">Pricing</span>
          <span class="pricing-badge ${tool.pricing}">${formatPricing(tool.pricing)}</span>
        </div>
        <div class="comparison-item">
          <span class="comparison-label">Rating</span>
          <span class="comparison-value"><span class="stars">${renderStars(tool.rating)}</span> ${tool.rating}/5</span>
        </div>
        <div class="comparison-item">
          <span class="comparison-label">Category</span>
          <span class="comparison-value">${catIcon} ${catName}</span>
        </div>
        <div class="comparison-item">
          <span class="comparison-label">vs Category</span>
          ${compareBadge}
        </div>
        ${tool.globalRank ? `<div class="comparison-item">
          <span class="comparison-label">Domain Rank</span>
          <span class="comparison-value">#${tool.globalRank.toLocaleString()}</span>
        </div>` : ''}
      </div>

      ${screenshotsHtml}

      <section class="detail-section reveal">
        <h2 class="detail-section-title">Search Interest Over Time</h2>
        <div class="trends-time-btns" id="trends-btns">
          <button class="trends-btn" data-time="today 1-m">1M</button>
          <button class="trends-btn" data-time="today 3-m">3M</button>
          <button class="trends-btn active" data-time="today 12-m">1Y</button>
          <button class="trends-btn" data-time="today 5-y">5Y</button>
          <button class="trends-btn" data-time="all">All Time</button>
        </div>
        <div class="detail-trends-wrap" id="trends-widget"></div>
        <p class="trends-source">Source: Google Trends &mdash; worldwide search interest</p>
      </section>

      <div class="detail-two-col reveal">
        <div class="detail-main-col">
          <section class="detail-section">
            <h2 class="detail-section-title">About</h2>
            <div class="detail-about">
              ${formatLongDescription(tool.longDescription || tool.description)}
            </div>
          </section>

          ${buildCompanyInfoHtml(tool)}

          ${goodHtml}

          ${buildProsConsHtml(tool)}

          ${buildBestForHtml(tool)}

          ${buildUseCasesHtml(tool)}

          ${tool.tags && tool.tags.length > 0 ? `
          <section class="detail-section">
            <h2 class="detail-section-title">Related Tags</h2>
            <div class="detail-tags">
              ${tool.tags.map(t => `<a href="/?q=${encodeURIComponent(t)}" class="detail-tag">${t}</a>`).join('')}
            </div>
          </section>` : ''}
        </div>

        <aside class="detail-sidebar">
          <div class="detail-info-card">
            <span class="detail-info-label">Pricing</span>
            <span class="detail-info-value">
              <span class="pricing-badge ${tool.pricing}">${formatPricing(tool.pricing)}</span>
            </span>
            ${tool.pricingDetails ? `<div class="detail-pricing-callout">${tool.pricingDetails}</div>` : ''}
          </div>
          <div class="detail-info-card">
            <span class="detail-info-label">Category</span>
            <span class="detail-info-value">${catIcon} ${catName}</span>
          </div>
          <div class="detail-info-card">
            <span class="detail-info-label">Rating</span>
            <span class="detail-info-value"><span class="stars">${renderStars(tool.rating)}</span> <span class="detail-rating-num" data-target="${tool.rating}">0</span><span class="detail-rating-num-small">/5</span></span>
          </div>
          <div class="detail-info-card">
            <span class="detail-info-label">Website</span>
            <a href="${tool.url}" class="detail-info-link" target="_blank" rel="noopener">${tool.url.replace('https://', '').replace('www.', '')} <span class="ext-icon">&#8599;</span></a>
          </div>
          ${buildPlatformsHtml(tool)}
          ${buildIntegrationsHtml(tool)}
          ${buildPopularityHtml(tool)}
        </aside>
      </div>

      <aside class="detail-cta-section reveal">
        ${tool.freeTrial ? '<div class="free-trial-banner">\uD83C\uDF89 ' + tool.freeTrial + '</div>' : ''}
        <div class="detail-cta-box">
          <h2>Ready to try ${tool.name}?</h2>
          <p>Join thousands of users leveraging AI to work smarter.</p>
          <a href="/go/${tool.slug}" class="detail-cta detail-cta-lg" target="_blank" rel="noopener noreferrer" onclick="showToast()">Visit ${tool.name} &rarr;</a>
        </div>
      </aside>

      <section class="detail-similar reveal" id="similar-tools">
        <h2 class="detail-section-title" id="similar-title">${tool.alternatives && tool.alternatives.length > 0 ? 'Alternatives to ' + tool.name : 'Similar Tools'}</h2>
        <div class="detail-similar-grid" id="similar-grid">
          <!-- Populated by JS -->
        </div>
      </section>
    `;

    container.insertAdjacentHTML('beforeend', html);

    // Trigger page reveal
    container.classList.add('page-reveal');

    // Initialize features
    initScrollReveal();
    animateCounters();
    loadSimilarTools(tool.category, tool.slug, catIcon, allTools, tool.alternatives);
    loadGoogleTrends(tool.name);

  } catch (err) {
    loading.textContent = 'Tool not found.';
  }
}

// Build "What's Good" pills based on tool data
function buildGoodPills(tool) {
  var pills = [];
  if (tool.pricing === 'free' || tool.pricing === 'open-source') {
    pills.push('Free to use');
  } else if (tool.pricing === 'freemium') {
    pills.push('Free tier available');
  }
  if (tool.rating >= 4.5) {
    pills.push('Highly rated (' + tool.rating + '/5)');
  } else if (tool.rating >= 4.0) {
    pills.push('Well rated (' + tool.rating + '/5)');
  }
  if (tool.tags && tool.tags.length > 0) {
    var tagsLower = tool.tags.map(function(t) { return t.toLowerCase(); });
    if (tagsLower.indexOf('open source') !== -1 || tagsLower.indexOf('open-source') !== -1) {
      pills.push('Open source');
    }
    if (tagsLower.indexOf('api') !== -1) {
      pills.push('API available');
    }
    if (tagsLower.indexOf('no-code') !== -1 || tagsLower.indexOf('no code') !== -1) {
      pills.push('No-code friendly');
    }
    if (tagsLower.indexOf('collaboration') !== -1 || tagsLower.indexOf('team') !== -1) {
      pills.push('Team collaboration');
    }
    if (tagsLower.indexOf('mobile') !== -1) {
      pills.push('Mobile support');
    }
  }
  return pills;
}

function formatPricing(p) {
  const map = { free: 'Free', freemium: 'Freemium', paid: 'Paid', 'open-source': 'Open Source' };
  return map[p] || p;
}

function renderStars(rating) {
  const full = Math.round(rating);
  let html = '';
  for (let i = 1; i <= 5; i++) {
    html += i <= full ? '&#9733;' : '<span class="empty">&#9733;</span>';
  }
  return html;
}

function formatLongDescription(text) {
  if (!text) return '<p>No description available.</p>';
  const paragraphs = text.split(/\n\n+/).filter(p => p.trim());
  if (paragraphs.length <= 1) return `<p>${text}</p>`;
  return paragraphs.map(p => `<p>${p.trim()}</p>`).join('');
}

function openLightbox(src) {
  const overlay = document.createElement('div');
  overlay.className = 'lightbox-overlay';
  overlay.innerHTML = `<img src="${src}" alt="Screenshot" class="lightbox-img">`;
  overlay.onclick = function() { overlay.remove(); };
  document.body.appendChild(overlay);
}

// Load Google Trends widget dynamically
var _trendsLoaded = false;
var _trendsToolName = '';

function loadGoogleTrends(toolName, timeRange) {
  _trendsToolName = toolName;
  var container = document.getElementById('trends-widget');
  if (!container) return;
  var time = timeRange || 'today 12-m';
  var dateParam = time === 'all' ? 'all' : time.replace(/ /g, '%20');

  function renderTrends() {
    container.classList.add('loading');
    setTimeout(function() { container.innerHTML = ''; }, 150);
    setTimeout(function() {
    try {
      trends.embed.renderExploreWidgetTo(container, "TIMESERIES", {
        "comparisonItem": [{"keyword": toolName, "geo": "", "time": time === 'all' ? '2004-01-01 2026-05-28' : time}],
        "category": 0,
        "property": ""
      }, {
        "exploreQuery": "q=" + encodeURIComponent(toolName) + "&date=" + (time === 'all' ? 'all' : dateParam),
        "guestPath": "https://trends.google.com:443/trends/embed/"
      });
      setTimeout(function() { container.classList.remove('loading'); }, 500);
    } catch(e) {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">Trends data unavailable</p>';
      container.classList.remove('loading');
    }
    }, 200);
  }

  if (_trendsLoaded) {
    renderTrends();
  } else {
    var script = document.createElement('script');
    script.src = 'https://ssl.gstatic.com/trends_nrtr/3940_RC01/embed_loader.js';
    script.onload = function() {
      _trendsLoaded = true;
      renderTrends();
    };
    script.onerror = function() {
      container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px;">Trends data unavailable</p>';
    };
    document.head.appendChild(script);
  }

  // Bind time range buttons
  var btns = document.querySelectorAll('.trends-btn');
  btns.forEach(function(btn) {
    btn.onclick = function() {
      btns.forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      loadGoogleTrends(_trendsToolName, btn.getAttribute('data-time'));
    };
  });
}

// Intersection Observer for scroll reveal
function initScrollReveal() {
  var elements = document.querySelectorAll('.reveal');
  if (!('IntersectionObserver' in window)) {
    // Fallback: just show everything
    elements.forEach(function(el) { el.classList.add('revealed'); });
    return;
  }

  var observer = new IntersectionObserver(function(entries) {
    entries.forEach(function(entry) {
      if (entry.isIntersecting) {
        entry.target.classList.add('revealed');
        observer.unobserve(entry.target);
      }
    });
  }, { threshold: 0.1, rootMargin: '0px 0px -40px 0px' });

  elements.forEach(function(el) { observer.observe(el); });
}

// Animated counter: rating counts up
function animateCounters() {
  var ratingEls = document.querySelectorAll('.detail-rating-num[data-target]');

  ratingEls.forEach(function(el) {
    var target = parseFloat(el.getAttribute('data-target'));
    animateValue(el, 0, target, 600, 1);
  });
}

function animateValue(el, start, end, duration, decimals) {
  var startTime = null;
  function step(timestamp) {
    if (!startTime) startTime = timestamp;
    var progress = Math.min((timestamp - startTime) / duration, 1);
    // Ease out cubic
    var eased = 1 - Math.pow(1 - progress, 3);
    var current = start + (end - start) * eased;
    el.textContent = decimals > 0 ? current.toFixed(decimals) : Math.round(current);
    if (progress < 1) {
      requestAnimationFrame(step);
    } else {
      el.textContent = decimals > 0 ? end.toFixed(decimals) : end;
    }
  }
  requestAnimationFrame(step);
}

// Load similar tools
async function loadSimilarTools(category, currentSlug, fallbackIcon, allTools, alternatives) {
  try {
    var picks;

    // Use alternatives slugs if available
    if (alternatives && alternatives.length > 0) {
      picks = alternatives
        .map(function(slug) { return allTools.find(function(t) { return t.slug === slug; }); })
        .filter(Boolean)
        .slice(0, 4);
    }

    // Fall back to scored relevance if no alternatives or none found
    if (!picks || picks.length === 0) {
      // Fetch current tool's tags for relevance matching
      var currentTool = allTools.find(function(t) { return t.slug === currentSlug; });
      var currentTags = currentTool && currentTool.tags ? currentTool.tags.map(function(t) { return t.toLowerCase(); }) : [];

      // Get all tools, not just same category — score by relevance
      var others = allTools.filter(function(t) { return t.slug !== currentSlug; });
      if (others.length === 0) {
        var section = document.getElementById('similar-tools');
        if (section) section.style.display = 'none';
        return;
      }

      // Score each tool by relevance
      others.forEach(function(t) {
        var score = 0;
        if (t.category === category) score += 50;
        if (t.tags && currentTags.length > 0) {
          var tTags = t.tags.map(function(tag) { return tag.toLowerCase(); });
          var shared = currentTags.filter(function(tag) { return tTags.indexOf(tag) !== -1; });
          score += shared.length * 15;
        }
        if (currentTool && t.pricing === currentTool.pricing) score += 5;
        score += (t.rating || 0) * 2;
        score += (t.trendingScore || 0) * 0.1;
        t._score = score;
      });

      others.sort(function(a, b) { return b._score - a._score; });
      picks = others.slice(0, 3);
    }

    var grid = document.getElementById('similar-grid');
    if (!grid) return;

    grid.innerHTML = picks.map(function(t) {
      var logoHtml = t.logo
        ? '<img src="' + t.logo + '" alt="' + t.name + '" onerror="this.style.display=\'none\';this.parentElement.textContent=\'' + (fallbackIcon || 'AI') + '\';">'
        : (fallbackIcon || 'AI');
      return '<a href="/tool/' + t.slug + '" class="similar-card">' +
        '<div class="similar-card-header">' +
          '<div class="similar-card-logo">' + logoHtml + '</div>' +
          '<span class="similar-card-name">' + t.name + '</span>' +
        '</div>' +
        '<p class="similar-card-desc">' + t.description + '</p>' +
        '<div class="similar-card-meta">' +
          '<span class="pricing-badge ' + t.pricing + '">' + formatPricing(t.pricing) + '</span>' +
          '<span class="stars">' + renderStars(t.rating) + '</span>' +
        '</div>' +
      '</a>';
    }).join('');

  } catch (e) {
    var section = document.getElementById('similar-tools');
    if (section) section.style.display = 'none';
  }
}

// Toast notification when clicking Visit
function showToast() {
  var existing = document.querySelector('.detail-toast');
  if (existing) existing.remove();

  var toast = document.createElement('div');
  toast.className = 'detail-toast';
  toast.textContent = 'Opening...';
  document.body.appendChild(toast);

  requestAnimationFrame(function() {
    requestAnimationFrame(function() {
      toast.classList.add('show');
    });
  });

  setTimeout(function() {
    toast.classList.remove('show');
    setTimeout(function() { toast.remove(); }, 400);
  }, 1500);
}

// Format large numbers (e.g. 1800000000 -> "1.8B")
function formatVisits(num) {
  if (!num) return '';
  if (num >= 1000000000) return (num / 1000000000).toFixed(1).replace(/\.0$/, '') + 'B';
  if (num >= 1000000) return (num / 1000000).toFixed(1).replace(/\.0$/, '') + 'M';
  if (num >= 1000) return (num / 1000).toFixed(1).replace(/\.0$/, '') + 'K';
  return num.toString();
}

// Get trending info from score
function getTrendingInfo(score) {
  if (score >= 80) return { label: 'Trending', cls: 'hot', barCls: 'trending-hot', emoji: '\uD83D\uDD25' };
  if (score >= 60) return { label: 'Popular', cls: 'popular', barCls: 'trending-popular', emoji: '' };
  if (score >= 40) return { label: 'Growing', cls: 'growing', barCls: 'trending-growing', emoji: '' };
  return { label: 'Niche', cls: 'niche', barCls: 'trending-niche', emoji: '' };
}

// Build Company Info HTML
function buildCompanyInfoHtml(tool) {
  var rows = [];
  if (tool.founder) rows.push('<div class="company-info-row"><span class="company-info-icon">\uD83D\uDC64</span><span class="company-info-label">Founded by</span><span class="company-info-value">' + tool.founder + '</span></div>');
  if (tool.founded) rows.push('<div class="company-info-row"><span class="company-info-icon">\uD83D\uDCC5</span><span class="company-info-label">Founded</span><span class="company-info-value">' + tool.founded + '</span></div>');
  if (tool.headquarters) rows.push('<div class="company-info-row"><span class="company-info-icon">\uD83D\uDCCD</span><span class="company-info-label">HQ</span><span class="company-info-value">' + tool.headquarters + '</span></div>');
  if (tool.employeeCount) rows.push('<div class="company-info-row"><span class="company-info-icon">\uD83D\uDC65</span><span class="company-info-label">Team</span><span class="company-info-value">' + tool.employeeCount + ' employees</span></div>');
  if (rows.length === 0) return '';
  return '<section class="detail-section"><h2 class="detail-section-title">Company Info</h2><div class="detail-company-info">' + rows.join('') + '</div></section>';
}

// Build Popularity HTML for sidebar
function buildPopularityHtml(tool) {
  var hasRank = tool.globalRank != null;
  var hasScore = tool.trendingScore != null;
  if (!hasRank && !hasScore) return '';

  var html = '<div class="detail-info-card">';
  html += '<span class="detail-info-label">Popularity</span>';

  if (hasRank) {
    var domain = ''; try { domain = new URL(tool.url).hostname.replace('www.',''); } catch(e) {}
    html += '<span class="monthly-visits-big">#' + tool.globalRank.toLocaleString() + '</span>';
    html += '<span style="font-size:11px;color:var(--text-muted);">' + domain + '</span>';
    html += '<span style="font-size:10px;color:var(--text-muted);opacity:0.6;">Tranco Domain Rank</span>';
  }

  if (hasScore) {
    var info = getTrendingInfo(tool.trendingScore);
    html += '<div style="margin-top:8px;display:flex;align-items:center;gap:6px;">';
    html += '<span class="trending-badge ' + info.cls + '">' + (info.emoji ? info.emoji + ' ' : '') + info.label + '</span>';
    html += '<span style="font-size:12px;color:var(--text-muted);">' + tool.trendingScore + '/100</span>';
    html += '</div>';
    html += '<div class="trending-bar"><div class="trending-bar-fill ' + info.barCls + '" style="width:' + tool.trendingScore + '%;"></div></div>';
  }

  html += '</div>';
  return html;
}

// Build Pros & Cons HTML
function buildProsConsHtml(tool) {
  var hasPros = tool.pros && tool.pros.length > 0;
  var hasCons = tool.cons && tool.cons.length > 0;
  if (!hasPros && !hasCons) return '';
  var prosHtml = hasPros ? '<div class="pros-col">' + tool.pros.map(function(p) { return '<div class="pros-item">\u2713 ' + p + '</div>'; }).join('') + '</div>' : '<div class="pros-col"></div>';
  var consHtml = hasCons ? '<div class="cons-col">' + tool.cons.map(function(c) { return '<div class="cons-item">\u2717 ' + c + '</div>'; }).join('') + '</div>' : '<div class="cons-col"></div>';
  return '<section class="detail-section"><h2 class="detail-section-title">Pros &amp; Cons</h2><div class="pros-cons-grid">' + prosHtml + consHtml + '</div></section>';
}

// Build Best For HTML
function buildBestForHtml(tool) {
  if (!tool.bestFor || tool.bestFor.length === 0) return '';
  var emojiMap = {
    'developers': '\uD83D\uDC68\u200D\uD83D\uDCBB', 'designers': '\uD83C\uDFA8', 'writers': '\u270D\uFE0F',
    'marketers': '\uD83D\uDCC8', 'students': '\uD83C\uDF93', 'researchers': '\uD83D\uDD2C',
    'creators': '\uD83C\uDFAC', 'entrepreneurs': '\uD83D\uDE80', 'enterprises': '\uD83C\uDFE2',
    'beginners': '\uD83C\uDF31', 'teams': '\uD83D\uDC65', 'freelancers': '\uD83D\uDCBC',
    'educators': '\uD83D\uDCDA', 'data scientists': '\uD83D\uDCCA'
  };
  var badges = tool.bestFor.map(function(b) {
    var emoji = emojiMap[b.toLowerCase()] || '';
    var label = b.replace(/-/g, ' ');
    return '<span class="bestfor-badge">' + (emoji ? emoji + ' ' : '') + label.charAt(0).toUpperCase() + label.slice(1) + '</span>';
  }).join('');
  return '<section class="detail-section"><h2 class="detail-section-title">Best For</h2><div class="bestfor-badges">' + badges + '</div></section>';
}

// Build Use Cases HTML
function buildUseCasesHtml(tool) {
  if (!tool.useCases || tool.useCases.length === 0) return '';
  var items = tool.useCases.map(function(u) { return '<div class="usecase-item">\u2192 ' + u + '</div>'; }).join('');
  return '<section class="detail-section"><h2 class="detail-section-title">Use Cases</h2><div class="usecases-list">' + items + '</div></section>';
}

// Build Platforms HTML (sidebar)
function buildPlatformsHtml(tool) {
  if (!tool.platforms || tool.platforms.length === 0) return '';
  var platformMap = {
    'web': '\uD83C\uDF10 Web', 'ios': '\uD83D\uDCF1 iOS', 'android': '\uD83E\uDD16 Android',
    'desktop': '\uD83D\uDCBB Desktop', 'api': '\u26A1 API', 'extension': '\uD83E\uDDE9 Extension',
    'cli': '\u2328\uFE0F CLI'
  };
  var badges = tool.platforms.map(function(p) {
    var label = platformMap[p.toLowerCase()] || p;
    return '<span class="platform-badge">' + label + '</span>';
  }).join('');
  return '<div class="detail-info-card"><span class="detail-info-label">Platforms</span><div class="platforms-row">' + badges + '</div></div>';
}

// Build Integrations HTML (sidebar)
function buildIntegrationsHtml(tool) {
  if (!tool.integrations || tool.integrations.length === 0) return '';
  var pills = tool.integrations.map(function(i) { return '<span class="integration-pill">' + i + '</span>'; }).join('');
  return '<div class="detail-info-card"><span class="detail-info-label">Integrations</span><div class="integrations-list">' + pills + '</div></div>';
}

loadTool();
