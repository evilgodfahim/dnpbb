import requests
import datetime
import xml.etree.ElementTree as ET

# URL of Bonik Barta JSON API (change section ID/date if needed)
API_URL = "https://bonikbarta.com/api/print-edition-page/18?root_path=00000000010000000001&date={date}"

today = datetime.date.today().strftime("%Y-%m-%d")
url = API_URL.format(date=today)

resp = requests.get(url)
data = resp.json()

posts = data.get("posts", [])

# Build XML RSS
rss = ET.Element("rss", version="2.0")
channel = ET.SubElement(rss, "channel")

ET.SubElement(channel, "title").text = "Bonik Barta RSS"
ET.SubElement(channel, "link").text = "https://bonikbarta.com/"
ET.SubElement(channel, "description").text = "Auto-generated feed from Bonik Barta"

for post in posts:
    item = ET.SubElement(channel, "item")
    ET.SubElement(item, "title").text = post.get("title", "No title")
    
    # Fix URL (remove unwanted /home/)
    raw_url = post.get("url_path", "")
    link = "https://bonikbarta.com" + raw_url.replace("/home", "")
    ET.SubElement(item, "link").text = link
    
    ET.SubElement(item, "pubDate").text = post.get("first_published_at", "")
    ET.SubElement(item, "description").text = post.get("summary", "")

# Save to feed.xml
tree = ET.ElementTree(rss)
tree.write("feed.xml", encoding="utf-8", xml_declaration=True)
