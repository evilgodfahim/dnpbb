import requests
import datetime
import xml.etree.ElementTree as ET

# URL of Bonik Barta JSON API
API_URL = "https://bonikbarta.com/api/post-filters/41?root_path=00000000010000000001"

try:
    resp = requests.get(API_URL, timeout=10)
    resp.raise_for_status()  # raise HTTP error if status != 200
    data = resp.json()
except requests.exceptions.RequestException as e:
    print("Request failed:", e)
    data = {}
except ValueError as e:
    print("Failed to parse JSON:", e)
    data = {}

# Use posts if available
posts = data.get("posts", [])

# Build XML RSS
rss = ET.Element("rss", version="2.0")
channel = ET.SubElement(rss, "channel")
ET.SubElement(channel, "title").text = "Bonik Barta RSS"
ET.SubElement(channel, "link").text = "https://bonikbarta.com/"
ET.SubElement(channel, "description").text = "Auto-generated feed from Bonik Barta"

if not posts:
    # Add a placeholder item so the feed is never empty
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = "No posts available"
    ET.SubElement(item, "link").text = "https://bonikbarta.com/"
    ET.SubElement(item, "pubDate").text = datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT")
    ET.SubElement(item, "description").text = "The feed could not fetch posts from the API."

for post in posts:
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = post.get("title", "No title")

    raw_url = post.get("url_path", "")
    link = "https://bonikbarta.com" + raw_url.replace("/home", "")
    ET.SubElement(item, "link").text = link

    ET.SubElement(item, "pubDate").text = post.get("first_published_at", datetime.datetime.utcnow().strftime("%a, %d %b %Y %H:%M:%S GMT"))
    ET.SubElement(item, "description").text = post.get("summary", "")

# Save to feed.xml
tree = ET.ElementTree(rss)
tree.write("feed.xml", encoding="utf-8", xml_declaration=True)
print("feed.xml generated successfully")
