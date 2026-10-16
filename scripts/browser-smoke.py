"""Browser integration verification. Run against a local HTTP server, not file://.

Example: python3 -m http.server 4173 &
         python3 scripts/browser-smoke.py --url http://127.0.0.1:4173/lab.html
Requires: pip install playwright && python -m playwright install chromium
This script FAILS if the actual browser scene is unusable, rather than fabricating GPU data.
"""
import argparse
import json
import pathlib
from playwright.sync_api import sync_playwright

parser = argparse.ArgumentParser()
parser.add_argument('--url', default='http://127.0.0.1:4173/lab.html')
parser.add_argument('--size', type=int, default=10000)
args = parser.parse_args()

with sync_playwright() as playwright:
    browser = playwright.chromium.launch(headless=True)
    page = browser.new_page(viewport={'width': 1440, 'height': 900})
    errors = []
    page.on('pageerror', lambda error: errors.append(str(error)))
    page.goto(args.url, wait_until='domcontentloaded', timeout=30000)
    page.wait_for_function('document.body.dataset.ready === "true" || document.body.dataset.ready === "failed"', timeout=25000)
    if page.locator('body').get_attribute('data-ready') != 'true':
        raise RuntimeError('Lab did not initialize: ' + page.locator('#progress-text').inner_text())
    caps = page.evaluate('window.__PORT_LAB__.getCapabilities()')
    modes = ['A','B','E'] + (['C','D'] if caps['webgpu'] else [])
    report = page.evaluate('async ([size,modes]) => await window.__PORT_LAB__.runAB({size,seed:20261016,chunkSize:2048,interactionMs:600,modes})', [args.size,modes])
    pathlib.Path('reports').mkdir(exist_ok=True)
    pathlib.Path('reports/browser-results.json').write_text(json.dumps(report,ensure_ascii=False,indent=2),encoding='utf-8')
    page.screenshot(path='reports/browser-lab.png',full_page=True)
    assert len(report['results']) == len(modes), report['errors']
    assert all(r['generatedObjects'] == args.size for r in report['results'])
    assert all(r['visibleObjects'] > 0 for r in report['results'])
    assert not errors, errors
    print(json.dumps({'capabilities':caps,'results':report['results'],'errors':report['errors']},ensure_ascii=False,indent=2))
    browser.close()
