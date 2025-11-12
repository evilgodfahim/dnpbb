// generate-rss-with-date-debug.js
// Fetch print-edition endpoints with &date=YYYY-MM-DD; if empty, retry without date and with previous day.
// Produces feed.xml and debug_report.json

const fs = require('fs');
const crypto = require('crypto');
const fetch = global.fetch || require('node-fetch');

const baseURL = 'https://bonikbarta.com';
const rootPath = '00000000010000000001';
const pages = Array.from({ length: 18 }, (_, i) => i + 3); // 3..20
const concurrency = 4;
const timeoutMs = 12000;
const maxRetries = 3;
const UA = 'Mozilla/5.0 (RSS Generator)';

function md5(s){ return crypto.createHash('md5').update(String(s)).digest('hex'); }
function xmlEscape(s=''){ return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;'); }
function toRfc822(d){ try { return new Date(d).toUTCString(); } catch { return new Date().toUTCString(); } }

// BD date YYYY-MM-DD
function getBDDate(offsetDays = 0){
  const opts = { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' };
  const parts = new Date().toLocaleDateString('en-CA', Object.assign({ timeZone: 'Asia/Dhaka' }));
  // parts is already YYYY-MM-DD in en-CA; apply offset if needed
  if (offsetDays === 0) return parts;
  const dt = new Date(parts + 'T00:00:00');
  dt.setDate(dt.getDate() + offsetDays);
  return dt.toISOString().slice(0,10);
}

function isHtml(text, headers){
  if(!text) return false;
  const ct = headers && (headers.get ? headers.get('content-type') : headers['content-type']);
  if(ct && /html/.test(ct)) return true;
  const t = text.trim();
  return t.startsWith('<') || t.startsWith('<!DOCTYPE') || t.startsWith('<html');
}

function safeParse(text){
  try { return JSON.parse(text); } catch { return null; }
}

function findArticles(json){
  if(!json) return [];
  if (Array.isArray(json.posts)) return json.posts;
  if (Array.isArray(json.items)) return json.items;
  if (json.content){
    if (Array.isArray(json.content.items)) return json.content.items;
    if (Array.isArray(json.content.posts)) return json.content.posts;
    if (Array.isArray(json.content.sections)) return json.content.sections.flatMap(s => Array.isArray(s.items) ? s.items : []);
  }
  // shallow search
  const arrays = [];
  (function walk(o, depth=0){
    if(!o || typeof o !== 'object' || depth>4) return;
    if (Array.isArray(o)){
      if (o.length && o.every(it => it && typeof it === 'object' && ('id' in it || 'title' in it || 'url_path' in it || 'first_published_at' in it))){
        arrays.push(o);
        return;
      }
      for(const e of o) walk(e, depth+1);
      return;
    }
    for(const k of Object.keys(o)) walk(o[k], depth+1);
  })(json);
  if(arrays.length) arrays.sort((a,b)=>b.length-a.length);
  return arrays[0] || [];
}

function normalize(item){
  const path = item.url_path || item.path || item.slug || '';
  const url = path.startsWith('http') ? path : baseURL + (path.startsWith('/') ? path : '/' + path);
  return {
    id: item.id || md5(item.title + url + (item.first_published_at||'')),
    title: item.title || item.sub_title || 'No title',
    summary: item.summary || item.excerpt || item.description || '',
    url,
    first_published_at: item.first_published_at || item.published_at || null,
    live: (typeof item.live === 'boolean') ? item.live : true,
    raw: item
  };
}

async function fetchWithRetry(url, retries = maxRetries){
  let last = null;
  for(let attempt=1; attempt<=retries; attempt++){
    const ac = new AbortController();
    const id = setTimeout(()=>ac.abort(), timeoutMs);
    try{
      const res = await fetch(url, { method: 'GET', headers: { 'User-Agent': UA, Accept: 'application/json,text/*;q=0.2' }, signal: ac.signal });
      clearTimeout(id);
      const text = await res.text().catch(()=> '');
      if (isHtml(text, res.headers)) {
        const e = new Error(`HTML response status=${res.status}`);
        e.snippet = text.slice(0,400);
        throw e;
      }
      const json = safeParse(text) || (()=>{ try { return JSON.parse(text); } catch { return null; } })();
      if(!json) { const e = new Error('Invalid JSON'); e.snippet = text.slice(0,400); throw e; }
      return { ok: true, status: res.status, json, rawSnippet: String(text).slice(0,800) };
    } catch(err){
      clearTimeout(id);
      last = err;
      const shouldRetry = /timeout|AbortError|ECONNRESET|ECONNREFUSED|ENOTFOUND|network/i.test(String(err.message)) || String(err.message).includes('status=5') || String(err.message).includes('HTML response');
      if(!shouldRetry || attempt === retries) break;
      await new Promise(r => setTimeout(r, 300 * Math.pow(2, attempt)));
    }
  }
  return { ok:false, error: last };
}

async function fetchAll(urls, concurrency = 4){
  const out = [];
  for(let i=0;i<urls.length;i+=concurrency){
    const batch = urls.slice(i, i+concurrency).map(u => fetchWithRetry(u).then(r => ({ url: u, ...r })));
    const results = await Promise.all(batch);
    out.push(...results);
  }
  return out;
}

function generateRSS(items){
  const now = new Date().toUTCString();
  let rss = '<?xml version="1.0" encoding="UTF-8"?>\n<rss version="2.0"><channel>\n';
  rss += `<title>Bonikbarta Combined Feed</title>\n<link>${xmlEscape(baseURL)}</link>\n<description>Combined</description>\n<language>bn</language>\n<lastBuildDate>${now}</lastBuildDate>\n`;
  for(const it of items){
    const pub = it.first_published_at ? toRfc822(it.first_published_at.replace(' ', 'T')) : now;
    rss += `<item>\n<title>${xmlEscape(it.title)}</title>\n<link>${xmlEscape(it.url)}</link>\n<description><![CDATA[${it.summary||''}]]></description>\n<pubDate>${pub}</pubDate>\n<guid isPermaLink="false">${md5(it.id+'|'+it.url)}</guid>\n</item>\n`;
  }
  rss += '</channel></rss>';
  return rss;
}

(async function main(){
  const date = getBDDate(0);
  const prevDate = getBDDate(-1);
  const withDateURLs = pages.map(p => `${baseURL}/api/print-edition-page/${p}?root_path=${rootPath}&date=${date}`);
  const withoutDateURLs = pages.map(p => `${baseURL}/api/print-edition-page/${p}?root_path=${rootPath}`);
  const prevDateURLs = pages.map(p => `${baseURL}/api/print-edition-page/${p}?root_path=${rootPath}&date=${prevDate}`);

  // first try with date
  const fetchedWithDate = await fetchAll(withDateURLs, concurrency);

  // build debug entries and decide fallback fetches
  const debug = [];
  const allRaw = [];

  for (let i = 0; i < fetchedWithDate.length; i++){
    const item = fetchedWithDate[i];
    const page = pages[i];
    const entry = { page, url_with_date: item.url, ok: !!item.ok, status: item.status || null, postsFound: 0, liveFound:0, sample: [], rawSnippet: item.rawSnippet || null, fallback: null, fallbackResult: null, error: item.error ? String(item.error.message || item.error) : null };
    if(item.ok){
      const rawItems = findArticles(item.json);
      entry.postsFound = rawItems.length;
      const normalized = rawItems.map(normalize);
      entry.liveFound = normalized.filter(x=>x.live).length;
      entry.sample = normalized.slice(0,3).map(s => ({ id: s.id, title: s.title, live: s.live, url: s.url, first_published_at: s.first_published_at }));
      allRaw.push(...normalized);
    }
    // if no posts found, try without date then prev date
    if(entry.postsFound === 0){
      // try without date
      const noDateRes = await fetchWithRetry(withoutDateURLs[i]);
      entry.fallback = 'without_date';
      if(noDateRes.ok){
        const raws = findArticles(noDateRes.json).map(normalize);
        entry.fallbackResult = { ok: true, postsFound: raws.length, liveFound: raws.filter(x=>x.live).length, sample: raws.slice(0,3).map(s=>({id:s.id,title:s.title,live:s.live,url:s.url,first_published_at:s.first_published_at})) };
        allRaw.push(...raws);
      } else {
        // try prev date
        const prevRes = await fetchWithRetry(prevDateURLs[i]);
        entry.fallback = 'prev_date';
        if(prevRes.ok){
          const raws = findArticles(prevRes.json).map(normalize);
          entry.fallbackResult = { ok: true, postsFound: raws.length, liveFound: raws.filter(x=>x.live).length, sample: raws.slice(0,3).map(s=>({id:s.id,title:s.title,live:s.live,url:s.url,first_published_at:s.first_published_at})) };
          allRaw.push(...raws);
        } else {
          entry.fallbackResult = { ok: false, error: String(prevRes.error || noDateRes.error || 'no response') };
        }
      }
    }
    debug.push(entry);
  }

  // dedupe & filter live
  const byKey = new Map();
  for(const it of allRaw){
    if(it.live === false) continue;
    const key = it.id || it.url || md5(it.title + (it.first_published_at||''));
    if(!byKey.has(key)) byKey.set(key, it);
  }
  const final = Array.from(byKey.values()).sort((a,b)=> (b.first_published_at ? new Date(b.first_published_at.replace(' ','T')) : 0) - (a.first_published_at ? new Date(a.first_published_at.replace(' ','T')) : 0));

  fs.writeFileSync('feed.xml', generateRSS(final), 'utf8');
  fs.writeFileSync('debug_report.json', JSON.stringify({ dateChecked: new Date().toISOString(), dateParamUsed: date, pages, results: debug, totalRawFetched: allRaw.length, includedInFeed: final.length }, null, 2), 'utf8');

  console.log(`done. raw fetched: ${allRaw.length}. included: ${final.length}. files: feed.xml, debug_report.json`);
})();
