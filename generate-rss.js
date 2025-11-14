const fs = require('fs');
const crypto = require('crypto');
const fetch = require('node-fetch');

// Base URL
const baseURL = "https://bonikbarta.com";

// Pages 3–20
const pages = Array.from({ length: 18 }, (_, i) => i + 3);

// Get today's date in BD (UTC+6)
function getBDDate() {
  const now = new Date();
  const bdTime = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return bdTime.toISOString().split('T')[0];
}

// Hash generator
function hash(str) {
  return crypto.createHash('sha256').update(str).digest('hex');
}

// Fetch JSON safely
async function fetchJSON(url) {
  try {
    const res = await fetch(url, {
      headers: {
        "Accept": "application/json, text/plain, */*",
        "User-Agent": "Mozilla/5.0"
      }
    });

    const text = await res.text();

    try {
      return JSON.parse(text);
    } catch (err) {
      console.log(`NON-JSON RESPONSE FROM: ${url}`);
      console.log(text.substring(0, 1000));
      return null;
    }
  } catch (err) {
    console.log(`REQUEST FAILED: ${url}`);
    console.log(err);
    return null;
  }
}

// Fetch all pages
async function fetchAll() {
  const date = getBDDate();
  const root = "00000000010000000001";

  const all = [];

  for (const page of pages) {
    const url = `${baseURL}/api/print-edition-page/${page}?root_path=${root}&date=${date}`;
    const data = await fetchJSON(url);

    if (!data || !data.data || !Array.isArray(data.data.print_edition_page_items)) {
      continue;
    }

    const items = data.data.print_edition_page_items.map(x => ({
      title: x.title || "No title",
      link: baseURL + (x.url || ""),
      description: x.sub_title || "",
      pubDate: x.created_at || new Date().toISOString(),
      guid: hash(baseURL + (x.url || ""))
    }));

    all.push(...items);
  }

  return all;
}

// Generate RSS XML
function generateRSS(items) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Bonik Barta Print Edition</title>
<link>${baseURL}</link>
<description>Daily print edition auto-extracted feed</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
`;

  const body = items.map(item => `
<item>
<title><![CDATA[${item.title}]]></title>
<link>${item.link}</link>
<description><![CDATA[${item.description}]]></description>
<pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
<guid>${item.guid}</guid>
</item>`).join('\n');

  return header + body + `\n</channel>\n</rss>`;
}

// MAIN
async function main() {
  const items = await fetchAll();

  console.log(`TOTAL ITEMS FETCHED: ${items.length}`);

  const final = generateRSS(items.slice(0, 500));

  fs.writeFileSync('feed.xml', final, 'utf8');

  console.log("feed.xml updated.");
}

main();