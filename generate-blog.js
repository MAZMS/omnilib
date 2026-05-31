/**
 * Blog Auto-Generator
 *
 * Runs daily at midnight. Fetches latest AI/tech news headlines,
 * then uses OpenAI to write SEO-optimized blog posts.
 *
 * Usage:  node scripts/generate-blog.js
 * Env:    DATABASE_URL, OPENAI_API_KEY
 */

const { Pool } = require('pg');

let pool;

function getPool() {
  if (pool) return pool;
  const DATABASE_URL = process.env.DATABASE_URL;
  if (!DATABASE_URL) throw new Error('Missing DATABASE_URL');
  pool = new Pool({
    connectionString: DATABASE_URL,
    ssl: DATABASE_URL.includes('railway') ? { rejectUnauthorized: false } : false,
    max: 3
  });
  return pool;
}

// --- Helpers ---

function slugify(text) {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 80);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function callOpenAI(messages, { model = 'gpt-4.1-mini', maxTokens = 4000, temperature = 0.7 } = {}) {
  const OPENAI_KEY = process.env.OPENAI_API_KEY;
  if (!OPENAI_KEY) throw new Error('Missing OPENAI_API_KEY');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature })
  });
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`OpenAI API error ${res.status}: ${err}`);
  }
  const data = await res.json();
  return data.choices[0].message.content;
}

// --- Step 1: Generate trending AI/tech topic ideas ---

async function generateTopicIdeas() {
  const today = todayStr();

  // Get existing slugs to avoid duplicates
  const { rows } = await getPool().query(
    "SELECT slug FROM blog_posts WHERE published_at > NOW() - INTERVAL '7 days'"
  );
  const recentSlugs = rows.map(r => r.slug);

  const prompt = `You are an AI/tech news editor for Omnilib (omnilib.app), an AI tools directory.
Today is ${today}. Generate exactly 3 blog post ideas about the latest happenings in AI and tech.

Focus on:
- Major AI model releases, updates, or breakthroughs
- New AI tool launches or major feature updates
- AI industry news (funding, acquisitions, partnerships)
- AI regulation, policy, or ethics developments
- Practical AI tips, workflows, or comparisons
- Emerging AI trends and their impact

${recentSlugs.length > 0 ? `AVOID topics similar to these recent posts: ${recentSlugs.join(', ')}` : ''}

Return ONLY a JSON array with 3 objects, each having:
- "title": compelling, SEO-optimized headline (50-70 chars)
- "category": one of "ai-news", "tool-launches", "tutorials", "industry", "research"
- "angle": 1-sentence description of the unique angle
- "keywords": array of 3-5 SEO keywords

Return raw JSON only, no markdown fences.`;

  const content = await callOpenAI([
    { role: 'system', content: 'You are an AI/tech news editor. Return only valid JSON.' },
    { role: 'user', content: prompt }
  ], { temperature: 0.9 });

  try {
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    console.error('Failed to parse topic ideas:', content);
    return [];
  }
}

// --- Step 2: Write a full blog post ---

async function writePost(topic) {
  const today = todayStr();

  const prompt = `Write a blog post for Omnilib (omnilib.app), an AI tools directory.

TOPIC: ${topic.title}
ANGLE: ${topic.angle}
CATEGORY: ${topic.category}
DATE: ${today}
KEYWORDS: ${topic.keywords.join(', ')}

REQUIREMENTS:
1. Write 800-1200 words of high-quality, informative content
2. Use HTML formatting (h2, h3, p, ul, li, strong, em, blockquote)
3. DO NOT use h1 (the page template handles that)
4. Include 3-5 subheadings (h2) that contain keywords naturally
5. Write a compelling opening paragraph that hooks the reader
6. Include practical insights, not just news regurgitation
7. End with a forward-looking conclusion or actionable takeaway
8. Where relevant, mention that readers can find related AI tools on Omnilib
9. Write in a professional but accessible tone — authoritative, not stuffy
10. Naturally incorporate the keywords throughout

SEO OPTIMIZATION:
- Front-load important keywords in headings
- Use semantic HTML structure
- Write for featured snippets (clear definitions, numbered lists)
- Include internal context that AI crawlers can parse

Return ONLY a JSON object with:
- "title": the final SEO-optimized title (may refine the input)
- "excerpt": 150-160 char summary for cards and meta descriptions
- "metaDescription": 150-160 char meta description (different from excerpt, keyword-rich)
- "content": the full HTML content
- "tags": array of 4-6 relevant tags (lowercase)
- "category": "${topic.category}"

Return raw JSON only, no markdown fences.`;

  const content = await callOpenAI([
    { role: 'system', content: 'You are an expert SEO content writer specializing in AI and technology. Write factual, engaging content. Return only valid JSON.' },
    { role: 'user', content: prompt }
  ], { model: 'gpt-4.1-mini', maxTokens: 4000, temperature: 0.7 });

  try {
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    console.error('Failed to parse blog post:', content.slice(0, 200));
    return null;
  }
}

// --- Step 3: Save to database ---

async function savePost(post) {
  const slug = slugify(post.title) + '-' + todayStr().replace(/-/g, '');

  const { rows } = await getPool().query(
    `INSERT INTO blog_posts (slug, title, excerpt, content, meta_description, tags, category, author, status, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,NOW())
     ON CONFLICT (slug) DO NOTHING
     RETURNING id, slug`,
    [slug, post.title, post.excerpt, post.content, post.metaDescription,
     post.tags || [], post.category || 'ai-news', 'Omnilib', 'published']
  );

  if (rows.length === 0) {
    console.log(`  Skipped (duplicate slug): ${slug}`);
    return null;
  }

  console.log(`  Saved: /blog/${slug}`);
  return rows[0];
}

// --- Main ---

async function generateBlog() {
  console.log(`[${new Date().toISOString()}] Blog generation started`);

  // Step 1: Get topic ideas
  console.log('Generating topic ideas...');
  const topics = await generateTopicIdeas();
  if (!topics || topics.length === 0) {
    console.error('No topics generated');
    return 0;
  }
  console.log(`Got ${topics.length} topic ideas`);

  // Step 2 & 3: Write and save each post
  let saved = 0;
  for (const topic of topics) {
    console.log(`\nWriting: ${topic.title}`);
    const post = await writePost(topic);
    if (!post) {
      console.log('  Failed to generate post, skipping');
      continue;
    }

    const result = await savePost(post);
    if (result) saved++;

    // Small delay between API calls
    await new Promise(r => setTimeout(r, 1000));
  }

  console.log(`\nDone! ${saved}/${topics.length} posts published.`);
  return saved;
}

// Export for use by server.js cron
module.exports = { generateBlog };

// Run standalone if called directly
if (require.main === module) {
  if (!process.env.DATABASE_URL || !process.env.OPENAI_API_KEY) {
    console.error('Missing DATABASE_URL or OPENAI_API_KEY');
    process.exit(1);
  }
  generateBlog()
    .then(() => getPool().end())
    .catch(err => { console.error(err); process.exit(1); });
}
