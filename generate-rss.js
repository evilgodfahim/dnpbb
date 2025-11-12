const fs = require('fs');
const crypto = require('crypto');

// Polyfill-safe fetch for Node 18+ (uses node-fetch if needed)
let fetchFn = globalThis.fetch;
if (!fetchFn) {
  try {
    fetchFn = require('node-fetch');
  } catch (e) {
    throw new Error('fetch not available — use Node 18+ or install node-fetch');
  }
}

// Reliable Bangladesh date using Asia/Dhaka timezone
function getBDDate() {
  const now = new Date();
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Dhaka',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit'
  }).formatToParts(now);
  const yyyy = parts.find(p => p.type === 'year').value;
  const mm = parts.find(p => p.type === 'month').value;
  const dd = parts.find(p => p.type === 'day').value;
  return `${yyyy}-${mm}-${dd}`;
}

const date = getBDDate();
const pages = [3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];
const apiURLs = pages.map(
  p => `https://bonikbarta.com/api/print-edition-page/${p}?root_path=00000000010000000001&date=${date}`
);
const baseURL = "https://bonikbarta.com";

async function fetchAll() {
  let allItems = [];
  for (const url of apiURLs) {
    try {
      const res = await fetchFn(url);
      if (!res.ok) {
        console.error('Bad response', res.status, url);
        continue;
      }
      const data = await res.json();
      const items = Array.isArray(data.posts)
        ? data.posts
        : (data.content && Array.isArray(data.content.items) ? data.content.items : []);
      allItems = allItems.concat(items);
    } catch (err) {
      console.error('Failed to load from', url, err);
    }
  }
  allItems.sort(
    (a, b) =>
      new Date(b.first_published_at || 0) - new Date(a.first_published_at || 0)
  );
  return allItems;
}

function generateGUID(item) {
  const str =
    (item.title || '') +
    '||' +
    (item.excerpt || item.summary || '') +
    '||' +
    (item.first_published_at || '');
  return crypto.createHash('md5').update(str).digest('hex');
}

function sanitizeCData(s) {
  return String(s).replace(/]]>/g, ']]]]><![CDATA[>');
}

function generateRSS(items) {
  const nowUTC = new Date().toUTCString();

  let existingGuids = new Set();
  let existingItems = [];

  if (fs.existsSync('feed.xml')) {
    const oldXML = fs.readFileSync('feed.xml', 'utf8');
    const matches = [
      ...oldXML.matchAll(
        /<item>[\s\S]*?<guid[^>]*>([\s\S]*?)<\/guid>[\s\S]*?<\/item>/g
      ),
    ];
    matches.forEach(m => {
      const guid = m[1].trim();
      existingGuids.add(guid);
      existingItems.push(m[0]);
    });
  }

  for (const item of items) {
    const guid = generateGUID(item);
    if (existingGuids.has(guid)) continue;

    const fullLink = (item.url_path || '/').replace(/^\/home/, '');
    const articleUrl = baseURL + fullLink;
    const pubDate = item.first_published_at
      ? new Date(item.first_published_at).toUTCString()
      : nowUTC;
    const title = (item.title || 'No title')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
    const description = sanitizeCData(
      item.excerpt || item.summary || 'No description available'
    );

    const chunk = `    <item>
      <title>${title}</title>
      <link>${articleUrl}</link>
      <description><![CDATA[${description}]]></description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
    </item>
`;
    existingItems.unshift(chunk);
    existingGuids.add(guid);
  }

  existingItems = existingItems.slice(0, 500);

  const header = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Bonikbarta Combined Feed</title>
    <link>https://harmonious-froyo-665879.netlify.app/</link>
    <atom:link href="https://harmonious-froyo-665879.netlify.app/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Latest articles from Bonikbarta</description>
    <language>bn</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
    <generator>GitHub Actions RSS Generator</generator>
`;

  const footer = '  </channel>\n</rss>';
  return header + existingItems.join('') + footer;
}

async function main() {
  try {
    const items = await fetchAll();
    console.log('Fetched items:', items.length);
    const rssContent = generateRSS(items);
    fs.writeFileSync('feed.xml', rssContent, { encoding: 'utf8' });
    console.log('RSS feed updated. Total items capped at 500.');
  } catch (error) {
    console.error('Error generating RSS:', error);
  }
}

main();