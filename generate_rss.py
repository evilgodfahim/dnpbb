import requests
import datetime
import xml.etree.ElementTree as ET
from email.utils import formatdate

# URL of Bonik Barta JSON API
API_URL = "https://bonikbarta.com/api/post-filters/41?root_path=00000000010000000001"

def get_current_time_rfc2822():
    """Get current time in RFC2822 format for RSS."""
    return formatdate()

def parse_date(date_string):
    """Parse various date formats and return RFC2822 format for RSS."""
    if not date_string:
        return get_current_time_rfc2822()
    
    try:
        # Try parsing ISO format first
        dt = datetime.datetime.fromisoformat(date_string.replace('Z', '+00:00'))
        return formatdate(dt.timestamp())
    except:
        try:
            # Try other common formats
            dt = datetime.datetime.strptime(date_string, "%Y-%m-%d %H:%M:%S")
            return formatdate(dt.timestamp())
        except:
            # Return current time if parsing fails
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

# Try multiple approaches to get data
data = {}
posts = []

print("Attempting to fetch data from Bonik Barta API...")

# Headers to mimic a real browser request
headers = {
    'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
    'Accept': 'application/json, text/plain, */*',
    'Accept-Language': 'en-US,en;q=0.9,bn;q=0.8',
    'Accept-Encoding': 'gzip, deflate, br',
    'Referer': 'https://bonikbarta.com/',
    'Connection': 'keep-alive',
    'Sec-Fetch-Dest': 'empty',
    'Sec-Fetch-Mode': 'cors',
    'Sec-Fetch-Site': 'same-origin',
}

try:
    print("Trying with browser headers...")
    resp = requests.get(API_URL, headers=headers, timeout=15)
    print(f"Response status: {resp.status_code}")
    resp.raise_for_status()
    data = resp.json()
    posts = data.get("posts", [])
    print(f"Successfully fetched {len(posts)} posts")
except requests.exceptions.HTTPError as e:
    print(f"HTTP Error {resp.status_code}: {e}")
    if resp.status_code == 403:
        print("Access forbidden. The API might be blocking automated requests.")
    print("Trying alternative approaches...")
except requests.exceptions.RequestException as e:
    print(f"Request failed: {e}")
except ValueError as e:
    print(f"Failed to parse JSON: {e}")

# Try alternative API endpoints if main one fails
if not posts:
    alternative_urls = [
        "https://bonikbarta.com/api/posts",
        "https://bonikbarta.com/api/latest-posts",
        "https://bonikbarta.com/wp-json/wp/v2/posts",
    ]
    
    for alt_url in alternative_urls:
        try:
            print(f"Trying alternative URL: {alt_url}")
            resp = requests.get(alt_url, headers=headers, timeout=10)
            if resp.status_code == 200:
                alt_data = resp.json()
                if isinstance(alt_data, list):
                    posts = alt_data[:10]  # Take first 10
                elif isinstance(alt_data, dict) and "posts" in alt_data:
                    posts = alt_data["posts"][:10]
                
                if posts:
                    print(f"Found {len(posts)} posts from alternative endpoint")
                    break
        except Exception as e:
            print(f"Alternative URL failed: {e}")
            continue

# Build XML RSS
rss = ET.Element("rss", version="2.0")
rss.set("xmlns:atom", "http://www.w3.org/2005/Atom")

channel = ET.SubElement(rss, "channel")
ET.SubElement(channel, "title").text = "Bonik Barta RSS Feed"
ET.SubElement(channel, "link").text = "https://bonikbarta.com/"
ET.SubElement(channel, "description").text = "Auto-generated RSS feed from Bonik Barta - Latest news and updates"
ET.SubElement(channel, "language").text = "bn"
ET.SubElement(channel, "lastBuildDate").text = get_current_time_rfc2822()
ET.SubElement(channel, "generator").text = "GitHub Actions RSS Generator"

# Add self-referencing link
atom_link = ET.SubElement(channel, "atom:link")
atom_link.set("href", "https://evilgodfahim.github.io/bb-rss/feed.xml")
atom_link.set("rel", "self")
atom_link.set("type", "application/rss+xml")

if not posts:
    print("No posts found from any source, creating fallback content...")
    # Add a more informative placeholder item
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = "RSS Feed Status - Unable to fetch posts"
    ET.SubElement(item, "link").text = "https://bonikbarta.com/"
    ET.SubElement(item, "pubDate").text = get_current_time_rfc2822()
    ET.SubElement(item, "description").text = f"Unable to fetch posts from API at {datetime.datetime.now().strftime('%Y-%m-%d %H:%M:%S')}. The API may be temporarily unavailable or blocking automated requests. This feed will retry automatically."
    
    guid = ET.SubElement(item, "guid")
    guid.text = f"https://bonikbarta.com/status-{datetime.datetime.now().strftime('%Y%m%d%H')}"
    guid.set("isPermaLink", "false")
else:
    print(f"Processing {len(posts)} posts...")
    for i, post in enumerate(posts):
        try:
            item = ET.SubElement(channel, "item")
            
            # Handle different possible field names for title
            title = post.get("title") or post.get("post_title") or post.get("name") or f"Post {i+1}"
            ET.SubElement(item, "title").text = escape_xml(title)
            print(f"Processing: {title[:50]}...")

            # Handle different possible field names for URL
            url_path = post.get("url_path") or post.get("link") or post.get("url") or post.get("permalink")
            if url_path:
                if url_path.startswith("http"):
                    link = url_path
                else:
                    clean_url = url_path.replace("/home", "")
                    if not clean_url.startswith("/"):
                        clean_url = "/" + clean_url
                    link = "https://bonikbarta.com" + clean_url
            else:
                link = "https://bonikbarta.com/"
            
            ET.SubElement(item, "link").text = link

            # Handle different possible field names for date
            pub_date_raw = (post.get("first_published_at") or 
                          post.get("published_at") or 
                          post.get("date") or 
                          post.get("created_at"))
            pub_date = parse_date(pub_date_raw)
            ET.SubElement(item, "pubDate").text = pub_date

            # Handle different possible field names for description
            description = (post.get("summary") or 
                         post.get("excerpt") or 
                         post.get("description") or 
                         post.get("content", "")[:200] or
                         "No description available")
            ET.SubElement(item, "description").text = escape_xml(description)

            # Add GUID
            guid = ET.SubElement(item, "guid")
            guid.text = link
            guid.set("isPermaLink", "true")

            # Add category if available
            category = post.get("category") or post.get("categories")
            if category:
                if isinstance(category, list) and category:
                    category = category[0]
                if isinstance(category, dict):
                    category = category.get("name", "")
                if category:
                    ET.SubElement(item, "category").text = escape_xml(str(category))

        except Exception as e:
            print(f"Error processing post {i}: {e}")
            continue

# Save to feed.xml with proper formatting
tree = ET.ElementTree(rss)
try:
    ET.indent(tree, space="  ", level=0)  # Pretty print (Python 3.9+)
except AttributeError:
    pass  # Skip pretty printing for older Python versions

tree.write("feed.xml", encoding="utf-8", xml_declaration=True)

print(f"\n✅ RSS feed generated successfully!")
print(f"📊 Total items in feed: {len(posts) if posts else 1}")
print(f"📁 File saved as: feed.xml")
print(f"🔗 Feed URL: https://evilgodfahim.github.io/bb-rss/feed.xml")

if not posts:
    print("\n⚠️  Note: Feed contains placeholder content due to API access issues")
else:
    print(f"📰 Latest post: {posts[0].get('title', 'Unknown') if posts else 'None'}")
