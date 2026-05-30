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
  const colMap = { views: 'views', toolViews: 'tool_views', affiliateClicks: 'affiliate_clicks', compareViews: 'compare_views', searches: 'searches' };
  const col = colMap[type];
  if (!col) return;

  // Upsert daily
  if (type === 'toolViews' && extra) {
    await pool.query(`
      INSERT INTO site_stats (date, ${col}, top_tools)
      VALUES ($1, 1, $2::jsonb)
      ON CONFLICT (date) DO UPDATE SET
        ${col} = site_stats.${col} + 1,
        top_tools = (
          SELECT jsonb_set(
            COALESCE(site_stats.top_tools, '{}'),
            $3::text[],
            to_jsonb(COALESCE((site_stats.top_tools->>$4)::int, 0) + 1)
          )
        )
    `, [today, JSON.stringify({ [extra]: 1 }), `{${extra}}`, extra]);
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
      topTools: row.top_tools || {}
    };
  }

  return {
    daily: dailyMap,
    total: total ? {
      views: Number(total.views),
      toolViews: Number(total.tool_views),
      affiliateClicks: Number(total.affiliate_clicks),
      compareViews: Number(total.compare_views),
      searches: Number(total.searches)
    } : { views: 0, toolViews: 0, affiliateClicks: 0, compareViews: 0, searches: 0 }
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
  getClicksMap
};
