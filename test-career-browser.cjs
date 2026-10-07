// Run with the in-memory fixture: node test-career.cjs --serve
// Requires Playwright and Chromium, never a production database or account.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const base = 'http://127.0.0.1:4099';
const output = process.env.CAREER_TEST_OUTPUT || '/tmp/portfoliv-browser-checks';
fs.mkdirSync(output, { recursive: true });
async function edit(locator, html) { await locator.evaluate((el, value) => { el.innerHTML = value; el.dispatchEvent(new Event('input', { bubbles: true })); }, html); }
async function route(page, hash) { await page.evaluate(value => { location.hash = value; }, hash); }
async function portfolio(page, id) { return page.evaluate(async value => (await (await portfolioAuth.fetch('/api/portfolios/' + value)).json()).portfolio, id); }
async function checkWidth(page) { assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), 'Horizontal overflow'); }
(async () => {
  const browser = await chromium.launch({ headless: true, executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || undefined, args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
      const page = await context.newPage(), errors = [];
      page.on('pageerror', error => errors.push(error.message));
      page.on('dialog', dialog => dialog.accept());
      await page.goto(base + '/#mypage/resume');
      await page.waitForFunction(() => !document.querySelector('.career-profile-form button[type=submit]')?.disabled);
      const profile = page.locator('.career-profile-form'), resumeEditor = profile.locator('.rich-editor');
      await edit(resumeEditor, '<h2>편집 내용 보존</h2><p>저장 전 내용도 출력</p>');
      await resumeEditor.evaluate(el => { el.focus(); const range = document.createRange(); range.selectNodeContents(el.querySelector('h2')); const selection = getSelection(); selection.removeAllRanges(); selection.addRange(range); });
      await profile.locator('[data-font-step="1"]').click();
      const draft = await resumeEditor.innerHTML();
      const popPromise = page.waitForEvent('popup');
      await page.getByRole('button', { name: '이력서 PDF 저장', exact: true }).click();
      const popup = await popPromise;
      await popup.waitForFunction(() => document.querySelector('.career-print-controls button')?.disabled === false);
      assert.equal(await resumeEditor.innerHTML(), draft);
      assert.equal(await page.title(), '포트폴리브');
      await popup.pdf({ path: output + '/resume-' + width + '.pdf', preferCSSPageSize: true, printBackground: true });
      await popup.getByRole('button', { name: 'PDF 저장 · 인쇄', exact: true }).click();
      await popup.close(); assert.equal(await resumeEditor.innerHTML(), draft);
      await route(page, 'mypage/account'); await page.locator('[data-my-panel=account]').waitFor({ state: 'visible' });
      await route(page, 'mypage/resume'); await profile.waitFor({ state: 'visible' });
      assert.equal(await resumeEditor.innerHTML(), draft, 'Switching tabs discarded the draft');
      await profile.getByRole('button', { name: '프로필 저장', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('.career-profile-form [role=status]').textContent.includes('저장했습니다'));
      await checkWidth(page);

      await route(page, 'portfolios/new'); await page.locator('#portfolioBuilderForm').waitFor({ state: 'visible' });
      const form = page.locator('#portfolioBuilderForm');
      await form.locator('input[name=title]').fill('브라우저 검토 ' + width);
      await edit(page.locator('#portfolioIntroEditor'), '<p style="font-weight:700">소개글 서식</p>');
      await page.evaluate(() => dispatchEvent(new HashChangeEvent('hashchange')));
      assert.equal(await form.locator('input[name=title]').inputValue(), '브라우저 검토 ' + width, 'A repeated route discarded the draft');
      const choices = page.locator('#portfolioChoices input'); assert.equal(await choices.count(), 2);
      await choices.nth(0).check(); await choices.nth(1).check();
      const note = form.getByRole('textbox', { name: '프로젝트 설명', exact: true }), select = form.getByRole('combobox', { name: '설명할 작업 선택', exact: true });
      await form.getByRole('button', { name: '프로젝트 설명 양식 넣기', exact: true }).click();
      assert((await note.innerText()).includes('배운 점'));
      await edit(note, '<p>첫 번째 별도 설명</p>');
      const first = await select.inputValue(), options = await select.locator('option').evaluateAll(list => list.map(e => e.value));
      const second = options.find(id => id !== first);
      await select.selectOption(second); await edit(note, '<p>두 번째 별도 설명</p>');
      await select.selectOption(first); assert.equal(await note.innerText(), '첫 번째 별도 설명');
      await page.locator('#portfolioOrder li').first().getByRole('button', { name: /아래로 이동/ }).click();
      await select.selectOption(second); assert.equal(await note.innerText(), '두 번째 별도 설명');
      await choices.nth(1).uncheck(); await choices.nth(1).check();
      await select.selectOption(second); assert.equal(await note.innerText(), '두 번째 별도 설명');
      const resumeBox = form.locator('details').first(); await resumeBox.locator('summary').click();
      const include = resumeBox.locator('input[type=checkbox]'); await include.check();
      await resumeBox.getByRole('button', { name: '마이페이지 프로필 가져오기', exact: true }).click();
      await page.waitForFunction(() => document.querySelector('#portfolioBuilderForm input[name=name]').disabled === false && document.querySelector('#portfolioBuilderForm [aria-label="이력서 본문"]').textContent.includes('편집 내용 보존'));
      assert((await resumeBox.locator('.rich-editor').innerText()).includes('편집 내용 보존'));
      await resumeBox.locator('input[name=email]').fill('invalid'); await include.uncheck();
      await form.locator('input[name=targetCompany]').fill('회사 ' + width);
      await form.locator('input[name=targetRole]').fill('디자인');
      await checkWidth(page);
      await page.locator('#portfolioSaveButton').click();
      await page.waitForFunction(() => /^#portfolio\/[a-f\d]{24}$/.test(location.hash));
      const id = await page.evaluate(() => location.hash.split('/')[1]);
      await page.locator('#portfolioOutput .curated-portfolio').waitFor();
      const saved = await portfolio(page, id); assert.equal(saved.resume, null); assert.equal(saved.projectNotes.length, 2);
      assert(saved.introductionHtml.includes('font-weight')); assert.equal(saved.targetCompany, '회사 ' + width);
      await page.reload(); await page.locator('#portfolioOutput .curated-portfolio').waitFor();
      await route(page, 'portfolio/' + id + '/edit'); await form.waitFor({ state: 'visible' });
      assert((await page.locator('#portfolioIntroEditor').innerHTML()).includes('소개글 서식'));
      await form.getByRole('combobox', { name: '설명할 작업 선택', exact: true }).selectOption(second); assert.equal(await note.innerText(), '두 번째 별도 설명');
      await route(page, 'portfolio/' + id); await page.locator('#portfolioOutput .curated-portfolio').waitFor();

      await page.locator('#portfolioOutput').getByRole('button', { name: '회사별 복제', exact: true }).click();
      await page.waitForFunction(original => location.hash !== '#portfolio/' + original && location.hash.endsWith('/edit'), id);
      await form.waitFor({ state: 'visible' });
      const duplicateId = await page.evaluate(() => location.hash.split('/')[1]);
      await form.locator('input[name=targetCompany]').fill('독립 회사'); await edit(note, '<p>복제본 설명</p>');
      await page.locator('#portfolioSaveButton').click(); await page.locator('#portfolioOutput .curated-portfolio').waitFor();
      assert((await portfolio(page, duplicateId)).projectNotes.some(n => n.bodyHtml.includes('복제본 설명')));
      assert(!(await portfolio(page, id)).projectNotes.some(n => n.bodyHtml.includes('복제본 설명')));

      await page.locator('#portfolioOutput').getByRole('button', { name: '공유하기', exact: true }).click();
      const modal = page.locator('.share-dialog'); await modal.waitFor({ state: 'visible' });
      await modal.getByRole('button', { name: '공유 화면 미리보기', exact: true }).click();
      await modal.locator('.career-share-preview .curated-portfolio').waitFor();
      assert.equal(await modal.locator('[data-url]').inputValue(), '');
      await modal.getByRole('button', { name: '모바일 화면', exact: true }).click();
      assert(await modal.locator('.career-preview-frame').evaluate(el => el.getBoundingClientRect().width <= 391));
      await checkWidth(page); await page.screenshot({ path: output + '/share-' + width + '.png', fullPage: true });
      await modal.locator('[data-consent]').check(); await modal.locator('[data-create]').click();
      await page.waitForFunction(() => !!document.querySelector('.share-dialog [data-url]').value);
      const url = await modal.locator('[data-url]').inputValue();
      const shared = await context.newPage(); await shared.goto(url); await shared.locator('#sharedOutput .curated-portfolio').waitFor();
      assert(!(await shared.locator('body').innerText()).includes('독립 회사'));
      const image = shared.locator('img').first(); await image.waitFor(); assert((await image.getAttribute('src')).startsWith('/api/shared/'));
      assert(await image.evaluate(el => el.complete && el.naturalWidth > 0)); await shared.close();
      await modal.locator('[data-close]').click();

      const portfolioPopup = page.waitForEvent('popup'); await page.locator('#portfolioOutput').getByRole('button', { name: 'PDF 저장', exact: true }).click();
      const printed = await portfolioPopup; await printed.waitForFunction(() => document.querySelector('.career-print-controls button')?.disabled === false);
      assert.equal(await printed.locator('.curated-original, iframe, video').count(), 0);
      assert.equal(await printed.locator('a[href*="tab="]').count(), 0);
      assert(await printed.locator('img').first().evaluate(el => el.complete && el.naturalWidth > 0));
      await printed.emulateMedia({ media: 'print' }); assert.equal(await printed.locator('.career-print-controls').evaluate(el => getComputedStyle(el).display), 'none');
      await printed.pdf({ path: output + '/portfolio-' + width + '.pdf', preferCSSPageSize: true, printBackground: true });
      // Verify pagination with content that spans many sheets, including the end.
      await printed.locator('.curated-projects').evaluate(el => {
        const article = document.createElement('article'); article.className = 'blog-article';
        for (let index = 0; index < 100; index++) { const p = document.createElement('p'); p.textContent = '긴 글 페이지 검토 ' + index + ' — 작업 배경과 해결 과정을 기록합니다.'.repeat(4); article.append(p); }
        article.append(Object.assign(document.createElement('p'), { textContent: '마지막 문단까지 보존' })); el.append(article);
      });
      await printed.pdf({ path: output + '/long-portfolio-' + width + '.pdf', preferCSSPageSize: true, printBackground: true });
      // An auth transition closes the print document and clears private drafts.
      await route(page, 'mypage/resume'); await profile.waitFor({ state: 'visible' });
      await page.waitForFunction(() => !document.querySelector('.career-profile-form button[type=submit]')?.disabled);
      const closed = printed.waitForEvent('close'); await page.evaluate(() => portfolioAuth.expire()); await closed;
      assert.equal(await form.locator('input[name=targetCompany]').inputValue(), '');
      assert.equal(await profile.locator('input[name=name]').inputValue(), '');
      assert.equal(await form.locator('[aria-label="프로젝트 설명"]').innerHTML(), '');
      assert.deepEqual(errors, []);
      await context.close(); console.log('PASS browser: ' + width + 'px, profile/PDF preservation, builder, project switches, import/exclude, copy, share/media and logout');
    }
    const context = await browser.newContext({ viewport: { width: 390, height: 844 } }), page = await context.newPage();
    await page.goto(base + '/#post/111111111111111111111111');
    await page.locator('#postDetail').getByRole('button', { name: '공유하기', exact: true }).click();
    const modal = page.locator('.share-dialog'); await modal.getByRole('button', { name: '공유 화면 미리보기', exact: true }).click();
    await modal.locator('.career-share-preview .curated-portfolio').waitFor();
    assert.equal(await modal.locator('[data-url]').inputValue(), ''); await modal.locator('[data-close]').click();
    // Late import and preview responses must never cross an account transition.
    await route(page, 'portfolios/new'); await page.locator('#portfolioBuilderForm').waitFor({ state: 'visible' });
    const box = page.locator('#portfolioBuilderForm details').first(); await box.locator('summary').click(); await box.locator('input[type=checkbox]').check();
    let release, started, importDone;
    const arriving = new Promise(resolve => { started = resolve; });
    const delayed = new Promise(resolve => { release = resolve; });
    const importFinished = new Promise(resolve => { importDone = resolve; });
    await page.route('**/api/career-profile', async request => { const response = await request.fetch(); started(); await delayed; await request.fulfill({ response }); importDone(); });
    await box.getByRole('button', { name: '마이페이지 프로필 가져오기', exact: true }).click(); await arriving;
    await page.evaluate(() => portfolioAuth.expire()); release(); await importFinished; await page.unroute('**/api/career-profile');
    assert.equal(await box.locator('input[name=name]').inputValue(), '');
    await page.evaluate(() => portfolioAuth.acceptAccount({ id: 'aaaaaaaaaaaaaaaaaaaaaaaa', username: 'preview-user', kind: 'member' }));
    await route(page, 'portfolios'); await page.locator('.portfolio-card-open').first().click();
    await page.locator('#portfolioOutput').getByRole('button', { name: '공유하기', exact: true }).click();
    let resumePreview, previewStarted, previewDone; const previewArriving = new Promise(resolve => { previewStarted = resolve; }), previewDelayed = new Promise(resolve => { resumePreview = resolve; }), previewFinished = new Promise(resolve => { previewDone = resolve; });
    await page.route('**/api/portfolios/*/preview', async request => { const response = await request.fetch(); previewStarted(); await previewDelayed; await request.fulfill({ response }); previewDone(); });
    await modal.getByRole('button', { name: '공유 화면 미리보기', exact: true }).click(); await previewArriving;
    await page.evaluate(() => portfolioAuth.acceptAccount({ id: 'bbbbbbbbbbbbbbbbbbbbbbbb', username: 'other-user', kind: 'member' })); resumePreview();
    await previewFinished; await page.unroute('**/api/portfolios/*/preview');
    assert.equal(await modal.evaluate(el => el.open), false); assert.equal(await modal.locator('.career-share-preview').textContent(), '');
    await page.route('**/api/career-profile', request => request.continue({ headers: { ...request.request().headers(), 'x-fixture-user': 'bbbbbbbbbbbbbbbbbbbbbbbb' } }));
    await route(page, 'mypage/resume'); await page.waitForFunction(() => document.querySelector('.career-profile-form button[type=submit]')?.disabled === false);
    assert.equal(await page.locator('.career-profile-form input[name=name]').inputValue(), '');
    await page.unroute('**/api/career-profile');
    await context.close(); console.log('PASS browser: post preview and account transitions during delayed import/preview');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
