/**
 * Blog Auto-Generator v2
 *
 * 1. Fetches REAL latest AI/tech news from RSS feeds
 * 2. Uses OpenAI to write engaging, SEO-optimized posts based on real stories
 * 3. Assigns high-quality featured images
 * 4. Saves to PostgreSQL
 *
 * Usage:  node generate-blog.js
 * Env:    DATABASE_URL, OPENAI_API_KEY
 */

const { Pool } = require('pg');

let pool;
function getPool() {
  if (pool) return pool;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('Missing DATABASE_URL');
  pool = new Pool({
    connectionString: url,
    ssl: url.includes('railway') ? { rejectUnauthorized: false } : false,
    max: 3
  });
  return pool;
}

// --- Find relevant image via Pexels ---

async function findImage(query) {
  const key = process.env.PEXELS_API_KEY;
  if (!key) {
    console.log('  No PEXELS_API_KEY, skipping image');
    return '';
  }

  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: key } }
    );
    if (!res.ok) throw new Error(`Pexels ${res.status}`);

    const data = await res.json();
    if (data.photos?.length > 0) {
      const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
      console.log(`  Pexels: "${photo.alt || query}" by ${photo.photographer}`);
      return photo.src.landscape || photo.src.large;
    }

    // Broaden search if no results
    const simpler = query.split(' ').slice(0, 2).join(' ');
    const res2 = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(simpler)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: key } }
    );
    if (res2.ok) {
      const data2 = await res2.json();
      if (data2.photos?.length > 0) {
        const photo = data2.photos[Math.floor(Math.random() * data2.photos.length)];
        console.log(`  Pexels (broad): "${photo.alt || simpler}" by ${photo.photographer}`);
        return photo.src.landscape || photo.src.large;
      }
    }
  } catch (err) {
    console.log(`  Pexels failed: ${err.message}`);
  }

  console.log(`  No image found for "${query}"`);
  return '';
}

// --- RSS News Fetching ---

const RSS_FEEDS = [
  { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', name: 'TechCrunch' },
  { url: 'https://www.theverge.com/rss/ai-artificial-intelligence/index.xml', name: 'The Verge' },
  { url: 'https://venturebeat.com/category/ai/feed/', name: 'VentureBeat' },
  { url: 'https://feeds.arstechnica.com/arstechnica/technology-lab', name: 'Ars Technica' },
  { url: 'https://www.wired.com/feed/tag/ai/latest/rss', name: 'Wired' },
];

function parseRSSItems(xml, source) {
  const items = [];
  const itemRegex = /<item[\s>]([\s\S]*?)<\/item>/gi;
  let match;
  while ((match = itemRegex.exec(xml)) !== null) {
    const block = match[1];
    const title = (block.match(/<title><!\[CDATA\[(.*?)\]\]><\/title>/) ||
                   block.match(/<title>(.*?)<\/title>/) || [])[1] || '';
    const desc = (block.match(/<description><!\[CDATA\[([\s\S]*?)\]\]><\/description>/) ||
                  block.match(/<description>([\s\S]*?)<\/description>/) || [])[1] || '';
    const pubDate = (block.match(/<pubDate>(.*?)<\/pubDate>/) || [])[1] || '';
    const link = (block.match(/<link>(.*?)<\/link>/) ||
                  block.match(/<link[^>]*href="([^"]*)"/) || [])[1] || '';

    if (title) {
      items.push({
        title: title.replace(/<[^>]+>/g, '').trim(),
        description: desc.replace(/<[^>]+>/g, '').trim().slice(0, 500),
        source,
        pubDate,
        link
      });
    }
  }
  return items;
}

async function fetchRealNews() {
  console.log('Fetching real news from RSS feeds...');
  const allItems = [];

  const results = await Promise.allSettled(
    RSS_FEEDS.map(async (feed) => {
      try {
        const controller = new AbortController();
        const timeout = setTimeout(() => controller.abort(), 10000);
        const res = await fetch(feed.url, {
          signal: controller.signal,
          headers: { 'User-Agent': 'Omnilib/1.0 (https://omnilib.app) RSS Reader' }
        });
        clearTimeout(timeout);
        if (!res.ok) return [];
        const xml = await res.text();
        return parseRSSItems(xml, feed.name);
      } catch {
        console.log(`  Failed to fetch ${feed.name}, skipping`);
        return [];
      }
    })
  );

  for (const result of results) {
    if (result.status === 'fulfilled') {
      allItems.push(...result.value);
    }
  }

  // Sort by date (newest first), take top 20
  allItems.sort((a, b) => {
    const da = a.pubDate ? new Date(a.pubDate).getTime() : 0;
    const db = b.pubDate ? new Date(b.pubDate).getTime() : 0;
    return db - da;
  });

  console.log(`  Found ${allItems.length} total news items`);
  return allItems.slice(0, 25);
}

// --- Helpers ---

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

function todayStr() {
  return new Date().toISOString().split('T')[0];
}

async function callOpenAI(messages, { model = 'gpt-4.1-mini', maxTokens = 4000, temperature = 0.7 } = {}) {
  const key = process.env.OPENAI_API_KEY;
  if (!key) throw new Error('Missing OPENAI_API_KEY');
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
    body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${await res.text()}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

// --- Step 1: Pick topics from real news ---

async function pickTopics(newsItems) {
  const today = todayStr();

  // Get recent posts to avoid duplicates
  const { rows } = await getPool().query(
    "SELECT slug, title FROM blog_posts WHERE published_at > NOW() - INTERVAL '7 days'"
  );
  const recentTitles = rows.map(r => r.title);

  const newsSummary = newsItems.map((n, i) =>
    `[${i + 1}] "${n.title}" — ${n.source}${n.description ? '\n    ' + n.description.slice(0, 200) : ''}`
  ).join('\n');

  const prompt = `You are an AI/tech news editor for Omnilib (omnilib.app), a curated directory of AI tools.
Today is ${today}.

Here are the LATEST real news headlines from top tech outlets:

${newsSummary}

${recentTitles.length > 0 ? `\nAVOID topics similar to these recent posts:\n${recentTitles.map(t => '- ' + t).join('\n')}` : ''}

Pick the 3 MOST interesting and impactful stories from the news above. For each, create a blog post angle that:
- Ties into the real news but adds analysis, context, and practical takeaways
- Would interest people who use AI tools in their work
- Has a compelling, click-worthy headline

Return ONLY a JSON array with 3 objects:
- "title": engaging headline, 50-70 chars, front-loaded keywords
- "category": one of "ai-news", "tool-launches", "tutorials", "industry", "research"
- "sourceHeadlines": array of 1-3 source headline numbers you're drawing from
- "angle": 2-sentence pitch for how you'll cover this
- "keywords": array of 4-5 SEO keywords

Raw JSON only, no fences.`;

  const content = await callOpenAI([
    { role: 'system', content: 'You are a sharp AI/tech news editor. Pick the most newsworthy stories. Return only valid JSON.' },
    { role: 'user', content: prompt }
  ], { temperature: 0.8 });

  try {
    const topics = JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
    // Attach the source news context to each topic
    for (const topic of topics) {
      topic.sourceContext = (topic.sourceHeadlines || [])
        .map(i => newsItems[i - 1])
        .filter(Boolean)
        .map(n => `"${n.title}" (${n.source}): ${n.description}`)
        .join('\n\n');
    }
    return topics;
  } catch {
    console.error('Failed to parse topics:', content.slice(0, 300));
    return [];
  }
}

// --- Step 2: Write engaging post based on real news ---

async function writePost(topic) {
  const today = todayStr();

  const prompt = `Write a blog post for Omnilib (omnilib.app), an AI tools directory.

HEADLINE: ${topic.title}
ANGLE: ${topic.angle}
CATEGORY: ${topic.category}
DATE: ${today}
SEO KEYWORDS: ${topic.keywords.join(', ')}

REAL NEWS CONTEXT (base your article on these real stories):
${topic.sourceContext || 'No specific source — write based on current trends.'}

WRITING STYLE:
- Write like a senior tech journalist, not a content mill
- Open with a HOOK — a surprising stat, bold claim, or vivid scene
- Be opinionated. Take a stance. Say what matters and why
- Use short paragraphs (2-3 sentences max). Break up walls of text
- Include at least one blockquote with a key insight or notable quote
- Add a "What This Means for You" or "The Bottom Line" section
- Reference specific tools, companies, and numbers when possible
- End with a forward-looking take, not a generic summary
- Naturally mention Omnilib as a resource for discovering related AI tools (1-2x max, don't force it)

FORMAT:
- 900-1400 words, HTML only (h2, h3, p, ul, ol, li, strong, em, blockquote, a)
- NO h1 tags (page template handles it)
- 4-6 subheadings (h2) with keywords front-loaded
- Use <strong> to highlight key terms and stats
- Include 1-2 relevant internal links like <a href="/">more on our blog</a> or <a href="/tools">our AI tools directory</a>

SEO:
- Front-load primary keyword in first paragraph
- Use keywords in at least 2 subheadings
- Write one list section (numbered or bulleted) for featured snippets
- Meta description should be a different take than the excerpt

Return ONLY a JSON object:
{
  "title": "final headline (may refine input)",
  "excerpt": "150-160 char card summary — conversational, intriguing",
  "metaDescription": "150-160 char meta desc — keyword-rich, different from excerpt",
  "content": "full HTML content",
  "tags": ["4-6 lowercase tags"],
  "category": "${topic.category}",
  "imageQuery": "2-4 word photo search query that visually represents this specific article (e.g. 'server room data center', 'developer coding laptop', 'AI robot handshake', 'semiconductor chip closeup')"
}

Raw JSON only, no fences.`;

  const content = await callOpenAI([
    { role: 'system', content: 'You are a top-tier tech journalist who writes engaging, well-researched articles. You write with authority and personality. Your articles are SEO-optimized but never feel like SEO content. Return only valid JSON.' },
    { role: 'user', content: prompt }
  ], { model: 'gpt-4.1-mini', maxTokens: 5000, temperature: 0.75 });

  try {
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    console.error('Failed to parse blog post:', content.slice(0, 300));
    return null;
  }
}

// --- Step 3: Save to database ---

async function savePost(post, image) {
  const slug = slugify(post.title) + '-' + todayStr().replace(/-/g, '');

  const { rows } = await getPool().query(
    `INSERT INTO blog_posts (slug, title, excerpt, content, meta_description, tags, category, featured_image, author, status, published_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
     ON CONFLICT (slug) DO NOTHING
     RETURNING id, slug`,
    [slug, post.title, post.excerpt, post.content, post.metaDescription,
     post.tags || [], post.category || 'ai-news', image || '',
     'Omnilib', 'published']
  );

  if (rows.length === 0) {
    console.log(`  Skipped (duplicate slug): ${slug}`);
    return null;
  }

  console.log(`  Published: /blog/${slug}`);
  return rows[0];
}

// --- Main ---

async function generateBlog() {
  console.log(`\n[${new Date().toISOString()}] Blog generation v2 started`);

  // Step 1: Fetch real news
  const news = await fetchRealNews();
  if (news.length === 0) {
    console.log('No news items found, aborting');
    return 0;
  }

  // Step 2: Pick the best topics from real news
  console.log('\nPicking best topics from real news...');
  const topics = await pickTopics(news);
  if (!topics || topics.length === 0) {
    console.error('No topics selected');
    return 0;
  }
  console.log(`Selected ${topics.length} topics`);

  // Step 3: Write and save each post
  let saved = 0;
  for (const topic of topics) {
    console.log(`\nWriting: "${topic.title}"`);
    console.log(`  Category: ${topic.category}`);
    const post = await writePost(topic);
    if (!post) {
      console.log('  Failed to generate, skipping');
      continue;
    }

    const imageQuery = post.imageQuery || topic.title;
    console.log(`  Finding image: "${imageQuery}"`);
    const image = await findImage(imageQuery);
    const result = await savePost(post, image);
    if (result) saved++;

    await new Promise(r => setTimeout(r, 1500));
  }

  console.log(`\nDone! ${saved}/${topics.length} posts published.\n`);
  return saved;
}

module.exports = { generateBlog };

if (require.main === module) {
  if (!process.env.DATABASE_URL || !process.env.OPENAI_API_KEY) {
    console.error('Missing DATABASE_URL or OPENAI_API_KEY');
    process.exit(1);
  }
  generateBlog()
    .then(() => getPool().end())
    .catch(err => { console.error(err); process.exit(1); });
}
