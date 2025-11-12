/**
 * robust-rss-generator.js
 *
 * - Fetches print-edition pages robustly (retries, timeouts, HTML detection, concurrency).
 * - Handles multiple JSON shapes and deep nesting to find article lists.
 * - Filters only published/live articles, dedupes, sorts by first_published_at.
 * - Generates feed.xml (RSS 2.0).
 *
 * Usage: node robust-rss-generator.js
 */

const fs = require('fs');
const crypto = require('crypto');
const { URL } = require('url');
const fetch = global.fetch || require('node-fetch'); // Node 18 has fetch; fallback to node-fetch if needed

// CONFIG
const baseURL = 'https://bonikbarta.com';
const rootPath = '00000000010000000001';
const pages = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
const concurrency = 4;
const timeoutMs = 12_000;
const maxRetries = 3;
const userAgent = 'Mozilla/5.0 (RSS Generator)';

// === utils ===
function getBDDate() {
  // returns YYYY-MM-DD for Asia/Dhaka timezone reliably
  return new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Dhaka' });
}

function safeJSONParse(text) {
  try {
    return JSON.parse(text);
  } catch (e) {
    // try quick fix: replace single newlines between object properties -> not reliable, return null
    return null;
  }
}

function isHtmlResponse(text, headers) {
  if (!text) return false;
  const ct = headers && (headers.get ? headers.get('content-type') : headers['content-type']);
  if (ct && /text\/html|application\/html/.test(ct)) return true;
  const t = text.trim();
  return t.startsWith('<') || t.startsWith('<!DOCTYPE') || t.startsWith('<html');
}

function md5Hex(str) {
  return crypto.createHash('md5').update(String(str)).digest('hex');
}

function toRfc822(date) {
  try {
    return new Date(date).toUTCString();
  } catch {
    return new Date().toUTCString();
  }
}

function xmlEscape(str = '') {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

// deep-scan for arrays that look like articles
function findArticleArrays(obj, depth = 0, maxDepth = 4) {
  const results = [];
  if (!obj || typeof obj !== 'object' || depth > maxDepth) return results;

  if (Array.isArray(obj)) {
    const arr = obj;
    // heuristics: array of objects with id or title or url_path or first_published_at suggests articles
    const matches = arr.every(it => it && typeof it === 'object' && ('id' in it || 'title' in it || 'url_path' in it || 'first_published_at' in it));
    if (matches) return [arr];
    // otherwise scan elements
    for (const el of arr) {
      results.push(...findArticleArrays(el, depth + 1, maxDepth));
    }
    return results;
  }

  for (const k of Object.keys(obj)) {
    const val = obj[k];
    if (Array.isArray(val)) {
      const arr = val;
      const matches = arr.every(it => it && typeof it === 'object' && ('id' in it || 'title' in it || 'url_path' in it || 'first_published_at' in it));
      if (matches) results.push(arr);
      else results.push(...findArticleArrays(val, depth + 1, maxDepth));
    } else if (val && typeof val === 'object') {
      results.push(...findArticleArrays(val, depth + 1, maxDepth));
    }
  }
  return results;
}

function normalizeArticle(item) {
  const urlPath = item.url_path || item.path || item.slug || '';
  let full = urlPath;
  if (!full.startsWith('http')) {
    try {
      full = new URL(urlPath, baseURL).toString();
    } catch {
      full = baseURL + (urlPath.startsWith('/') ? urlPath : '/' + urlPath);
    }
  }
  const pub = item.first_published_at || item.published_at || item.published || null;
  const title = item.title || item.sub_title || item.slug || 'No title';
  const summary = item.summary || item.excerpt || item.description || '';
  return {
    id: item.id || md5Hex(title + full + (pub || '')),
    title: title,
    summary: summary,
    url: full,
    first_published_at: pub,
    live: (typeof item.live === 'boolean') ? item.live : true,
    raw: item
  };
}

// === network with retries and timeout ===
async function fetchWithRetries(url, opts = {}, retries = maxRetries) {
  let attempt = 0;
  let lastErr = null;
  while (attempt < retries) {
    attempt++;
    const ac = new AbortController();
    const id = setTimeout(() => ac.abort(), timeoutMs);
    try {
      const res = await fetch(url, {
        method: 'GET',
        headers: Object.assign({ 'User-Agent': userAgent, Accept: 'application/json, text/*;q=0.2' }, opts.headers || {}),
        signal: ac.signal,
      });
      clearTimeout(id);

      const text = await res.text().catch(() => '');
      if (isHtmlResponse(text, res.headers)) {
        lastErr = new Error(`HTML response (status ${res.status})`);
        // include snippet for debugging
        lastErr.snippet = text.slice(0, 400);
        if (res.status >= 500) {
          // server error -> retry
          throw lastErr;
        } else {
          // non-500 (404/403) - treat as final (no retry)
          throw lastErr;
        }
      }

      // try parse
      const json = safeJSONParse(text) || (() => { try { return JSON.parse(text); } catch(e){ return null; } })();
      if (!json) {
        const e = new Error(`Invalid JSON from ${url}`);
        e.snippet = text.slice(0, 400);
        throw e;
      }

      return { ok: true, data: json };

    } catch (err) {
      clearTimeout(id);
      lastErr = err;
      const isAbort = err.name === 'AbortError' || /timeout/i.test(err.message);
      const isNetwork = err.type === 'system' || /network|ECONNRESET|ECONNREFUSED|ENOTFOUND/i.test(err.message);
      // retry for network, 5xx or timeout; do not retry for 4xx or HTML non-500
      const shouldRetry = isAbort || isNetwork || /HTML response|status 5/.test(String(err.message)) || (err && err.message && /status 5/i.test(err.message));
      if (!shouldRetry || attempt >= retries) break;
      const backoff = 500 * Math.pow(2, attempt - 1);
      await new Promise(r => setTimeout(r, backoff));
    }
  }
  return { ok: false, error: lastErr };
}

// chunked concurrency executor
async function fetchAllUrls(urls, concurrency = 4) {
  const results = [];
  for (let i = 0; i < urls.length; i += concurrency) {
    const slice = urls.slice(i, i + concurrency);
    const promises = slice.map(async (url) => {
      const res = await fetchWithRetries(url);
      return { url, ...res };
    });
    const chunk = await Promise.all(promises);
    results.push(...chunk);
  }
  return results;
}

// extract items from one API JSON response robustly
function extractItemsFromJson(json) {
  if (!json) return [];
  // common direct shapes
  if (Array.isArray(json.posts)) return json.posts;
  if (Array.isArray(json.items)) return json.items;
  if (json.content) {
    if (Array.isArray(json.content.items)) return json.content.items;
    if (Array.isArray(json.content.posts)) return json.content.posts;
    if (Array.isArray(json.content.sections)) {
      return json.content.sections.flatMap(sec => Array.isArray(sec.items) ? sec.items : []);
    }
  }
  // generic deep-scan heuristics
  const arrays = findArticleArrays(json, 0, 4);
  if (arrays.length) {
    // prefer first reasonably sized array
    arrays.sort((a, b) => b.length - a.length);
    return arrays[0];
  }
  return [];
}

// === RSS generation ===
function generateRSS(items) {
  const nowUTC = new Date().toUTCString();
  let rss = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    '  <channel>\n' +
    '    <title>Bonikbarta Combined Feed</title>\n' +
    `    <link>${xmlEscape(baseURL)}</link>\n` +
    '    <atom:link href="' + xmlEscape(baseURL + '/feed.xml') + '" rel="self" type="application/rss+xml"/>\n' +
    '    <description>Latest articles from Bonikbarta</description>\n' +
    '    <language>bn</language>\n' +
    '    <lastBuildDate>' + nowUTC + '</lastBuildDate>\n' +
    '    <generator>Robust RSS Generator</generator>\n';

  for (const it of items) {
    const pubDate = it.first_published_at ? toRfc822(it.first_published_at.replace(' ', 'T')) : nowUTC;
    const title = xmlEscape(it.title);
    const link = xmlEscape(it.url);
    const desc = it.summary || '';
    const guid = md5Hex((it.id || '') + '|' + it.url + '|' + (it.first_published_at || ''));
    rss += '    <item>\n' +
      '      <title>' + title + '</title>\n' +
      '      <link>' + link + '</link>\n' +
      '      <description><![CDATA[' + desc + ']]></description>\n' +
      '      <pubDate>' + pubDate + '</pubDate>\n' +
      '      <guid isPermaLink="false">' + guid + '</guid>\n' +
      '    </item>\n';
  }

  rss += '  </channel>\n</rss>';
  return rss;
}

// === main ===
(async function main() {
  const date = getBDDate();
  const apiURLs = pages.map(p => `${baseURL}/api/print-edition-page/${p}?root_path=${rootPath}&date=${date}`);

  console.log(`Fetching ${apiURLs.length} endpoints for date ${date} with concurrency ${concurrency}...`);

  const fetched = await fetchAllUrls(apiURLs, concurrency);

  let allItems = [];
  for (const res of fetched) {
    if (!res.ok) {
      console.error(`[WARN] Failed ${res.url}:`, res.error && (res.error.message || res.error));
      if (res.error && res.error.snippet) {
        console.error('  snippet:', res.error.snippet.replace(/\n/g, '\\n').slice(0, 360));
      }
      continue;
    }
    try {
      const json = res.data;
      const rawItems = extractItemsFromJson(json) || [];
      const normalized = rawItems.map(normalizeArticle);
      allItems.push(...normalized);
    } catch (e) {
      console.error(`[WARN] extraction failed for ${res.url}:`, e && e.message);
    }
  }

  // filter only live/published items, remove duplicates (by id or url), sort desc by date
  const byKey = new Map();
  for (const it of allItems) {
    if (!it) continue;
    if (it.live === false) continue; // skip unpublished
    const key = it.id || it.url || md5Hex(it.title + (it.first_published_at || ''));
    if (!byKey.has(key)) byKey.set(key, it);
    else {
      // keep the one with pub date or longer summary
      const existing = byKey.get(key);
      if (!existing.first_published_at && it.first_published_at) byKey.set(key, it);
      else if ((it.summary || '').length > (existing.summary || '').length) byKey.set(key, it);
    }
  }

  const final = Array.from(byKey.values()).sort((a, b) => {
    const da = a.first_published_at ? new Date(a.first_published_at.replace(' ', 'T')) : new Date(0);
    const db = b.first_published_at ? new Date(b.first_published_at.replace(' ', 'T')) : new Date(0);
    return db - da;
  });

  const rssContent = generateRSS(final);
  fs.writeFileSync('feed.xml', rssContent, { encoding: 'utf8' });
  console.log(`RSS feed generated with ${final.length} articles (saved to feed.xml).`);
})().catch(err => {
  console.error('Fatal error:', err && err.stack ? err.stack : err);
  process.exitCode = 1;
});
