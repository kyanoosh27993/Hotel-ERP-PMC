# -*- coding: utf-8 -*-
"""رندر نقشه ذهنی و دیاگرام روابط → PNG (docs/20-master-workplan/assets)"""
import asyncio
import os
from playwright.async_api import async_playwright

BASE = "/home/z/my-project/hotel-erp/scripts/diagrams"
OUT = "/home/z/my-project/hotel-erp/docs/20-master-workplan/assets"
os.makedirs(OUT, exist_ok=True)


async def render_mindmap():
    html = f"file://{BASE}/mindmap.html"
    png = f"{OUT}/mindmap.png"
    logs = []
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 2400, "height": 1400}, device_scale_factor=1.5)
        page.on("console", lambda m: logs.append(m.text))
        await page.goto(html, wait_until="networkidle")
        await page.wait_for_timeout(500)
        el = page.locator("#mindmap")
        bbox = await el.bounding_box()
        expand_w = max(2400, int(bbox["width"] + 100))
        expand_h = int(bbox["height"] + 100)
        await page.set_viewport_size({"width": expand_w, "height": expand_h})
        await page.wait_for_timeout(200)
        await page.evaluate('if(typeof drawAllLines==="function") drawAllLines()')
        await page.wait_for_timeout(200)
        # برش فضای خالی سمت راست بر اساس لبه واقعی محتوا
        trim = await page.evaluate("""() => {
            const map = document.getElementById('mindmap');
            const nodes = map.querySelectorAll('.root-node,.branch-node,.sub-node,.leaf,.deep-node');
            const mapRect = map.getBoundingClientRect();
            let maxR = 0, maxB = 0;
            nodes.forEach(n => {
                const r = n.getBoundingClientRect();
                maxR = Math.max(maxR, r.right - mapRect.left);
                maxB = Math.max(maxB, r.bottom - mapRect.top);
            });
            return { contentW: Math.ceil(maxR) + 80, contentH: Math.ceil(maxB) + 80 };
        }""")
        await page.set_viewport_size({"width": trim["contentW"], "height": trim["contentH"]})
        await page.wait_for_timeout(200)
        await page.evaluate('if(typeof drawAllLines==="function") drawAllLines()')
        await page.wait_for_timeout(200)
        await el.screenshot(path=png)
        await browser.close()
    print(f"mindmap: {png} ({os.path.getsize(png)//1024}KB) console={logs}")


async def render_relations():
    html = f"file://{BASE}/relations.html"
    png = f"{OUT}/relations.png"
    async with async_playwright() as p:
        browser = await p.chromium.launch(headless=True)
        page = await browser.new_page(viewport={"width": 1200, "height": 900}, device_scale_factor=2)
        await page.goto(html, wait_until="networkidle")
        await page.wait_for_timeout(500)
        el = page.locator("#root")
        bbox = await el.bounding_box()
        await page.set_viewport_size({"width": max(1200, int(bbox["width"] + 60)), "height": int(bbox["height"] + 60)})
        await page.wait_for_timeout(200)
        await el.screenshot(path=png)
        await browser.close()
    print(f"relations: {png} ({os.path.getsize(png)//1024}KB)")


asyncio.run(render_mindmap())
asyncio.run(render_relations())

# راستی‌آزمایی برنامه‌ای: غیرخالی بودن و ابعاد
from PIL import Image
for n in ["mindmap", "relations"]:
    im = Image.open(f"{OUT}/{n}.png").convert("L")
    h = im.histogram()
    print(n, im.size, "non-white ratio", round(1 - h[255] / sum(h), 3))
