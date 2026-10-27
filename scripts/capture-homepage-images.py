"""Captures the homepage product images from the local app + demo event.
Run with `next dev -p 3111` up. Output: PNGs in /tmp/raw; crop and convert to webp (quality 80-82) into public/site/home/ afterwards.
The gallery shot is the first 3x3 photos of /demo/gallery at 640px wide.
Local-dev chrome that is not product UI is removed first: the 'AWS is not configured'
banner (no amplify_outputs.json locally), the Next dev indicator, and the demo
countdown ('26363d left')."""
from playwright.sync_api import sync_playwright
CLEAN = """() => {
  const st = document.createElement('style'); st.textContent='nextjs-portal{display:none!important}'; document.head.appendChild(st);
  const small = (el, re, max) => { const t=(el.textContent||'').trim(); return re.test(t) && t.length < max; };
  const all = [...document.querySelectorAll('body *')];
  const banner = all.filter(el => small(el, /^AWS is not configured/, 200)).pop();
  if (banner) banner.remove();
  const cd = all.filter(el => el.isConnected && small(el, /left to share/, 40));
  if (cd.length) cd[cd.length-1].remove();
}"""
B='http://localhost:3111'
with sync_playwright() as p:
    b = p.chromium.launch(executable_path='/usr/bin/google-chrome')
    def page(path, w, h, dpr=2):
        pg = b.new_page(viewport={'width':w,'height':h}, device_scale_factor=dpr)
        pg.goto(B+path, wait_until='networkidle'); pg.wait_for_timeout(3500)
        pg.evaluate(CLEAN); pg.wait_for_timeout(300)
        return pg
    pg = page('/capture-guest', 390, 800); pg.screenshot(path='/tmp/raw/guest-upload.png'); pg.close()
    pg = page('/demo/live', 1280, 720, 1); pg.screenshot(path='/tmp/raw/slideshow.png'); pg.close()
    pg = page('/capture-host', 1200, 760, 1); pg.screenshot(path='/tmp/raw/host-dashboard.png'); pg.close()
    pg = page('/demo/gallery', 640, 900)
    top = pg.locator('main img').first.bounding_box()['y']
    pg.screenshot(path='/tmp/raw/gallery-narrow.png', clip={'x':0,'y':top-4,'width':640,'height':760}, full_page=True)
    pg.close(); b.close()
