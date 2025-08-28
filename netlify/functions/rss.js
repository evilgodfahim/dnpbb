// File: netlify/functions/rss.js
// This creates a serverless function at: /.netlify/functions/rss

exports.handler = async (event, context) => {
  const apiURLs = [
    "https://bonikbarta.com/api/post-filters/41?root_path=00000000010000000001",
    "https://bonikbarta.com/api/post-filters/52?root_path=00000000010000000001"
  ];
  const baseURL = "https://bonikbarta.com";

  try {
    let allItems = [];

    // Fetch data from APIs
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

    // Sort by published date (newest first)
    allItems.sort((a, b) => new Date(b.first_published_at) - new Date(a.first_published_at));

    // Generate RSS XML
    const now = new Date();
    const buildId = Math.floor(now.getTime() / 1000); // Unique build ID
    
    const rssItems = allItems.slice(0, 20).map(item => { // Limit to 20 items
      const pubDate = new Date(item.first_published_at).toUTCString();
      let fullLink = item.url_path || "/";
      fullLink = fullLink.replace(/^\/home/, "");
      const url = baseURL + fullLink;
      
      return `
    <item>
      <title><![CDATA[${item.title || 'No title'}]]></title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <pubDate>${pubDate}</pubDate>
      <description><![CDATA[${item.summary || item.title || ''}]]></description>
    </item>`;
    }).join('');

    const rssXml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>Bonikbarta Combined Feed</title>
    <link>https://harmonious-froyo-665879.netlify.app</link>
    <description>Combined latest posts from Bonikbarta - Build ${buildId}</description>
    <language>en</language>
    <lastBuildDate>${now.toUTCString()}</lastBuildDate>
    <pubDate>${now.toUTCString()}</pubDate>
    <ttl>30</ttl>
    <atom:link href="https://harmonious-froyo-665879.netlify.app/.netlify/functions/rss" rel="self" type="application/rss+xml"/>
${rssItems}
  </channel>
</rss>`;

    return {
      statusCode: 200,
      headers: {
        'Content-Type': 'application/rss+xml; charset=utf-8',
        'Cache-Control': 'no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff'
      },
      body: rssXml
    };

  } catch (error) {
    console.error('Error generating RSS feed:', error);
    return {
      statusCode: 500,
      headers: {
        'Content-Type': 'text/plain'
      },
      body: `Error generating RSS feed: ${error.message}`
    };
  }
};