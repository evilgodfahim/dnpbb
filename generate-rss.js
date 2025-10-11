const fs = require('fs');
const crypto = require('crypto');

// Generate today's date in Bangladesh time (UTC+6)
function getBDDate() {
  const now = new Date();
  const bdOffset = 6 * 60; // +6 hours in minutes
  const bdTime = new Date(now.getTime() + bdOffset * 60 * 1000);
  const yyyy = bdTime.getFullYear();
  const mm = String(bdTime.getMonth() + 1).padStart(2, '0');
  const dd = String(bdTime.getDate()).padStart(2, '0');
  return `${yyyy}-${mm}-${dd}`;
}

const date = getBDDate();

const pages = [3,4,5,6,7,8,9,10,11,12,13,14,15,16,17,18,19,20];

const apiURLs = pages.map(p => `https://bonikbarta.com/api/print-edition-page/${p}?root_path=00000000010000000001&date=${date}`);

const baseURL = "https://bonikbarta.com";

async function fetchAll() {
  let allItems = [];
  for (let url of apiURLs) {
    try {
      const response = await fetch(url);
      const data = await response.json();
      const items = (data.posts && Array.isArray(data.posts))
        ? data.posts
        : ((data.content && data.content.items) || []);
      allItems = allItems.concat(items);
    } catch (err) {
      console.error("Failed to load from", url, err);
    }
  }
  allItems.sort((a,b)=> new Date(b.first_published_at) - new Date(a.first_published_at));
  return allItems;
}

function generateGUID(item) {
  const str = (item.title||'')+(item.excerpt||'')+(item.first_published_at||'');
  return crypto.createHash('md5').update(str).digest('hex');
}

function generateRSS(items) {
  const nowUTC = new Date().toUTCString();

  let rss = '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">\n' +
    '  <channel>\n' +
    '    <title>Bonikbarta Combined Feed</title>\n' +
    '    <link>https://harmonious-froyo-665879.netlify.app/</link>\n' +
    '    <atom:link href="https://harmonious-froyo-665879.netlify.app/feed.xml" rel="self" type="application/rss+xml"/>\n' +
    '    <description>Latest articles from Bonikbarta</description>\n' +
    '    <language>bn</language>\n' +
    '    <lastBuildDate>' + nowUTC + '</lastBuildDate>\n' +
    '    <generator>GitHub Actions RSS Generator</generator>\n';

  items.forEach(item => {
    const fullLink = (item.url_path || "/").replace(/^\/home/,"");
    const articleUrl = baseURL + fullLink;
    const pubDate = item.first_published_at ? new Date(item.first_published_at).toUTCString() : nowUTC;
    const title = (item.title || "No title").replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
    const description = item.excerpt || item.summary || "No description available";
    const guid = generateGUID(item);

    rss += '    <item>\n' +
           '      <title>' + title + '</title>\n' +
           '      <link>' + articleUrl + '</link>\n' +
           '      <description><![CDATA[' + description + ']]></description>\n' +
           '      <pubDate>' + pubDate + '</pubDate>\n' +
           '      <guid isPermaLink="false">' + guid + '</guid>\n' +
           '    </item>\n';
  });

  rss += '  </channel>\n</rss>';
  return rss;
}

async function main() {
  try {
    const items = await fetchAll();
    const rssContent = generateRSS(items); // No limit
    fs.writeFileSync('feed.xml', rssContent, { encoding: 'utf8' });
    console.log('RSS feed generated with ' + items.length + ' articles');
  } catch (error) {
    console.error('Error generating RSS:', error);
  }
}

main();
