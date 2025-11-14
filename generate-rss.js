const fs = require("fs");
const crypto = require("crypto");
const { chromium } = require("playwright");

// Pages 3–20
const pages = Array.from({ length: 18 }, (_, i) => i + 3);

// Bangladesh date (UTC+6)
function getBDDate() {
  const now = new Date();
  const bd = new Date(now.getTime() + 6 * 60 * 60 * 1000);
  return bd.toISOString().split("T")[0];
}

// Hash generator
function hash(str) {
  return crypto.createHash("sha256").update(str).digest("hex");
}

// Launch browser with robust anti-detection settings
async function launchBrowser() {
  return chromium.launch({
    headless: true,
    args: [
      "--disable-blink-features=AutomationControlled",
      "--no-sandbox",
      "--disable-dev-shm-usage",
      "--disable-gpu"
    ]
  });
}

// Fetch JSON using browser execution, bypassing Cloudflare
async function browserJSON(page, url) {
  try {
    const raw = await page.evaluate(async (fetchUrl) => {
      const res = await fetch(fetchUrl, {
        method: "GET",
        headers: {
          "Accept": "application/json, text/plain, */*",
          "User-Agent": navigator.userAgent
        }
      });
      return await res.text();
    }, url);

    try {
      return JSON.parse(raw);
    } catch (err) {
      console.log("NON-JSON RESPONSE RECEIVED <<<");
      console.log(raw.substring(0, 300));
      console.log("<<< END NON-JSON");
      return null;
    }
  } catch (err) {
    console.log("REQUEST FAILED:", url);
    console.log(err);
    return null;
  }
}

// Fetch all print-edition pages robustly
async function fetchAll() {
  const browser = await launchBrowser();
  const context = await browser.newContext({
    userAgent:
      "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/127 Safari/537.36",
    viewport: { width: 1366, height: 768 }
  });

  const page = await context.newPage();

  const date = getBDDate();
  const root = "00000000010000000001";

  const collected = [];

  for (const p of pages) {
    const url = `https://bonikbarta.com/api/print-edition-page/${p}?root_path=${root}&date=${date}`;

    console.log("Fetching:", url);

    const json = await browserJSON(page, url);

    if (!json || !json.data || !Array.isArray(json.data.print_edition_page_items)) {
      continue;
    }

    json.data.print_edition_page_items.forEach((x) => {
      const link = "https://bonikbarta.com" + (x.url || "");

      collected.push({
        title: x.title || "No title",
        link,
        description: x.sub_title || "",
        pubDate: x.created_at || new Date().toISOString(),
        guid: hash(link)
      });
    });
  }

  await browser.close();
  return collected;
}

// Build RSS
function generateRSS(items) {
  const header = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
<title>Bonik Barta Print Edition</title>
<link>https://bonikbarta.com/</link>
<description>Daily print edition auto-extracted feed</description>
<lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
`;

  const body = items
    .map(
      (item) => `
<item>
<title><![CDATA[${item.title}]]></title>
<link>${item.link}</link>
<description><![CDATA[${item.description}]]></description>
<pubDate>${new Date(item.pubDate).toUTCString()}</pubDate>
<guid>${item.guid}</guid>
</item>`
    )
    .join("");

  return header + body + `
</channel>
</rss>`;
}

// MAIN
async function main() {
  const items = await fetchAll();
  console.log("TOTAL ITEMS:", items.length);

  const rss = generateRSS(items.slice(0, 500));
  fs.writeFileSync("feed.xml", rss, "utf8");

  console.log("feed.xml updated.");
}

main();