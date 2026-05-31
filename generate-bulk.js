/**
 * Bulk Blog Generator
 *
 * Generates ~1000 posts backdated across the last 7 weeks.
 * Run: node generate-bulk.js
 * Or trigger via: POST /api/admin/generate-bulk
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
  max: 3
});

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;

// --- AI/Tech topics by week for variety ---
const WEEKLY_THEMES = [
  // Week 1 (7 weeks ago): mid-April 2026
  ['AI model benchmarks', 'open source LLMs', 'AI video generation', 'prompt engineering tips', 'AI startups funding', 'machine learning ops', 'AI in healthcare', 'chatbot comparisons', 'AI image editing tools', 'AI code review'],
  // Week 2
  ['AI agents frameworks', 'RAG systems', 'AI music generation', 'deepfake detection', 'AI customer support', 'vector databases', 'AI in education', 'text to speech AI', 'AI data analytics', 'AI writing assistants'],
  // Week 3
  ['multimodal AI models', 'AI robotics', 'AI chip design', 'AI for developers', 'enterprise AI adoption', 'AI ethics regulation', 'AI search engines', 'AI translation tools', 'AI presentation makers', 'fine tuning LLMs'],
  // Week 4
  ['AI workflow automation', 'AI voice cloning', 'AI cybersecurity', 'AI in finance', 'AI personal assistants', 'AI art generators', 'computer vision tools', 'AI meeting assistants', 'AI resume builders', 'AI API platforms'],
  // Week 5
  ['AI browser extensions', 'AI document analysis', 'AI for marketing', 'AI scheduling tools', 'AI transcription', 'AI photo enhancement', 'AI spreadsheet tools', 'AI email writers', 'AI legal tools', 'AI design tools'],
  // Week 6
  ['AI model compression', 'AI on device', 'AI for sales', 'AI project management', 'AI noise cancellation', 'AI background removal', 'AI logo generators', 'AI database tools', 'AI testing tools', 'AI note taking'],
  // Week 7 (last week)
  ['AI coding assistants 2026', 'AI content moderation', 'AI supply chain', 'AI real estate', 'AI language learning', 'AI fitness apps', 'AI recipe generators', 'AI social media tools', 'AI SEO tools', 'AI podcast tools'],
];

function slugify(text) {
  return text.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 80);
}

async function callOpenAI(messages, opts = {}) {
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${OPENAI_KEY}` },
    body: JSON.stringify({
      model: opts.model || 'gpt-4.1-nano',
      messages,
      max_tokens: opts.maxTokens || 3000,
      temperature: opts.temperature || 0.8
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}: ${(await res.text()).slice(0, 100)}`);
  const data = await res.json();
  return data.choices[0].message.content;
}

async function findImage(query) {
  if (!PEXELS_KEY) return '';
  try {
    const res = await fetch(
      `https://api.pexels.com/v1/search?query=${encodeURIComponent(query)}&per_page=5&orientation=landscape`,
      { headers: { Authorization: PEXELS_KEY } }
    );
    if (!res.ok) return '';
    const data = await res.json();
    if (data.photos?.length > 0) {
      const photo = data.photos[Math.floor(Math.random() * data.photos.length)];
      return photo.src.landscape || photo.src.large;
    }
  } catch {}
  return '';
}

async function generateBatch(topics, targetDate) {
  const dateStr = targetDate.toISOString().split('T')[0];
  const categories = ['ai-news', 'tool-launches', 'tutorials', 'industry', 'research'];

  const prompt = `Generate ${topics.length} blog posts for Omnilib (omnilib.app), an AI tools directory.
Date: ${dateStr}

Topics (one post each):
${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

For EACH topic, return a JSON object with:
- "title": SEO headline 50-70 chars
- "excerpt": 150 chars conversational summary
- "metaDescription": 150 chars keyword-rich meta desc
- "content": 600-900 words HTML (h2, h3, p, ul, strong, em, blockquote — NO h1). Write like a tech journalist. Include hooks, opinions, practical insights. Mention Omnilib once naturally.
- "tags": 4-5 lowercase tags
- "category": one of ${categories.join(', ')}
- "imageQuery": 2-4 word photo search for this specific topic

Return a JSON array of ${topics.length} objects. Raw JSON only, no fences.`;

  const content = await callOpenAI([
    { role: 'system', content: 'You are a senior tech journalist. Write engaging, SEO-optimized blog posts. Return only valid JSON arrays.' },
    { role: 'user', content: prompt }
  ], { model: 'gpt-4.1-mini', maxTokens: 15000, temperature: 0.8 });

  try {
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch {
    console.log('  Failed to parse batch, trying individual...');
    return null;
  }
}

async function savePost(post, date) {
  const slug = slugify(post.title) + '-' + date.toISOString().split('T')[0].replace(/-/g, '');
  try {
    const { rows } = await pool.query(
      `INSERT INTO blog_posts (slug, title, excerpt, content, meta_description, tags, category, featured_image, author, status, published_at, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$11)
       ON CONFLICT (slug) DO NOTHING RETURNING id`,
      [slug, post.title, post.excerpt, post.content, post.metaDescription,
       post.tags || [], post.category || 'ai-news', post.image || '',
       'Omnilib', 'published', date.toISOString()]
    );
    return rows.length > 0;
  } catch {
    return false;
  }
}

async function main() {
  console.log(`\n[${new Date().toISOString()}] Bulk blog generation started`);
  console.log('Target: ~1000 posts across 7 weeks\n');

  const now = new Date();
  let totalSaved = 0;
  let totalAttempted = 0;

  for (let week = 0; week < 7; week++) {
    const themes = WEEKLY_THEMES[week];
    console.log(`\n=== Week ${week + 1} (${7 - week} weeks ago) ===`);

    // Generate ~20 posts per day, 7 days per week = 140 per week
    for (let day = 0; day < 7; day++) {
      const daysAgo = (6 - week) * 7 + (6 - day);
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() - daysAgo);
      // Random hour between 6am-11pm
      targetDate.setHours(6 + Math.floor(Math.random() * 17), Math.floor(Math.random() * 60));

      const dateStr = targetDate.toISOString().split('T')[0];

      // Pick 4 topics for this day from the week's themes + variations
      const dayTopics = [];
      for (let b = 0; b < 4; b++) {
        const theme = themes[(day * 4 + b) % themes.length];
        const variations = [
          theme,
          `latest ${theme} trends 2026`,
          `best ${theme} tools compared`,
          `how ${theme} is changing the industry`,
          `${theme} guide for beginners`,
        ];
        dayTopics.push(variations[b % variations.length]);
      }

      console.log(`  ${dateStr}: generating ${dayTopics.length} posts...`);
      totalAttempted += dayTopics.length;

      try {
        const posts = await generateBatch(dayTopics, targetDate);
        if (!posts || !Array.isArray(posts)) {
          console.log(`    Batch failed, skipping day`);
          continue;
        }

        for (let i = 0; i < posts.length; i++) {
          const post = posts[i];
          // Stagger timestamps through the day
          const postDate = new Date(targetDate);
          postDate.setHours(6 + i * 4 + Math.floor(Math.random() * 3), Math.floor(Math.random() * 60));

          // Find image
          const image = await findImage(post.imageQuery || post.title);
          post.image = image;

          const saved = await savePost(post, postDate);
          if (saved) totalSaved++;

          // Small delay to avoid rate limits
          await new Promise(r => setTimeout(r, 500));
        }

        console.log(`    Saved ${posts.length} posts`);
      } catch (err) {
        console.log(`    Error: ${err.message}`);
      }

      // Delay between days to avoid rate limits
      await new Promise(r => setTimeout(r, 2000));
    }
  }

  console.log(`\n=== DONE ===`);
  console.log(`Saved: ${totalSaved}/${totalAttempted} posts`);
  console.log(`Total time: check Railway logs\n`);
}

module.exports = { main };

if (require.main === module) {
  if (!process.env.DATABASE_URL || !process.env.OPENAI_API_KEY) {
    console.error('Missing DATABASE_URL or OPENAI_API_KEY');
    process.exit(1);
  }
  main()
    .then(() => pool.end())
    .catch(err => { console.error(err); process.exit(1); });
}
