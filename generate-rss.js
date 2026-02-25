const fs = require("fs");
const crypto = require("crypto");
const { chromium } = require("playwright");

// Base URL
const BASE = "https://bonikbarta.com";

// Pages to fetch (API pages)
const PAGES = Array.from({ length: 18 }, (_, i) => i + 3);

// Root path (constant in API)
const ROOT_PATH = "00000000010000000001";

// Retention for seen links (days)
const SEEN_RETENTION_DAYS = 7;

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

// Parse YYYY-MM-DD into a Date (UTC midnight)
function dateFromYMD(ymd) {
  if (!ymd || typeof ymd !== "string") return null;
  const [y, m, d] = ymd.split("-").map(Number);
  if (!y || !m || !d) return null;
  return new Date(Date.UTC(y, m - 1, d));
}

// Load previous GUIDs and Links (backwards-compatible)
function loadSeen() {
  if (!fs.existsSync("seen.json")) return { guids: {}, links: {} };
  try {
    const raw = fs.readFileSync("seen.json", "utf8");
    const parsed = JSON.parse(raw);

    // If file is old flat map of guid->date, convert to new shape
    const isFlatGuidMap =
      parsed &&
      typeof parsed === "object" &&
      !Array.isArray(parsed) &&
      Object.keys(parsed).every((k) => typeof parsed[k] === "string");

    if (isFlatGuidMap && !("guids" in parsed) && !("links" in parsed)) {
      return { guids: parsed, links: {} };
    }

    // If already in new shape, ensure both keys exist
    return {
      guids: parsed.guids || {},
      links: parsed.links || {},
    };
  } catch (err) {
    console.log("Failed to parse seen.json, starting fresh.", err);
    return { guids: {}, links: {} };
  }
}

// Prune seen entries older than SEEN_RETENTION_DAYS (based on BD date)
function pruneSeen(seen) {
  if (!seen || typeof seen !== "object") return;
  const todayYMD = getBDDate();
  const todayDate = dateFromYMD(todayYMD);
  if (!todayDate) return;

  const cutoffMs = todayDate.getTime() - SEEN_RETENTION_DAYS * 24 * 3600 * 1000;

  // Helper to prune a map of key -> ymd
  function pruneMap(map) {
    if (!map) return {};
    for (const k of Object.keys(map)) {
      const val = map[k];
      const d = dateFromYMD(val);
      if (!d || d.getTime() < cutoffMs) {
        delete map[k];
      }
    }
    return map;
  }

  seen.guids = pruneMap(seen.guids || {});
  seen.links = pruneMap(seen.links || {});
}

// Save seen GUIDs and Links
function saveSeen(seen) {
  pruneSeen(seen);
  fs.writeFileSync("seen.json", JSON.stringify(seen, null, 2));
}

// Convert API post to RSS item
function postToRSSItem(post) {
  const title = post.title || "No title";

  // Clean up the URL path - remove /home/ prefix if it exists
  let urlPath = post.url_path || "/";
  urlPath = urlPath.replace(/^\/home\//, "/");

  const link = BASE + urlPath;
  const description = post.summary || post.sub_title || "No description";
  const pubDate = post.first_published_at
    ? new Date(post.first_published_at).toUTCString()
    : new Date().toUTCString();
  // include link in guid hash to reduce collisions
  const guid = hash(title + description + (post.first_published_at || "") + link);

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

  const seen = loadSeen(); // { guids: {...}, links: {...} }
  // prune immediately in case file has old entries
  pruneSeen(seen);

  const today = getBDDate();
  const collected = [];

  for (const p of PAGES) {
    const url = `${BASE}/api/print-edition-page/${p}?root_path=${ROOT_PATH}&date=${today}`;
    console.log("Fetching:", url);

    const data = await fetchJSON(page, url);
    if (!data || !Array.isArray(data.posts)) continue;

    for (const post of data.posts) {
      const rssItem = postToRSSItem(post);
      const guid = rssItem.guid;
      const link = rssItem.link;

      // Deduplicate by guid OR by link
      const seenByGuid = Boolean(seen.guids && seen.guids[guid]);
      const seenByLink = Boolean(seen.links && seen.links[link]);

      if (!seenByGuid && !seenByLink) {
        collected.push(rssItem);
      }

      // Mark both guid and link as seen with today's BD date
      seen.guids = seen.guids || {};
      seen.links = seen.links || {};
      seen.guids[guid] = today;
      seen.links[link] = today;
    }
  }

  await browser.close();

  // Save seen after processing; saveSeen will prune old entries before writing
  saveSeen(seen);

  collected.sort((a, b) => new Date(b.pubDate) - new Date(a.pubDate));

  const xml = generateRSS(collected.slice(0, 500));
  fs.writeFileSync("feed.xml", xml, "utf8");

  console.log("TOTAL ITEMS:", collected.length);
  console.log("feed.xml updated.");
})();