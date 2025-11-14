const fs = require("fs");
const crypto = require("crypto");
const { chromium } = require("playwright");

// Base URL
const BASE = "https://bonikbarta.com";

// Pages to fetch (API pages)
const PAGES = Array.from({ length: 18 }, (_, i) => i + 3);

// Root path (constant in API)
const ROOT_PATH = "00000000010000000001";

// Bangladesh date (UTC+6)
function getBDDate() {
  const now = new Date();
  return new Date(now.getTime() + 6 * 3600 * 1000)
    .toISOString()
    .split("T")[0];
}

// Hash for deduplication
function hash(str) {
  return crypto.createHash("md5").update(str).digest("hex");
}

// Load previous GUIDs
function loadSeen() {
  if (!fs.existsSync("seen.json")) return {};
  return JSON.parse(fs.readFileSync("seen.json", "utf8"));
}

// Save seen GUIDs
function saveSeen(seen) {
  fs.writeFileSync("seen.json", JSON.stringify(seen, null, 2));
}

// Convert API post to RSS item
function postToRSSItem(post) {
  const title = post.title || "No title";
  
  // Clean up the URL path - remove /home/ prefix if it exists
  let urlPath = post.url_path || "/";
  urlPath = urlPath.replace(/^\/home\//, '/');
  
  const link = BASE + urlPath;
  const description = post.summary || post.sub_title || "No description";
  const pubDate = post.first_published_at
    ? new Date(post.first_published_at).toUTCString()
    : new Date().toUTCString();
  const guid = hash(title + description + post.first_published_at);

  return { title, link, description, pubDate, guid };
}

// Generate RSS XML
function generateRSS(items) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Bonikbarta Combined Feed</title>
  <link>${BASE}</link>
  <description>Latest articles from Bonikbarta</description>
  <language>bn</language>
  <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
  <generator>GitHub Actions RSS Generator</generator>
`;

  const body = items
    .map(
      (i) => `
  <item>
    <title><![CDATA[${i.title}]]></title>
    <link>${i.link}</link>
    <description><![CDATA[${i.description}]]></description>
    <pubDate>${i.pubDate}</pubDate>
    <guid isPermaLink="false">${i.guid}</guid>
  </item>`
    )
    .join("");

  const footer = `
</channel>
</rss>`;

  return header + body + footer;
}

// Fetch JSON via Playwright to bypass Cloudflare
async function fetchJSON(page, url) {
  try {
    const text = await page.evaluate(async (u) => {
      const r = await fetch(u, { headers: { Accept: "application/json" } });
      return await r.text();
    }, url);

    try {
      return JSON.parse(text);
    } catch (err) {
      console.log("NON-JSON RESPONSE:", url);
      console.log(text.substring(0, 300));
      return null;
    }
  } catch (err) {
    console.log("REQUEST FAILED:", url, err);
    return null;
  }
}

// Main function
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/127 Safari/537.36",
  });
  const page = await context.newPage();

  const seen = loadSeen();
  const today = getBDDate();
  const collected = [];

  for (const p of PAGES) {
    const url = `${BASE}/api/print-edition-page/${p}?root_path=${ROOT_PATH}&date=${today}`;
    console.log("Fetching:", url);

    const data = await fetchJSON(page, url);
    if (!data || !Array.isArray(data.posts)) continue;

    for (const post of data.posts) {
      const rssItem = postToRSSItem(post);
      if (!seen[rssItem.guid]) {
        collected.push(rssItem);
      }
      seen[rssItem.guid] = today;
    }
  }

  await browser.close();

  saveSeen(seen);

  collected.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const xml = generateRSS(collected.slice(0, 500));
  fs.writeFileSync("feed.xml", xml, "utf8");

  console.log("TOTAL ITEMS:", collected.length);
  console.log("feed.xml updated.");
})();