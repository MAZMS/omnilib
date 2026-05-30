const express = require('express');
const fs = require('fs');
const path = require('path');
const multer = require('multer');
const db = require('./db');

const app = express();
const PORT = process.env.PORT || 3000;
const ADMIN_KEY = process.env.ADMIN_KEY || 'admin';
const DATA_FILE = path.join(__dirname, 'data', 'tools.json');

// --- Security ---
app.disable('x-powered-by');

// Rate limiter (in-memory, per IP)
const rateLimits = {};
function rateLimit(key, maxReqs, windowSec) {
  return (req, res, next) => {
    const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
    const id = `${key}:${ip}`;
    const now = Date.now();
    if (!rateLimits[id]) rateLimits[id] = { count: 0, reset: now + windowSec * 1000 };
    if (now > rateLimits[id].reset) { rateLimits[id] = { count: 0, reset: now + windowSec * 1000 }; }
    rateLimits[id].count++;
    if (rateLimits[id].count > maxReqs) {
      return res.status(429).json({ error: 'Too many requests. Try again later.' });
    }
    next();
  };
}
// Clean up rate limits every 5 min
setInterval(() => { const now = Date.now(); for (const k in rateLimits) { if (now > rateLimits[k].reset) delete rateLimits[k]; } }, 300000);

// Admin brute force protection
const adminAttempts = {};
function adminBruteForce(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const now = Date.now();
  if (adminAttempts[ip] && adminAttempts[ip].locked > now) {
    return res.status(429).json({ error: 'Too many failed attempts. Locked for 15 minutes.' });
  }
  next();
}

// Sanitize user input (strip HTML tags)
function sanitize(str) {
  if (typeof str !== 'string') return '';
  return str.replace(/[<>]/g, '').trim();
}

// Middleware
app.use(express.json({ limit: '50kb' }));
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('X-XSS-Protection', '1; mode=block');
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
  if (process.env.NODE_ENV === 'production' || process.env.PORT) {
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  next();
});

// Block direct access to data files
app.use('/data', (req, res) => res.status(403).json({ error: 'Forbidden' }));

// --- Site stats tracking (PostgreSQL) ---
function trackPageEvent(type, extra) {
  db.trackEvent(type, extra).catch(err => console.error('Stats track error:', err.message));
}

// Track page views (skip static assets and API calls)
app.use((req, res, next) => {
  if (req.method === 'GET' && !req.path.startsWith('/api/') && !req.path.startsWith('/css/') && !req.path.startsWith('/js/') && !req.path.startsWith('/images/') && !req.path.includes('.')) {
    trackPageEvent('views');
  }
  next();
});

// Serve llms.txt with text/plain
app.get('/llms.txt', (req, res) => {
  res.type('text/plain').sendFile(path.join(__dirname, 'public', 'llms.txt'));
});

// Serve .well-known directory
app.use('/.well-known', express.static(path.join(__dirname, 'public', '.well-known')));

// Static files
app.use(express.static(path.join(__dirname, 'public')));

// Image upload config
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    const dir = file.fieldname === 'logo'
      ? path.join(__dirname, 'public', 'images', 'logos')
      : path.join(__dirname, 'public', 'images', 'screenshots');
    cb(null, dir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname);
    const name = Date.now() + '-' + Math.round(Math.random() * 1e6) + ext;
    cb(null, name);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    const allowed = /\.(jpg|jpeg|png|gif|webp|svg)$/i;
    cb(null, allowed.test(path.extname(file.originalname)));
  }
});

// --- Data helpers (tools from JSON, clicks from PostgreSQL) ---

let clicksCache = {};
let clicksCacheTime = 0;

function readData() {
  return JSON.parse(fs.readFileSync(DATA_FILE, 'utf8'));
}

let writeQueue = Promise.resolve();
function writeData(data) {
  writeQueue = writeQueue.then(() =>
    fs.promises.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8')
  );
  return writeQueue;
}

// Merge clicks from DB into tools
async function getToolsWithClicks() {
  const now = Date.now();
  if (now - clicksCacheTime > 30000) {
    try {
      clicksCache = await db.getClicksMap();
      clicksCacheTime = now;
    } catch {}
  }
  const data = readData();
  for (const tool of data.tools) {
    if (clicksCache[tool.slug]) {
      tool.clicks = (tool.clicks || 0) + clicksCache[tool.slug];
    }
  }
  return data;
}

function adminAuth(req, res, next) {
  const ip = req.headers['x-forwarded-for']?.split(',')[0]?.trim() || req.ip;
  const auth = req.headers.authorization;
  if (!auth || auth !== `Bearer ${ADMIN_KEY}`) {
    if (!adminAttempts[ip]) adminAttempts[ip] = { count: 0, locked: 0 };
    adminAttempts[ip].count++;
    if (adminAttempts[ip].count >= 5) {
      adminAttempts[ip].locked = Date.now() + 15 * 60 * 1000;
      adminAttempts[ip].count = 0;
    }
    return res.status(401).json({ error: 'Unauthorized' });
  }
  delete adminAttempts[ip];
  next();
}

// --- Feedback API (PostgreSQL) ---

app.post('/api/feedback', rateLimit('feedback', 5, 60), async (req, res) => {
  try {
    const { type, message, email, page } = req.body;
    if (!message || message.length < 3 || message.length > 2000) {
      return res.status(400).json({ error: 'Message must be 3-2000 characters' });
    }
    const allowed = ['feedback', 'bug', 'feature', 'other'];
    await db.addFeedback({
      type: allowed.includes(type) ? type : 'feedback',
      message: sanitize(message).slice(0, 2000),
      email: sanitize(email || '').slice(0, 120),
      page: sanitize(page || '').slice(0, 200)
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Feedback error:', err.message);
    res.status(500).json({ error: 'Failed to save feedback' });
  }
});

// --- Submissions API (PostgreSQL) ---

app.post('/api/submissions', rateLimit('submissions', 3, 60), async (req, res) => {
  try {
    const { toolName, url, category, pricing, description, email } = req.body;
    if (!toolName || !url || !description || !email) {
      return res.status(400).json({ error: 'Tool name, URL, description, and email are required' });
    }
    await db.addSubmission({
      toolName: sanitize(toolName).slice(0, 120),
      url: sanitize(url).slice(0, 500),
      category: sanitize(category || '').slice(0, 50),
      pricing: sanitize(pricing || '').slice(0, 30),
      description: sanitize(description).slice(0, 2000),
      email: sanitize(email).slice(0, 120)
    });
    res.json({ ok: true });
  } catch (err) {
    console.error('Submission error:', err.message);
    res.status(500).json({ error: 'Failed to save submission' });
  }
});

// --- Newsletter API (PostgreSQL) ---

app.post('/api/subscribe', rateLimit('newsletter', 3, 60), async (req, res) => {
  try {
    const { email } = req.body;
    if (!email || !email.includes('@') || email.length > 200) return res.status(400).json({ error: 'Valid email required' });
    const clean = sanitize(email).toLowerCase();
    const result = await db.addSubscriber(clean);
    res.json(result);
  } catch (err) {
    console.error('Subscribe error:', err.message);
    res.status(500).json({ error: 'Failed to subscribe' });
  }
});

// --- Public API ---

// Get all tools (with search/filter)
app.get('/api/tools', async (req, res) => {
  try {
    const data = await getToolsWithClicks();
    let tools = data.tools;

    if (req.query.q) trackPageEvent('searches');

    // Search
    if (req.query.q) {
      const q = req.query.q.toLowerCase();
      tools = tools.filter(t =>
        t.name.toLowerCase().includes(q) ||
        t.description.toLowerCase().includes(q) ||
        (t.longDescription && t.longDescription.toLowerCase().includes(q)) ||
        t.tags.some(tag => tag.toLowerCase().includes(q)) ||
        (t.bestFor && t.bestFor.some(b => b.toLowerCase().includes(q))) ||
        (t.useCases && t.useCases.some(u => u.toLowerCase().includes(q))) ||
        (t.category && t.category.toLowerCase().includes(q))
      );
    }

    // Filter by category
    if (req.query.category) {
      tools = tools.filter(t => t.category === req.query.category);
    }

    // Filter by pricing
    if (req.query.pricing) {
      tools = tools.filter(t => t.pricing === req.query.pricing);
    }

    // Filter by tag
    if (req.query.tag) {
      const tag = req.query.tag.toLowerCase();
      tools = tools.filter(t => t.tags.some(tg => tg.toLowerCase() === tag));
    }

    // Filter featured only
    if (req.query.featured === 'true') {
      tools = tools.filter(t => t.featured);
    }

    // Sort
    const sort = req.query.sort || 'rating';
    if (sort === 'rating') {
      tools.sort((a, b) => b.rating - a.rating);
    } else if (sort === 'newest') {
      tools.sort((a, b) => new Date(b.dateAdded) - new Date(a.dateAdded));
    } else if (sort === 'popular') {
      tools.sort((a, b) => b.clicks - a.clicks);
    } else if (sort === 'name') {
      tools.sort((a, b) => a.name.localeCompare(b.name));
    }

    res.json(tools);
  } catch (err) {
    // Fallback to plain file read
    const data = readData();
    res.json(data.tools);
  }
});

// Get single tool
app.get('/api/tools/:slug', (req, res) => {
  const data = readData();
  const tool = data.tools.find(t => t.slug === req.params.slug);
  if (!tool) return res.status(404).json({ error: 'Tool not found' });
  res.json(tool);
});

// Get categories
app.get('/api/categories', (req, res) => {
  const data = readData();
  res.json(data.categories);
});

// --- AI-powered semantic search ---

app.get('/api/ai-search', rateLimit('ai-search', 10, 60), async (req, res) => {
  const query = req.query.q;
  if (!query) return res.json([]);

  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) {
    return res.redirect('/api/tools?q=' + encodeURIComponent(query));
  }

  try {
    const data = readData();
    const toolSummaries = data.tools.slice(0, 200).map(t =>
      `${t.slug}: ${t.name} - ${t.description} [${t.category}, ${t.pricing}]`
    ).join('\n');

    const response = await fetch('https://api.openai.com/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + OPENAI_KEY
      },
      body: JSON.stringify({
        model: 'gpt-4.1-nano',
        messages: [
          {
            role: 'system',
            content: 'You are a tool recommendation engine. Given a user query, return the slugs of the 5 most relevant AI tools from this list. Return ONLY a JSON array of slugs, nothing else.\n\nTools:\n' + toolSummaries
          },
          { role: 'user', content: query }
        ],
        max_tokens: 200,
        temperature: 0
      })
    });

    const aiData = await response.json();
    const content = aiData.choices?.[0]?.message?.content || '[]';
    let slugs;
    try { slugs = JSON.parse(content); } catch { slugs = []; }

    // Track token usage in PostgreSQL
    if (aiData.usage) {
      db.logAiUsage('gpt-4.1-nano', aiData.usage.prompt_tokens || 0, aiData.usage.completion_tokens || 0, query)
        .catch(err => console.error('AI usage log error:', err.message));
    }

    const results = slugs
      .map(slug => data.tools.find(t => t.slug === slug))
      .filter(Boolean);

    res.json(results);
  } catch(e) {
    const data = readData();
    const q = query.toLowerCase();
    const results = data.tools.filter(t =>
      t.name.toLowerCase().includes(q) ||
      t.description.toLowerCase().includes(q) ||
      (t.longDescription && t.longDescription.toLowerCase().includes(q)) ||
      (t.tags && t.tags.some(tag => tag.toLowerCase().includes(q))) ||
      (t.bestFor && t.bestFor.some(b => b.toLowerCase().includes(q))) ||
      (t.useCases && t.useCases.some(u => u.toLowerCase().includes(q))) ||
      (t.category && t.category.toLowerCase().includes(q))
    ).slice(0, 5);
    res.json(results);
  }
});

// --- Affiliate redirect (clicks stored in PostgreSQL) ---

app.get('/go/:slug', async (req, res) => {
  const data = readData();
  const tool = data.tools.find(t => t.slug === req.params.slug);
  if (!tool) return res.status(404).send('Tool not found');

  // Track click in PostgreSQL (fire and forget)
  db.incrementClicks(req.params.slug).catch(err => console.error('Click track error:', err.message));
  trackPageEvent('affiliateClicks');

  res.redirect(302, tool.affiliateUrl);
});

// --- Tool detail page (with SEO meta injection) ---

app.get('/tool/:slug', (req, res) => {
  trackPageEvent('toolViews', req.params.slug);
  const data = readData();
  const tool = data.tools.find(t => t.slug === req.params.slug);

  let html = fs.readFileSync(path.join(__dirname, 'public', 'tool.html'), 'utf8');

  if (tool) {
    const pricingLabel = { free: 'Free', freemium: 'Freemium', paid: 'Paid', 'open-source': 'Open Source' }[tool.pricing] || tool.pricing;
    const metaTitle = `${tool.name} — AI Tool Review & Pricing | Great Library AI`;
    const metaDesc = `${tool.description} ${tool.pricingDetails ? tool.pricingDetails + '.' : ''} Pricing: ${pricingLabel}. Rating: ${tool.rating}/5.`.replace(/\s+/g, ' ').trim();
    const ogImage = tool.logo && tool.logo.startsWith('http') ? tool.logo : (tool.logo ? `https://greatlibrary.ai${tool.logo}` : 'https://greatlibrary.ai/images/og-default.png');
    const canonicalUrl = `https://greatlibrary.ai/tool/${tool.slug}`;

    html = html.replace('{{TITLE}}', metaTitle);
    html = html.replace('{{DESCRIPTION}}', metaDesc);
    html = html.replace('{{OG_TITLE}}', `${tool.name} — AI Tool Review & Pricing`);
    html = html.replace('{{OG_DESCRIPTION}}', metaDesc);
    html = html.replace(/\{\{OG_IMAGE\}\}/g, ogImage);
    html = html.replace(/\{\{SLUG\}\}/g, tool.slug);

    const cat = data.categories ? data.categories.find(c => c.id === tool.category) : null;
    const categoryName = cat ? cat.name : tool.category;
    const jsonLd = {
      '@context': 'https://schema.org',
      '@type': 'SoftwareApplication',
      name: tool.name,
      description: tool.description,
      url: canonicalUrl,
      applicationCategory: categoryName,
      operatingSystem: 'Web',
      image: ogImage,
      datePublished: tool.dateAdded,
      offers: {
        '@type': 'Offer',
        price: tool.pricing === 'free' ? '0' : undefined,
        priceCurrency: 'USD',
        availability: 'https://schema.org/OnlineOnly',
        description: tool.pricingDetails || pricingLabel
      },
      aggregateRating: {
        '@type': 'AggregateRating',
        ratingValue: tool.rating,
        bestRating: 5,
        worstRating: 1,
        ratingCount: Math.max(tool.clicks || 1, 1)
      },
      publisher: {
        '@type': 'Organization',
        name: 'Great Library AI',
        url: 'https://greatlibrary.ai'
      }
    };
    if (tool.tags && tool.tags.length > 0) {
      jsonLd.keywords = tool.tags.join(', ');
    }
    html = html.replace('{{JSON_LD}}', JSON.stringify(jsonLd));
  } else {
    html = html.replace('{{TITLE}}', 'Tool Not Found — Great Library AI');
    html = html.replace('{{DESCRIPTION}}', 'This tool was not found.');
    html = html.replace('{{OG_TITLE}}', 'Tool Not Found');
    html = html.replace('{{OG_DESCRIPTION}}', 'This tool was not found.');
    html = html.replace(/\{\{OG_IMAGE\}\}/g, 'https://greatlibrary.ai/images/og-default.png');
    html = html.replace(/\{\{SLUG\}\}/g, '');
    html = html.replace('{{JSON_LD}}', '{}');
  }

  res.send(html);
});

// --- Compare page ---

app.get('/compare', (req, res) => {
  trackPageEvent('compareViews');
  const data = readData();
  let html = fs.readFileSync(path.join(__dirname, 'public', 'compare.html'), 'utf8');

  const slugs = (req.query.tools || '').split(',').filter(Boolean);
  const tools = slugs.map(s => data.tools.find(t => t.slug === s)).filter(Boolean);

  if (tools.length >= 2) {
    const names = tools.map(t => t.name).join(' vs ');
    html = html.replace('{{TITLE}}', `${names} — Compare AI Tools | Great Library AI`);
    html = html.replace(/\{\{DESCRIPTION\}\}/g, `Compare ${names}: pricing, features, pros & cons, ratings. Find the best AI tool.`);
    html = html.replace('{{OG_TITLE}}', `${names} — AI Tool Comparison`);
  } else {
    html = html.replace('{{TITLE}}', 'Compare AI Tools — Great Library AI');
    html = html.replace(/\{\{DESCRIPTION\}\}/g, 'Compare AI tools side by side. Features, pricing, pros, cons, and ratings.');
    html = html.replace('{{OG_TITLE}}', 'Compare AI Tools');
  }

  res.send(html);
});

// --- Admin page ---

app.get('/admin', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

// --- Sitemap ---

app.get('/sitemap.xml', (req, res) => {
  const data = readData();
  const base = 'https://greatlibrary.ai';

  let xml = '<?xml version="1.0" encoding="UTF-8"?>\n';
  xml += '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n';
  xml += `  <url><loc>${base}/</loc><changefreq>daily</changefreq><priority>1.0</priority></url>\n`;
  xml += `  <url><loc>${base}/compare</loc><changefreq>weekly</changefreq><priority>0.7</priority></url>\n`;

  for (const tool of data.tools) {
    xml += `  <url><loc>${base}/tool/${tool.slug}</loc><changefreq>weekly</changefreq><priority>0.8</priority></url>\n`;
  }

  xml += '</urlset>';
  res.type('application/xml').send(xml);
});

// --- Admin API (all using PostgreSQL) ---

app.use('/api/admin', adminBruteForce, rateLimit('admin', 30, 60));

app.post('/api/admin/tools', adminAuth, async (req, res) => {
  const data = readData();
  const tool = req.body;

  if (!tool.name || !tool.slug) {
    return res.status(400).json({ error: 'Name and slug are required' });
  }

  if (data.tools.find(t => t.slug === tool.slug)) {
    return res.status(409).json({ error: 'Tool with this slug already exists' });
  }

  const newTool = {
    id: tool.slug,
    slug: tool.slug,
    name: tool.name,
    description: tool.description || '',
    longDescription: tool.longDescription || '',
    url: tool.url || '',
    affiliateUrl: tool.affiliateUrl || tool.url || '',
    category: tool.category || 'productivity',
    tags: tool.tags || [],
    pricing: tool.pricing || 'free',
    pricingDetails: tool.pricingDetails || '',
    rating: parseFloat(tool.rating) || 0,
    logo: tool.logo || '',
    screenshots: tool.screenshots || [],
    featured: tool.featured || false,
    dateAdded: new Date().toISOString().split('T')[0],
    clicks: 0
  };

  data.tools.push(newTool);
  await writeData(data);
  res.status(201).json(newTool);
});

app.put('/api/admin/tools/:id', adminAuth, async (req, res) => {
  const data = readData();
  const idx = data.tools.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tool not found' });

  const updates = req.body;
  const tool = data.tools[idx];

  const fields = ['name', 'slug', 'description', 'longDescription', 'url', 'affiliateUrl',
    'category', 'tags', 'pricing', 'pricingDetails', 'rating', 'logo', 'screenshots', 'featured'];
  for (const field of fields) {
    if (updates[field] !== undefined) {
      tool[field] = updates[field];
    }
  }

  data.tools[idx] = tool;
  await writeData(data);
  res.json(tool);
});

app.delete('/api/admin/tools/:id', adminAuth, async (req, res) => {
  const data = readData();
  const idx = data.tools.findIndex(t => t.id === req.params.id);
  if (idx === -1) return res.status(404).json({ error: 'Tool not found' });

  data.tools.splice(idx, 1);
  await writeData(data);
  res.json({ success: true });
});

// --- Admin: Subscribers (PostgreSQL) ---

app.get('/api/admin/subscribers', adminAuth, async (req, res) => {
  try {
    const subs = await db.getSubscribers();
    res.json(subs);
  } catch (err) {
    console.error('Get subscribers error:', err.message);
    res.json([]);
  }
});

app.delete('/api/admin/subscribers/:email', adminAuth, async (req, res) => {
  try {
    await db.deleteSubscriber(req.params.email);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// --- Admin: Submissions (PostgreSQL) ---

app.get('/api/admin/submissions', adminAuth, async (req, res) => {
  try {
    const subs = await db.getSubmissions();
    res.json(subs);
  } catch (err) {
    console.error('Get submissions error:', err.message);
    res.json([]);
  }
});

app.put('/api/admin/submissions/:id', adminAuth, async (req, res) => {
  try {
    const item = await db.updateSubmission(req.params.id, req.body.status);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.delete('/api/admin/submissions/:id', adminAuth, async (req, res) => {
  try {
    await db.deleteSubmission(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// --- Admin: Feedback (PostgreSQL) ---

app.get('/api/admin/feedback', adminAuth, async (req, res) => {
  try {
    const feedback = await db.getFeedback();
    res.json(feedback);
  } catch (err) {
    console.error('Get feedback error:', err.message);
    res.json([]);
  }
});

app.put('/api/admin/feedback/:id', adminAuth, async (req, res) => {
  try {
    const item = await db.updateFeedback(req.params.id, req.body.read);
    if (!item) return res.status(404).json({ error: 'Not found' });
    res.json(item);
  } catch (err) {
    res.status(500).json({ error: 'Failed to update' });
  }
});

app.delete('/api/admin/feedback/:id', adminAuth, async (req, res) => {
  try {
    await db.deleteFeedback(req.params.id);
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Failed to delete' });
  }
});

// --- Admin: Site Stats & AI Usage (PostgreSQL) ---

app.get('/api/admin/site-stats', adminAuth, async (req, res) => {
  try {
    const stats = await db.getSiteStats();
    res.json(stats);
  } catch (err) {
    console.error('Get stats error:', err.message);
    res.json({ daily: {}, total: { views: 0, toolViews: 0, affiliateClicks: 0, compareViews: 0, searches: 0 } });
  }
});

app.get('/api/admin/ai-usage', adminAuth, async (req, res) => {
  try {
    const usage = await db.getAiUsage();
    res.json(usage);
  } catch (err) {
    console.error('Get AI usage error:', err.message);
    res.json({ daily: {}, total: { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 } });
  }
});

app.post('/api/admin/upload', adminAuth, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

  const relativePath = '/images/' +
    (req.body.type === 'logo' ? 'logos/' : 'screenshots/') +
    req.file.filename;

  res.json({ path: relativePath });
});

// --- Health check ---

app.get('/health', async (req, res) => {
  try {
    await db.pool.query('SELECT 1');
    res.json({ status: 'ok', db: 'connected' });
  } catch {
    res.json({ status: 'ok', db: 'disconnected' });
  }
});

// --- Graceful shutdown ---

process.on('SIGTERM', async () => {
  console.log('SIGTERM received, shutting down...');
  await db.pool.end();
  process.exit(0);
});

// --- Start ---

async function start() {
  try {
    await db.initDB();
    console.log('PostgreSQL connected');
  } catch (err) {
    console.error('PostgreSQL connection failed:', err.message);
    console.log('Server will start but DB features will fail');
  }

  app.listen(PORT, () => {
    console.log(`Great Library AI running on port ${PORT}`);
  });
}

start();
