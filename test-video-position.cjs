const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { sanitizeRichText } = require('./server');
(async () => {
  const browser = await chromium.launch({ executablePath: '/usr/bin/chromium', args: ['--no-sandbox'], headless: true });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: 900 } }); const page = await context.newPage();
      await page.goto('http://127.0.0.1:4099/#write'); await page.locator('#editor').waitFor({ state: 'visible' });
      await page.evaluate(() => {
        const e = document.querySelector('#editor'); e.textContent = '앞 문장 뒤 문장';
        const r = document.createRange(); r.setStart(e.firstChild, 4); r.collapse(true);
        const a = document.createElement('a'); a.href = 'https://youtu.be/dQw4w9WgXcQ'; a.textContent = '영상 하나'; window.portfolioVideoPosition.insert(e, r, a);
        const p = document.createElement('p'); p.textContent = '중간 설명'; e.append(p);
        const r2 = document.createRange(); r2.setStart(e, e.childNodes.length); r2.collapse(true);
        const b = document.createElement('a'); b.href = 'https://vimeo.com/123456789'; b.textContent = '영상 둘'; window.portfolioVideoPosition.insert(e, r2, b);
      });
      const select = page.getByLabel('이동할 외부 동영상'); await select.selectOption('1');
      await page.getByRole('button', { name: '동영상 위로 이동', exact: true }).click();
      await page.getByRole('button', { name: '동영상 오른쪽 정렬', exact: true }).click();
      const html = await page.locator('#editor').innerHTML(), clean = sanitizeRichText(html);
      assert.ok(clean.includes('앞 문장') && clean.includes('뒤 문장') && clean.includes('중간 설명'));
      assert.equal((clean.match(/data-external-video="true"/g) || []).length, 2); assert.ok(clean.includes('text-align:right'));
      assert.ok(clean.indexOf('영상 둘') < clean.indexOf('중간 설명'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.reload(); await page.locator('#editor').waitFor({ state: 'visible' });
      await page.locator('#editor').evaluate((e, saved) => { e.innerHTML = saved; e.dispatchEvent(new Event('input', { bubbles: true })); }, clean);
      await select.selectOption('1'); await page.getByRole('button', { name: '동영상 아래로 이동', exact: true }).click();
      assert.ok((await page.locator('#editor').innerHTML()).indexOf('중간 설명') < (await page.locator('#editor').innerHTML()).indexOf('영상 둘'));
      // Old inline links are split without losing either adjacent text segment.
      await page.locator('#editor').evaluate(e => { e.innerHTML = '<p>기존 앞<a href="https://youtu.be/dQw4w9WgXcQ">이전 영상</a><b>기존 뒤</b></p>'; e.dispatchEvent(new Event('input', { bubbles: true })); });
      await page.getByRole('button', { name: '동영상 왼쪽 정렬', exact: true }).click();
      const legacy = sanitizeRichText(await page.locator('#editor').innerHTML()); assert.ok(legacy.indexOf('기존 앞') < legacy.indexOf('이전 영상') && legacy.indexOf('이전 영상') < legacy.indexOf('기존 뒤')); assert.ok(legacy.includes('<b>기존 뒤</b>'));
      const shared = await page.evaluate(saved => {
        const root = window.portfolioPresentation.render({ type: 'post', title: '영상 배치', posts: [{ bodyHtml: saved, media: [] }] }); document.body.append(root);
        const block = root.querySelector('[data-external-video]'); return { align: block.style.textAlign, frames: root.querySelectorAll('iframe').length, leftMargin: getComputedStyle(root.querySelector('.external-video-embed')).marginLeft };
      }, legacy); assert.equal(shared.align, 'left'); assert.equal(shared.frames, 1); assert.equal(shared.leftMargin, '0px');
      await context.close(); console.log('PASS video position ' + width + 'px: insertion splits, multiple links, move/order, align, sanitized persistence/reload, legacy conversion and shared renderer');
    }
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exitCode = 1; });
