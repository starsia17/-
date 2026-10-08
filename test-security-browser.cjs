const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { generateSync } = require('otplib');

(async () => {
  const browser = await chromium.launch({ executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE || '/usr/bin/chromium', headless: true, args: ['--no-sandbox'] });
  try {
    for (const width of [1440, 390]) {
      const context = await browser.newContext({ viewport: { width, height: width === 390 ? 844 : 1000 } });
      const page = await context.newPage(), errors = []; page.on('pageerror', error => errors.push(error.message));
      await page.goto('http://127.0.0.1:4101/');
      await page.locator('[data-auth-view-button="register"]').click();
      const username = 'security' + width + Date.now();
      await page.locator('#registerUsername').fill(username); await page.locator('#registerPassword').fill('fixture-browser-pass'); await page.locator('#registerPasswordConfirm').fill('fixture-browser-pass');
      await page.locator('#registerForm button[type=submit]').click();
      await page.locator('#loginForm').waitFor({ state: 'visible' });
      await page.locator('#loginPassword').fill('fixture-browser-pass'); await page.locator('#loginForm button[type=submit]').click();
      await page.locator('#authScreen').waitFor({ state: 'hidden' });
      await page.evaluate(() => { location.hash = 'mypage/account'; });
      await page.getByRole('button', { name: '인증 앱 연결 시작', exact: true }).waitFor();
      const security = page.locator('#accountSecurityHost');
      await security.locator('input[type=password]').fill('fixture-browser-pass'); await security.getByRole('button', { name: '인증 앱 연결 시작', exact: true }).click();
      const secret = await security.locator('code').textContent(); assert.match(secret, /^[A-Z2-7]{32}$/);
      assert.equal(await security.locator('img').evaluate(x => x.complete && x.naturalWidth > 0), true);
      const code = generateSync({ secret }); await security.locator('input[autocomplete=one-time-code]').fill(code);
      await security.getByRole('button', { name: '코드 확인하고 2단계 인증 켜기' }).click();
      await security.locator('textarea').waitFor();
      const recoveryCodes = (await security.locator('textarea').inputValue()).split('\n'); assert.equal(recoveryCodes.length, 10);
      // A periodic session refresh must not erase the only display of recovery codes.
      await page.evaluate(() => window.portfolioAuth.refresh());
      assert.equal(await security.locator('textarea').inputValue(), recoveryCodes.join('\n'));
      assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
      await page.evaluate(async () => { await window.portfolioAuth.fetch('/api/auth/logout', { method: 'POST' }); window.portfolioAuth.expire(); });
      assert.equal(await security.textContent(), '');
      await page.locator('#loginUsername').fill(username); await page.locator('#loginPassword').fill('fixture-browser-pass'); await page.locator('#loginForm button[type=submit]').click();
      await page.locator('#loginForm .auth-error').waitFor({ state: 'visible' }); assert.match(await page.locator('#loginForm .auth-error').textContent(), /2단계/);
      await page.locator('#loginSecondFactor').fill(recoveryCodes[0]); await page.locator('#loginForm button[type=submit]').click();
      await page.locator('#authScreen').waitFor({ state: 'hidden' }); await page.evaluate(() => { location.hash = 'mypage/account'; });
      await security.getByRole('button', { name: '2단계 인증 해제', exact: true }).waitFor();
      await security.locator('input[type=password]').fill('fixture-browser-pass'); await security.locator('input[autocomplete=one-time-code]').fill(recoveryCodes[1]);
      await security.getByRole('button', { name: '2단계 인증 해제', exact: true }).click(); await security.getByRole('button', { name: '인증 앱 연결 시작', exact: true }).waitFor();
      if (width === 390) {
        await page.evaluate(async () => { await window.portfolioAuth.fetch('/api/auth/logout',{method:'POST'}); window.portfolioAuth.expire(); });
        await page.locator('[data-auth-view-button="admin"]').click();
        await page.locator('#ownerPassword').fill('security-fixture-admin'); await page.locator('#adminLoginForm button[type=submit]').click();
        await page.locator('#authScreen').waitFor({state:'hidden'}); await page.evaluate(() => { location.hash='mypage/account'; });
        await security.getByRole('button',{name:'인증 앱 연결 시작',exact:true}).waitFor();
        await security.locator('input[type=password]').fill('security-fixture-admin'); await security.getByRole('button',{name:'인증 앱 연결 시작',exact:true}).click();
        const adminSecret = await security.locator('code').textContent();
        await security.locator('input[autocomplete=one-time-code]').fill(generateSync({secret:adminSecret}));
        await security.getByRole('button',{name:'코드 확인하고 2단계 인증 켜기'}).click(); await security.locator('textarea').waitFor();
        const adminRecovery = (await security.locator('textarea').inputValue()).split('\n');
        await page.evaluate(async () => { await window.portfolioAuth.fetch('/api/auth/logout',{method:'POST'}); window.portfolioAuth.expire(); });
        await page.locator('#ownerPassword').fill('security-fixture-admin'); await page.locator('#adminLoginForm button[type=submit]').click();
        await page.locator('#adminLoginForm .auth-error').waitFor({state:'visible'}); assert.match(await page.locator('#adminLoginForm .auth-error').textContent(),/2단계/);
        assert.equal(await page.evaluate(() => window.portfolioAuth.user),null); assert.equal(await page.locator('#adminSecondFactor').evaluate(e=>e.required),true);
        await page.locator('#adminSecondFactor').fill(adminRecovery[0]); await page.locator('#adminLoginForm button[type=submit]').click();
        await page.locator('#authScreen').waitFor({state:'hidden'});
        console.log('PASS admin browser: enrolled administrator logout, password-only denial, required second factor and recovery login');
      }
      // The enforced CSP blocks event handlers and injected inline scripts in the real browser.
      await page.evaluate(() => { const el = document.createElement('div'); el.innerHTML = '<img src=/invalid onerror="window.securityExecuted=true">'; document.body.append(el); });
      await page.waitForTimeout(200); assert.equal(await page.evaluate(() => window.securityExecuted), undefined);
      assert.deepEqual(errors, []); await context.close(); console.log('PASS security browser: ' + width + 'px signup, login, MFA enrollment/QR/recovery, session refresh, logout cleanup, second-factor login, disable and CSP execution prevention');
    }
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
