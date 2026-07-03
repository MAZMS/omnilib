const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' || process.env.DATABASE_URL?.includes('railway')
    ? { rejectUnauthorized: false }
    : false,
  max: 10,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 5000
});

pool.on('error', (err) => {
  console.error('Unexpected PG pool error:', err.message);
});

// --- Init tables ---
async function initDB() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS subscribers (
        id SERIAL PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        date TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE TABLE IF NOT EXISTS submissions (
        id TEXT PRIMARY KEY,
        tool_name TEXT NOT NULL,
        url TEXT NOT NULL,
        category TEXT DEFAULT '',
        pricing TEXT DEFAULT '',
        description TEXT NOT NULL,
        email TEXT NOT NULL,
        date TIMESTAMPTZ DEFAULT NOW(),
        status TEXT DEFAULT 'new'
      );

      CREATE TABLE IF NOT EXISTS feedback (
        id TEXT PRIMARY KEY,
        type TEXT DEFAULT 'feedback',
        message TEXT NOT NULL,
        email TEXT DEFAULT '',
        page TEXT DEFAULT '',
        date TIMESTAMPTZ DEFAULT NOW(),
        read BOOLEAN DEFAULT FALSE
      );

      CREATE TABLE IF NOT EXISTS site_stats (
        date DATE PRIMARY KEY,
        views INT DEFAULT 0,
        tool_views INT DEFAULT 0,
        affiliate_clicks INT DEFAULT 0,
        compare_views INT DEFAULT 0,
        searches INT DEFAULT 0,
        top_tools JSONB DEFAULT '{}'
      );

      CREATE TABLE IF NOT EXISTS site_stats_total (
        id INT PRIMARY KEY DEFAULT 1,
        views BIGINT DEFAULT 0,
        tool_views BIGINT DEFAULT 0,
        affiliate_clicks BIGINT DEFAULT 0,
        compare_views BIGINT DEFAULT 0,
        searches BIGINT DEFAULT 0
      );

      INSERT INTO site_stats_total (id) VALUES (1) ON CONFLICT DO NOTHING;

      CREATE TABLE IF NOT EXISTS ai_usage (
        date DATE PRIMARY KEY,
        requests INT DEFAULT 0,
        prompt_tokens INT DEFAULT 0,
        completion_tokens INT DEFAULT 0,
        total_tokens INT DEFAULT 0,
        queries JSONB DEFAULT '[]'
      );

      CREATE TABLE IF NOT EXISTS ai_usage_total (
        id INT PRIMARY KEY DEFAULT 1,
        requests BIGINT DEFAULT 0,
        prompt_tokens BIGINT DEFAULT 0,
        completion_tokens BIGINT DEFAULT 0,
        total_tokens BIGINT DEFAULT 0
      );

      INSERT INTO ai_usage_total (id) VALUES (1) ON CONFLICT DO NOTHING;

      CREATE TABLE IF NOT EXISTS tool_clicks (
        slug TEXT PRIMARY KEY,
        clicks INT DEFAULT 0
      );

      CREATE TABLE IF NOT EXISTS blog_posts (
        id SERIAL PRIMARY KEY,
        slug TEXT UNIQUE NOT NULL,
        title TEXT NOT NULL,
        excerpt TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        meta_description TEXT NOT NULL DEFAULT '',
        tags TEXT[] DEFAULT '{}',
        category TEXT DEFAULT 'ai-news',
        featured_image TEXT DEFAULT '',
        author TEXT DEFAULT 'Omnilib',
        status TEXT DEFAULT 'published',
        views INT DEFAULT 0,
        published_at TIMESTAMPTZ DEFAULT NOW(),
        created_at TIMESTAMPTZ DEFAULT NOW(),
        updated_at TIMESTAMPTZ DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_blog_posts_slug ON blog_posts(slug);
      CREATE INDEX IF NOT EXISTS idx_blog_posts_status ON blog_posts(status);
      CREATE INDEX IF NOT EXISTS idx_blog_posts_published ON blog_posts(published_at DESC);

      ALTER TABLE site_stats ADD COLUMN IF NOT EXISTS blog_views INT DEFAULT 0;
      ALTER TABLE site_stats ADD COLUMN IF NOT EXISTS top_posts JSONB DEFAULT '{}';
      ALTER TABLE site_stats_total ADD COLUMN IF NOT EXISTS blog_views BIGINT DEFAULT 0;
    `);
    console.log('Database tables initialized');
  } finally {
    client.release();
  }
}

// --- Subscribers ---
async function getSubscribers() {
  const { rows } = await pool.query('SELECT email, date FROM subscribers ORDER BY date DESC');
  return rows;
}

async function addSubscriber(email) {
  const { rows } = await pool.query(
    'INSERT INTO subscribers (email) VALUES ($1) ON CONFLICT (email) DO NOTHING RETURNING *',
    [email]
  );
  return { ok: true, already: rows.length === 0 };
}

async function deleteSubscriber(email) {
  await pool.query('DELETE FROM subscribers WHERE email = $1', [email]);
}

// --- Submissions ---
async function getSubmissions() {
  const { rows } = await pool.query(
    'SELECT id, tool_name AS "toolName", url, category, pricing, description, email, date, status FROM submissions ORDER BY date DESC'
  );
  return rows;
}

async function addSubmission(sub) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await pool.query(
    'INSERT INTO submissions (id, tool_name, url, category, pricing, description, email) VALUES ($1,$2,$3,$4,$5,$6,$7)',
    [id, sub.toolName, sub.url, sub.category || '', sub.pricing || '', sub.description, sub.email]
  );
  return { id };
}

async function updateSubmission(id, status) {
  const { rows } = await pool.query(
    'UPDATE submissions SET status = $1 WHERE id = $2 RETURNING id, tool_name AS "toolName", url, category, pricing, description, email, date, status',
    [status, id]
  );
  return rows[0];
}

async function deleteSubmission(id) {
  await pool.query('DELETE FROM submissions WHERE id = $1', [id]);
}

// --- Feedback ---
async function getFeedback() {
  const { rows } = await pool.query(
    'SELECT id, type, message, email, page, date, read FROM feedback ORDER BY date DESC'
  );
  return rows;
}

async function addFeedback(fb) {
  const id = Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  await pool.query(
    'INSERT INTO feedback (id, type, message, email, page) VALUES ($1,$2,$3,$4,$5)',
    [id, fb.type, fb.message, fb.email || '', fb.page || '']
  );
  return { id };
}

async function updateFeedback(id, read) {
  const { rows } = await pool.query(
    'UPDATE feedback SET read = $1 WHERE id = $2 RETURNING *',
    [read, id]
  );
  return rows[0];
}

async function deleteFeedback(id) {
  await pool.query('DELETE FROM feedback WHERE id = $1', [id]);
}

// --- Site Stats ---
async function trackEvent(type, extra) {
  const today = new Date().toISOString().split('T')[0];
  const colMap = { views: 'views', toolViews: 'tool_views', affiliateClicks: 'affiliate_clicks', compareViews: 'compare_views', searches: 'searches', blogViews: 'blog_views' };
  const col = colMap[type];
  if (!col) return;

  // Upsert daily; toolViews/blogViews also keep a per-slug counter in a JSONB column
  const jsonCol = { toolViews: 'top_tools', blogViews: 'top_posts' }[type];
  if (jsonCol && extra) {
    await pool.query(`
      INSERT INTO site_stats (date, ${col}, ${jsonCol})
      VALUES ($1, 1, $2::jsonb)
      ON CONFLICT (date) DO UPDATE SET
        ${col} = site_stats.${col} + 1,
        ${jsonCol} = (
          SELECT jsonb_set(
            COALESCE(site_stats.${jsonCol}, '{}'),
            $3::text[],
            to_jsonb(COALESCE((site_stats.${jsonCol}->>$4)::int, 0) + 1)
          )
        )
    `, [today, JSON.stringify({ [extra]: 1 }), [extra], extra]);
  } else {
    await pool.query(`
      INSERT INTO site_stats (date, ${col}) VALUES ($1, 1)
      ON CONFLICT (date) DO UPDATE SET ${col} = site_stats.${col} + 1
    `, [today]);
  }

  // Increment total
  await pool.query(`UPDATE site_stats_total SET ${col} = ${col} + 1 WHERE id = 1`);
}

async function getSiteStats() {
  const { rows: daily } = await pool.query(
    "SELECT * FROM site_stats WHERE date >= NOW() - INTERVAL '30 days' ORDER BY date DESC"
  );
  const { rows: [total] } = await pool.query('SELECT * FROM site_stats_total WHERE id = 1');

  const dailyMap = {};
  for (const row of daily) {
    const d = row.date.toISOString().split('T')[0];
    dailyMap[d] = {
      views: row.views,
      toolViews: row.tool_views,
      affiliateClicks: row.affiliate_clicks,
      compareViews: row.compare_views,
      searches: row.searches,
      blogViews: row.blog_views || 0,
      topTools: row.top_tools || {},
      topPosts: row.top_posts || {}
    };
  }

  return {
    daily: dailyMap,
    total: total ? {
      views: Number(total.views),
      toolViews: Number(total.tool_views),
      affiliateClicks: Number(total.affiliate_clicks),
      compareViews: Number(total.compare_views),
      searches: Number(total.searches),
      blogViews: Number(total.blog_views || 0)
    } : { views: 0, toolViews: 0, affiliateClicks: 0, compareViews: 0, searches: 0, blogViews: 0 }
  };
}

// --- AI Usage ---
async function logAiUsage(model, promptTokens, completionTokens, query) {
  const today = new Date().toISOString().split('T')[0];
  const entry = JSON.stringify({ q: query, model, tokens: promptTokens + completionTokens, time: new Date().toISOString() });

  await pool.query(`
    INSERT INTO ai_usage (date, requests, prompt_tokens, completion_tokens, total_tokens, queries)
    VALUES ($1, 1, $2, $3, $4, $5::jsonb)
    ON CONFLICT (date) DO UPDATE SET
      requests = ai_usage.requests + 1,
      prompt_tokens = ai_usage.prompt_tokens + $2,
      completion_tokens = ai_usage.completion_tokens + $3,
      total_tokens = ai_usage.total_tokens + $4,
      queries = CASE
        WHEN jsonb_array_length(ai_usage.queries) < 50
        THEN ai_usage.queries || $5::jsonb
        ELSE ai_usage.queries
      END
  `, [today, promptTokens, completionTokens, promptTokens + completionTokens, `[${entry}]`]);

  await pool.query(`
    UPDATE ai_usage_total SET
      requests = requests + 1,
      prompt_tokens = prompt_tokens + $1,
      completion_tokens = completion_tokens + $2,
      total_tokens = total_tokens + $3
    WHERE id = 1
  `, [promptTokens, completionTokens, promptTokens + completionTokens]);
}

async function getAiUsage() {
  const { rows: daily } = await pool.query(
    "SELECT * FROM ai_usage WHERE date >= NOW() - INTERVAL '30 days' ORDER BY date DESC"
  );
  const { rows: [total] } = await pool.query('SELECT * FROM ai_usage_total WHERE id = 1');

  const dailyMap = {};
  for (const row of daily) {
    const d = row.date.toISOString().split('T')[0];
    dailyMap[d] = {
      requests: row.requests,
      promptTokens: row.prompt_tokens,
      completionTokens: row.completion_tokens,
      totalTokens: row.total_tokens,
      queries: row.queries || []
    };
  }

  return {
    daily: dailyMap,
    total: total ? {
      requests: Number(total.requests),
      promptTokens: Number(total.prompt_tokens),
      completionTokens: Number(total.completion_tokens),
      totalTokens: Number(total.total_tokens)
    } : { requests: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0 }
  };
}

// --- Tool Clicks ---
async function incrementClicks(slug) {
  await pool.query(`
    INSERT INTO tool_clicks (slug, clicks) VALUES ($1, 1)
    ON CONFLICT (slug) DO UPDATE SET clicks = tool_clicks.clicks + 1
  `, [slug]);
}

async function getClicksMap() {
  const { rows } = await pool.query('SELECT slug, clicks FROM tool_clicks');
  const map = {};
  for (const row of rows) map[row.slug] = row.clicks;
  return map;
}

// --- Blog Posts ---
async function getBlogPosts({ page = 1, limit = 12, category, tag, q, status = 'published' } = {}) {
  let where = 'WHERE status = $1';
  const params = [status];
  let idx = 2;

  if (category) { where += ` AND category = $${idx++}`; params.push(category); }
  if (tag) { where += ` AND $${idx++} = ANY(tags)`; params.push(tag); }
  if (q) { where += ` AND (title ILIKE $${idx} OR excerpt ILIKE $${idx} OR meta_description ILIKE $${idx})`; params.push(`%${q}%`); idx++; }

  const countRes = await pool.query(`SELECT COUNT(*) FROM blog_posts ${where}`, params);
  const total = parseInt(countRes.rows[0].count);

  const offset = (page - 1) * limit;
  params.push(limit, offset);
  const { rows } = await pool.query(
    `SELECT id, slug, title, excerpt, meta_description, tags, category, featured_image, author, status, views, published_at, created_at
     FROM blog_posts ${where}
     ORDER BY published_at DESC
     LIMIT $${idx++} OFFSET $${idx++}`,
    params
  );

  return { posts: rows, total, page, totalPages: Math.ceil(total / limit) };
}

async function getBlogPost(slug) {
  const { rows } = await pool.query(
    'SELECT * FROM blog_posts WHERE slug = $1',
    [slug]
  );
  return rows[0] || null;
}

async function createBlogPost(post) {
  const { rows } = await pool.query(
    `INSERT INTO blog_posts (slug, title, excerpt, content, meta_description, tags, category, featured_image, author, status, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (slug) DO NOTHING
     RETURNING *`,
    [post.slug, post.title, post.excerpt, post.content, post.metaDescription,
     post.tags || [], post.category || 'ai-news', post.featuredImage || '',
     post.author || 'Omnilib', post.status || 'published',
     post.publishedAt || new Date()]
  );
  return rows[0] || null;
}

async function updateBlogPost(id, updates) {
  const fields = [];
  const params = [];
  let idx = 1;

  const allowed = ['title', 'slug', 'excerpt', 'content', 'meta_description', 'tags', 'category', 'featured_image', 'author', 'status'];
  const keyMap = { metaDescription: 'meta_description', featuredImage: 'featured_image' };

  for (const [key, val] of Object.entries(updates)) {
    const col = keyMap[key] || key;
    if (allowed.includes(col) && val !== undefined) {
      fields.push(`${col} = $${idx++}`);
      params.push(val);
    }
  }
  if (fields.length === 0) return null;

  fields.push(`updated_at = NOW()`);
  params.push(id);
  const { rows } = await pool.query(
    `UPDATE blog_posts SET ${fields.join(', ')} WHERE id = $${idx} RETURNING *`,
    params
  );
  return rows[0] || null;
}

async function deleteBlogPost(id) {
  await pool.query('DELETE FROM blog_posts WHERE id = $1', [id]);
}

async function incrementBlogViews(slug) {
  await pool.query('UPDATE blog_posts SET views = views + 1 WHERE slug = $1', [slug]);
}

async function getBlogStats() {
  const { rows: [totals] } = await pool.query(`
    SELECT COUNT(*)::int AS posts,
           COUNT(*) FILTER (WHERE status = 'published')::int AS published,
           COALESCE(SUM(views), 0)::bigint AS total_views
    FROM blog_posts
  `);

  const { rows: topPosts } = await pool.query(`
    SELECT slug, title, category, views, published_at
    FROM blog_posts
    WHERE status = 'published'
    ORDER BY views DESC, published_at DESC
    LIMIT 100
  `);

  const { rows: byCategory } = await pool.query(`
    SELECT category, COUNT(*)::int AS posts, COALESCE(SUM(views), 0)::bigint AS views
    FROM blog_posts
    WHERE status = 'published'
    GROUP BY category
    ORDER BY views DESC
  `);

  const { rows: daily } = await pool.query(
    "SELECT date, blog_views, top_posts FROM site_stats WHERE date >= NOW() - INTERVAL '90 days' ORDER BY date DESC"
  );
  const dailyMap = {};
  for (const row of daily) {
    const d = row.date.toISOString().split('T')[0];
    dailyMap[d] = { blogViews: row.blog_views || 0, topPosts: row.top_posts || {} };
  }

  return {
    totals: {
      posts: totals.posts,
      published: totals.published,
      totalViews: Number(totals.total_views)
    },
    topPosts,
    byCategory: byCategory.map(c => ({ category: c.category, posts: c.posts, views: Number(c.views) })),
    daily: dailyMap
  };
}

async function getRecentBlogSlugs(limit = 50) {
  const { rows } = await pool.query(
    "SELECT slug FROM blog_posts WHERE status = 'published' ORDER BY published_at DESC LIMIT $1",
    [limit]
  );
  return rows.map(r => r.slug);
}

module.exports = {
  pool,
  initDB,
  getSubscribers,
  addSubscriber,
  deleteSubscriber,
  getSubmissions,
  addSubmission,
  updateSubmission,
  deleteSubmission,
  getFeedback,
  addFeedback,
  updateFeedback,
  deleteFeedback,
  trackEvent,
  getSiteStats,
  logAiUsage,
  getAiUsage,
  incrementClicks,
  getClicksMap,
  getBlogPosts,
  getBlogPost,
  createBlogPost,
  updateBlogPost,
  deleteBlogPost,
  incrementBlogViews,
  getBlogStats,
  getRecentBlogSlugs
};
