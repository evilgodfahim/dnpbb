// generate-plain-index.js
const fs = require('fs');

const apiURLs = [
  "https://bonikbarta.com/api/post-filters/73?root_path=00000000010000000001"
];
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

async function main() {
  const items = await fetchAll();
  let html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Bonikbarta Combined Feed - PolitePol</title>
</head>
<body>
<h1>Bonikbarta Latest Posts</h1>
<ul>\n`;

  items.forEach(item => {
    const fullLink = (item.url_path || "/").replace(/^\/home/,"");
    html += `<li><a href="${baseURL + fullLink}" target="_blank">${item.title || "No title"}</a>`;
    if(item.first_published_at){
      html += ` - ${new Date(item.first_published_at).toLocaleDateString()}`;
    }
    html += `</li>\n`;
  });

  html += `</ul>\n</body>\n</html>`;
  fs.writeFileSync('index-plain.html', html, { encoding: 'utf8' });
  console.log('PolitePol-friendly HTML generated');
}

main();
