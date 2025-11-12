const fs = require('fs');
const crypto = require('crypto');

// Base URL
const baseURL = "https://bonikbarta.com";

// Pages to fetch
const pages = Array.from({ length: 18 }, (_, i) => i + 3); // pages 3–20

// Get today's date in Bangladesh time (UTC+6)
function getBDDate() {
  const now = new Date();
  const bdTime = new Date(now.getTime() + 6 * 60 * 60 * 1000); // +6 hours
  const yyyy = bdTime.getFullYear();
  const mm = String(bdTime.getMonth() + 1).padStart(2, '0');
  const dd = String(bdTime.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const date = getBDDate();
const apiURLs = pages.map(p => `${baseURL}/api/print-edition-page/${p}?root_path=00000000010000000001&date=${date}`);

// Fetch all pages
async function fetchAll() {
  let allItems = [];
  for (let url of apiURLs) {
    try {
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' }
      });
      const text = await res.text();

      // Skip non-JSON responses
      if (!text.trim().startsWith('{')) {
        console.error("Non-JSON response from", url);
        continue;
      }

      const data = JSON.parse(text);
      const items = (data.posts && Array.isArray(data.posts))
        ? data.posts
        : ((data.content && data.content.items) || []);

      allItems = allItems.concat(items);
    } catch (err) {
      console.error("Failed to load from", url, err);
    }
  }

  allItems.sort((a,b) => new Date(b.first_published_at) - new Date(a.first_published_at));
  return allItems;
}

// Generate MD5 for GUID
function generateGUID(item) {
  const str = (item.title || '') + (item.excerpt || '') + (item.first_published_at || '');
  return crypto.createHash('md5').update(str).digest('hex');
}

// Generate RSS
function generateRSS(items) {
  const nowUTC = new Date().toUTCString();

  let rss = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Bonikbarta Print Edition Feed</title>
    <link>https://harmonious-froyo-665879.netlify.app/</link>
    <atom:link href="https://harmonious-froyo-665879.netlify.app/feed.xml" rel="self" type="application/rss+xml"/>
    <description>Latest articles from Bonikbarta Print Edition</description>
    <language>bn</language>
    <lastBuildDate>${nowUTC}</lastBuildDate>
    <generator>GitHub Actions RSS Generator</generator>
`;

  items.forEach(item => {
    const fullLink = (item.url_path || "/").replace(/^\/home/, "");
    const articleUrl = baseURL + fullLink;
    const pubDate = item.first_published_at ? new Date(item.first_published_at).toUTCString() : nowUTC;
    const title = (item.title || "No title").replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const description = item.excerpt || item.summary || "No description available";
    const guid = generateGUID(item);

    rss += `    <item>
      <title>${title}</title>
      <link>${articleUrl}</link>
      <description><![CDATA[${description}]]></description>
      <pubDate>${pubDate}</pubDate>
      <guid isPermaLink="false">${guid}</guid>
    </item>
`;
  });

  rss += `  </channel>
</rss>`;

  return rss;
}

// Main
(async () => {
  try {
    const items = await fetchAll();
    const rssContent = generateRSS(items);
    fs.writeFileSync('feed.xml', rssContent, { encoding: 'utf8' });
    console.log('RSS feed generated with', items.length, 'articles for date', date);
  } catch (err) {
    console.error('Error generating RSS:', err);
  }
})();
