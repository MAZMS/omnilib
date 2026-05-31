/**
 * Bulk Blog Generator v2 — targets 1000 posts
 * Generates ~20 posts/day across 7 weeks = ~980 posts
 * Run via: POST /api/admin/generate-bulk
 */

const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_URL?.includes('railway') ? { rejectUnauthorized: false } : false,
  max: 3
});

const OPENAI_KEY = process.env.OPENAI_API_KEY;
const PEXELS_KEY = process.env.PEXELS_API_KEY;

const TOPICS = [
  // AI Tools & Products
  'AI writing assistants', 'AI code generators', 'AI image generators', 'AI video editors', 'AI music composers',
  'AI chatbots comparison', 'AI presentation makers', 'AI spreadsheet tools', 'AI email assistants', 'AI resume builders',
  'AI logo designers', 'AI voice generators', 'AI transcription services', 'AI meeting assistants', 'AI note-taking apps',
  'AI photo editors', 'AI background removers', 'AI upscalers', 'AI avatar generators', 'AI animation tools',
  // AI Industry
  'AI startup funding news', 'AI acquisitions 2026', 'AI company valuations', 'AI job market trends', 'AI salaries 2026',
  'enterprise AI adoption', 'small business AI tools', 'AI for freelancers', 'AI consulting market', 'AI SaaS growth',
  'open source AI models', 'AI API pricing trends', 'AI compute costs', 'GPU shortage impact', 'AI cloud platforms',
  // AI Technology
  'large language models explained', 'multimodal AI advances', 'AI agents architecture', 'RAG systems guide',
  'vector databases compared', 'AI fine-tuning methods', 'prompt engineering tips', 'AI model benchmarks 2026',
  'AI inference optimization', 'AI on-device processing', 'edge AI deployment', 'AI model compression',
  'transformer architecture updates', 'AI training data quality', 'synthetic data generation',
  // AI Applications
  'AI in healthcare diagnostics', 'AI in legal research', 'AI in education', 'AI in real estate',
  'AI in customer support', 'AI in supply chain', 'AI in cybersecurity', 'AI in finance trading',
  'AI in content moderation', 'AI in recruitment', 'AI in agriculture', 'AI in manufacturing',
  'AI in drug discovery', 'AI in climate research', 'AI in gaming',
  // AI Ethics & Policy
  'AI regulation updates', 'AI copyright law', 'AI bias detection', 'deepfake legislation',
  'AI transparency requirements', 'EU AI Act impact', 'AI watermarking standards', 'AI in elections',
  'AI worker displacement', 'responsible AI development', 'AI safety research', 'AI alignment progress',
  // Tutorials & How-tos
  'build AI chatbot guide', 'AI workflow automation setup', 'integrate AI into apps', 'AI API tutorial',
  'no-code AI tools guide', 'AI for content marketing', 'AI SEO strategy', 'AI social media management',
  'automate tasks with AI', 'AI data analysis beginner', 'AI podcast production', 'AI website builders',
  // Comparisons & Reviews
  'ChatGPT vs Claude comparison', 'Midjourney vs DALL-E', 'GitHub Copilot vs Cursor', 'Notion AI vs Coda AI',
  'Jasper vs Copy.ai review', 'Descript vs Runway comparison', 'Perplexity vs Google AI', 'Grammarly vs ProWritingAid AI',
  'Canva AI vs Adobe Firefly', 'Synthesia vs HeyGen review',
  // Trends & Predictions
  'AI trends to watch 2026', 'future of AI assistants', 'AI and remote work evolution', 'AI-powered search future',
  'autonomous AI agents outlook', 'AI hardware roadmap', 'AI in mobile apps trend', 'voice AI revolution',
  'AI personalization future', 'AI and creativity debate',
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
      temperature: opts.temperature || 0.85
    })
  });
  if (!res.ok) throw new Error(`OpenAI ${res.status}`);
  return (await res.json()).choices[0].message.content;
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

async function generateBatch(topics, dateStr) {
  const categories = ['ai-news', 'tool-launches', 'tutorials', 'industry', 'research'];
  const prompt = `Generate ${topics.length} unique blog posts for Omnilib (omnilib.app), an AI tools directory. Date: ${dateStr}.

Topics:
${topics.map((t, i) => `${i + 1}. ${t}`).join('\n')}

For EACH, return a JSON object:
- "title": unique SEO headline 50-70 chars (MUST be different from other posts)
- "excerpt": 140-155 char summary
- "metaDescription": 140-155 char meta desc (keyword-rich)
- "content": 600-800 words HTML (h2, h3, p, ul, strong, em, blockquote — NO h1). Journalist style, practical insights, engaging.
- "tags": 4-5 lowercase tags
- "category": one of ${categories.join(', ')}
- "imageQuery": 2-3 word photo search query

Return JSON array of ${topics.length} objects. Raw JSON only.`;

  const content = await callOpenAI([
    { role: 'system', content: 'Senior tech journalist. Write unique, engaging, SEO-optimized posts. Return valid JSON array only.' },
    { role: 'user', content: prompt }
  ], { model: 'gpt-4.1-mini', maxTokens: 16000, temperature: 0.9 });

  try {
    return JSON.parse(content.replace(/```json?\n?/g, '').replace(/```/g, '').trim());
  } catch { return null; }
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
  } catch { return false; }
}

async function getExistingCount() {
  const { rows } = await pool.query("SELECT COUNT(*) FROM blog_posts WHERE status = 'published'");
  return parseInt(rows[0].count);
}

async function main() {
  const TARGET = 1000;
  let existing = await getExistingCount();
  console.log(`\n[${new Date().toISOString()}] Bulk generation v2`);
  console.log(`Existing: ${existing} posts. Target: ${TARGET}. Need: ${Math.max(0, TARGET - existing)}\n`);

  if (existing >= TARGET) {
    console.log('Already at target!');
    return;
  }

  const now = new Date();
  let totalSaved = 0;
  let topicIdx = 0;

  // 7 weeks, 7 days each = 49 days
  for (let week = 0; week < 7; week++) {
    console.log(`\n=== Week ${week + 1} (${7 - week} weeks ago) ===`);

    for (let day = 0; day < 7; day++) {
      existing = await getExistingCount();
      if (existing >= TARGET) {
        console.log(`\nReached ${TARGET}! Stopping.`);
        console.log(`Total new posts saved: ${totalSaved}`);
        return;
      }

      const daysAgo = (6 - week) * 7 + (6 - day);
      const targetDate = new Date(now);
      targetDate.setDate(targetDate.getDate() - daysAgo);
      const dateStr = targetDate.toISOString().split('T')[0];

      // 5 batches of 4 posts = 20 posts per day
      for (let batch = 0; batch < 5; batch++) {
        existing = await getExistingCount();
        if (existing >= TARGET) break;

        // Pick 4 unique topics with variations
        const batchTopics = [];
        for (let i = 0; i < 4; i++) {
          const baseTopic = TOPICS[(topicIdx++) % TOPICS.length];
          const variations = [
            baseTopic,
            `latest ${baseTopic} trends`,
            `${baseTopic} tools compared`,
            `how ${baseTopic} is evolving`,
            `${baseTopic} beginner guide`,
            `top ${baseTopic} for 2026`,
            `${baseTopic} industry impact`,
            `${baseTopic} best practices`,
          ];
          batchTopics.push(variations[(week * 7 + day + batch + i) % variations.length]);
        }

        const postDate = new Date(targetDate);
        postDate.setHours(6 + batch * 3 + Math.floor(Math.random() * 2), Math.floor(Math.random() * 60));

        console.log(`  ${dateStr} batch ${batch + 1}/5: ${batchTopics.length} posts...`);

        try {
          const posts = await generateBatch(batchTopics, dateStr);
          if (!posts || !Array.isArray(posts)) {
            console.log(`    Batch failed, skipping`);
            continue;
          }

          for (let i = 0; i < posts.length; i++) {
            const post = posts[i];
            const pDate = new Date(postDate);
            pDate.setMinutes(pDate.getMinutes() + i * 15);

            const image = await findImage(post.imageQuery || post.title);
            post.image = image;

            if (await savePost(post, pDate)) totalSaved++;
            await new Promise(r => setTimeout(r, 300));
          }
          console.log(`    Saved. Total: ${existing + totalSaved}`);
        } catch (err) {
          console.log(`    Error: ${err.message}`);
        }

        await new Promise(r => setTimeout(r, 1500));
      }
    }
  }

  const final = await getExistingCount();
  console.log(`\n=== DONE === ${final} total posts (${totalSaved} new)\n`);
}

module.exports = { main };

if (require.main === module) {
  if (!process.env.DATABASE_URL || !process.env.OPENAI_API_KEY) {
    console.error('Missing DATABASE_URL or OPENAI_API_KEY');
    process.exit(1);
  }
  main().then(() => pool.end()).catch(err => { console.error(err); process.exit(1); });
}
