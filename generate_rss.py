import requests
import datetime
import xml.etree.ElementTree as ET
from email.utils import formatdate

# Multiple API URLs like your index.html
API_URLS = [
    "https://bonikbarta.com/api/post-filters/41?root_path=00000000010000000001",
    "https://bonikbarta.com/api/post-filters/52?root_path=00000000010000000001"
]

def get_current_time_rfc2822():
    """Get current time in RFC2822 format for RSS."""
    return formatdate()

def parse_date(date_string):
    """Parse date string and return RFC2822 format for RSS."""
    if not date_string:
        return get_current_time_rfc2822()
    
    try:
        # Parse ISO format date
        dt = datetime.datetime.fromisoformat(date_string.replace('Z', '+00:00'))
        return formatdate(dt.timestamp())
    except:
        try:
            # Try other formats
            dt = datetime.datetime.strptime(date_string, "%Y-%m-%d %H:%M:%S")
            return formatdate(dt.timestamp())
        except:
            return get_current_time_rfc2822()

def escape_xml(text):
    """Escape XML special characters."""
    if not text:
        return ""
    return (str(text)
            .replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&apos;"))

def fetch_posts_from_api(url, headers):
    """Fetch posts from a single API URL."""
    try:
        print(f"Fetching from: {url}")
        response = requests.get(url, headers=headers, timeout=15)
        print(f"Status: {response.status_code}")
        
        if response.status_code == 200:
            data = response.json()
            # Handle different response structures
            posts = []
            if isinstance(data, dict):
                posts = data.get("posts", [])
                if not posts and "content" in data and "items" in data["content"]:
                    posts = data["content"]["items"]
            elif isinstance(data, list):
                posts = data
            
            print(f"Found {len(posts)} posts")
            return posts
        else:
            print(f"HTTP {response.status_code}: {response.text[:200]}")
            return []
    except Exception as e:
        print(f"Error fetching from {url}: {e}")
        return []

# Headers to mimic browser request (same as your HTML would send)
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://bonikbarta.com/',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
    'Cache-Control': 'no-cache'
}

print("🚀 Starting Bonik Barta RSS Generator...")
print("📡 Fetching from multiple API endpoints...")

# Fetch from all APIs (same as your index.html)
all_posts = []
for api_url in API_URLS:
    posts = fetch_posts_from_api(api_url, headers)
    all_posts.extend(posts)

print(f"\n📊 Total posts collected: {len(all_posts)}")

# Sort by published date (newest first) - same as your index.html
if all_posts:
    all_posts.sort(key=lambda x: x.get("first_published_at", ""), reverse=True)
    print(f"📅 Latest post date: {all_posts[0].get('first_published_at', 'Unknown')}")

# Build RSS feed
print("\n🔧 Building RSS feed...")
rss = ET.Element("rss", version="2.0")
rss.set("xmlns:atom", "http://www.w3.org/2005/Atom")

channel = ET.SubElement(rss, "channel")
ET.SubElement(channel, "title").text = "Bonik Barta Combined Feed"
ET.SubElement(channel, "link").text = "https://bonikbarta.com/"
ET.SubElement(channel, "description").text = "Combined RSS feed from Bonik Barta - Latest news from multiple categories"
ET.SubElement(channel, "language").text = "bn"
ET.SubElement(channel, "lastBuildDate").text = get_current_time_rfc2822()
ET.SubElement(channel, "generator").text = "Bonik Barta RSS Generator"

# Self-referencing link
atom_link = ET.SubElement(channel, "atom:link")
atom_link.set("href", "https://evilgodfahim.github.io/bb-rss/feed.xml")
atom_link.set("rel", "self")
atom_link.set("type", "application/rss+xml")

# Process posts
if not all_posts:
    print("⚠️  No posts found, creating status item...")
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = "Bonik Barta RSS - No Posts Available"
    ET.SubElement(item, "link").text = "https://bonikbarta.com/"
    ET.SubElement(item, "pubDate").text = get_current_time_rfc2822()
    ET.SubElement(item, "description").text = f"Unable to fetch posts from Bonik Barta APIs at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}. APIs may be temporarily unavailable. Feed will retry automatically every hour."
    
    guid = ET.SubElement(item, "guid")
    guid.text = f"status-{datetime.datetime.now().strftime('%Y%m%d%H')}"
    guid.set("isPermaLink", "false")
else:
    # Limit to 50 most recent posts to keep feed manageable
    recent_posts = all_posts[:50]
    print(f"📝 Processing {len(recent_posts)} most recent posts...")
    
    for i, post in enumerate(recent_posts):
        try:
            item = ET.SubElement(channel, "item")
            
            # Title
            title = escape_xml(post.get("title", f"Post {i+1}"))
            ET.SubElement(item, "title").text = title
            
            # URL - same logic as your index.html
            url_path = post.get("url_path", "/")
            # Force remove "/home" prefix like in your HTML
            clean_url = url_path.replace("/home", "")
            if not clean_url.startswith("/"):
                clean_url = "/" + clean_url
            
            full_link = "https://bonikbarta.com" + clean_url
            ET.SubElement(item, "link").text = full_link
            
            # Publication date
            pub_date = parse_date(post.get("first_published_at"))
            ET.SubElement(item, "pubDate").text = pub_date
            
            # Description
            description = escape_xml(post.get("summary", post.get("excerpt", "Read full article at Bonik Barta")))
            ET.SubElement(item, "description").text = description
            
            # GUID
            guid = ET.SubElement(item, "guid")
            guid.text = full_link
            guid.set("isPermaLink", "true")
            
            # Category if available
            if "category" in post and post["category"]:
                category = post["category"]
                if isinstance(category, dict):
                    category = category.get("name", "")
                ET.SubElement(item, "category").text = escape_xml(str(category))
            
            if i < 3:  # Show first 3 processed
                print(f"  ✓ {title[:60]}...")
                
        except Exception as e:
            print(f"❌ Error processing post {i}: {e}")
            continue

# Save RSS feed
print("\n💾 Saving RSS feed...")
tree = ET.ElementTree(rss)

# Pretty print if available
try:
    ET.indent(tree, space="  ", level=0)
except AttributeError:
    pass

tree.write("feed.xml", encoding="utf-8", xml_declaration=True)

print("\n🎉 RSS Feed Generated Successfully!")
print(f"📊 Total items in feed: {len(all_posts) if all_posts else 1}")
print(f"📁 File: feed.xml")
print(f"🔗 RSS URL: https://evilgodfahim.github.io/bb-rss/feed.xml")
print(f"📱 Add this URL to Inoreader: https://evilgodfahim.github.io/bb-rss/feed.xml")

if all_posts:
    print(f"\n📰 Latest article: '{all_posts[0].get('title', 'Unknown')}'")
    print(f"📅 Published: {all_posts[0].get('first_published_at', 'Unknown')}")
else:
    print("\n⚠️  Feed contains status message - will retry next hour")
