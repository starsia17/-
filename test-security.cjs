const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { generateSync } = require('otplib');
process.env.NODE_ENV = 'test';
process.env.ADMIN_SESSION_SECRET = crypto.randomBytes(32).toString('hex');
process.env.PORTFOLIO_ADMIN_PASSWORD = 'security-fixture-admin';

const stores = {};
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$ne' in value && actual === value.$ne) return false;
      if ('$lt' in value && !(actual < value.$lt)) return false;
      if ('$lte' in value && !(actual <= value.$lte)) return false;
      if ('$gt' in value && !(actual > value.$gt)) return false;
      if ('$exists' in value && (actual !== undefined) !== value.$exists) return false;
      return true;
    }
    return Array.isArray(actual) ? actual.includes(value) : value == null ? actual == null : String(actual) === String(value);
  });
}
function model(name) {
  const rows = stores[name] = [];
  const clone = x => x == null ? x : structuredClone(x);
  const query = fn => ({ select() { return this; }, sort() { return this; }, lean() { return this; }, then(a, b) { return Promise.resolve(clone(fn())).then(a, b); } });
  const create = async data => {
    const row = { _id: crypto.randomBytes(12).toString('hex'), createdAt: new Date(), deletedAt: null, expiresAt: null, authVersion: 0, mfaEnabled: false, mfaLastStep: -1, ...data };
    if (name === 'User' && rows.some(x => x.username === data.username)) throw Object.assign(Error('duplicate'), { code: 11000 });
    rows.push(row); return clone(row);
  };
  function change(row, update) {
    Object.assign(row, update.$set || {});
    for (const [key, by] of Object.entries(update.$inc || {})) row[key] = (row[key] || 0) + by;
    for (const [key, value] of Object.entries(update.$pull || {})) row[key] = row[key].filter(x => x !== value);
  }
  return { create, find: q => query(() => rows.filter(x => matches(x, q))), findById: id => query(() => rows.find(x => x._id === String(id)) || null),
    findOne: q => query(() => rows.find(x => matches(x, q)) || null),
    findOneAndUpdate: (q, update, options = {}) => ({ select() { return this; }, async then(a, b) { try { let row = rows.find(x => matches(x, q)); if (!row && options.upsert) { await create(update.$setOnInsert); row = rows.at(-1); } if (row) change(row, update); return a(clone(row || null)); } catch (e) { return b(e); } } }),
    async updateOne(q, update) { const row = rows.find(x => matches(x, q)); if (row) change(row, update); },
    async updateMany(q, update) { const targets = rows.filter(x => matches(x, q)); targets.forEach(x => change(x, update)); return { modifiedCount: targets.length }; },
    async deleteOne(q) { const i = rows.findIndex(x => matches(x, q)); if (i >= 0) rows.splice(i, 1); },
    async deleteMany(q) { for (let i = rows.length - 1; i >= 0; --i) if (matches(rows[i], q)) rows.splice(i, 1); }
  };
}
for (const [file, name] of [['PortfolioUser', 'User'], ['PortfolioSession', 'Session'], ['PortfolioPost', 'Post'], ['PortfolioCollection', 'Collection'], ['PortfolioShare', 'Share']]) {
  const filePath = require.resolve('./models/' + file); require.cache[filePath] = { id: filePath, filename: filePath, loaded: true, exports: model(name) };
}
const { app, auth, sanitizeRichText } = require('./server');
const { createRateLimit, verifiedMediaType } = require('./security');
app.get('/fixture/rate', createRateLimit({ limit: 2 }), (req, res) => res.json({ success: true }));

(async () => {
  await auth.initializeAdmin(require('./models/PortfolioPost'));
  const serving = process.argv.includes('--serve');
  const server = app.listen(serving ? 4101 : 0, '127.0.0.1'); await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(route, { method = 'GET', body, headers = {}, cookie, tab } = {}) {
    if (cookie) headers.Cookie = cookie; if (tab) headers['X-Portfolio-Tab'] = tab;
    if (body !== undefined && !(body instanceof FormData)) { headers['Content-Type'] ||= 'application/json'; if (typeof body !== 'string') body = JSON.stringify(body); }
    const response = await fetch(base + route, { method, headers, body });
    const text = await response.text(); let data; try { data = JSON.parse(text); } catch { data = text; }
    return { status: response.status, headers: response.headers, data, cookie: response.headers.get('set-cookie')?.split(';')[0] };
  }
  async function login(name, code, admin = false) {
    const tab = crypto.randomUUID();
    const result = await call(admin ? '/api/auth/admin/login' : '/api/auth/login', { method: 'POST', body: { username: name, password: admin ? 'security-fixture-admin' : 'fixture-secure-pass', code, tabToken: tab } });
    const { headers: responseHeaders, ...rest } = result;
    return { ...rest, responseHeaders, tab };
  }
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'portfoliv-security-test-'));
  try {
    if (serving) { console.log('Security UI fixture ready: ' + base); return; }
    for (const route of ['/', '/share.html', '/api/auth/session']) {
      const r = await call(route); assert.equal(r.status, 200);
      assert.equal(r.headers.get('x-content-type-options'), 'nosniff'); assert.equal(r.headers.get('x-frame-options'), 'SAMEORIGIN');
      assert.equal(r.headers.get('referrer-policy'), 'no-referrer'); assert.equal(r.headers.get('x-powered-by'), null);
      assert.match(r.headers.get('content-security-policy'), /script-src 'self'/); assert.match(r.headers.get('content-security-policy'), /frame-ancestors 'none'/);
      assert.ok(!r.headers.get('content-security-policy').includes("script-src 'self' 'unsafe-inline'"));
    }
    assert.equal((await call('/.env')).status, 404);
    const cross = await call('/api/auth/register', { method: 'POST', headers: { 'Sec-Fetch-Site': 'cross-site' }, body: {} }); assert.equal(cross.status, 403);
    for (const origin of ['null', 'https://evil.example', base.replace('http:', 'https:'), base + '/wrong']) {
      assert.equal((await call('/api/auth/register', { method: 'POST', headers: { Origin: origin }, body: {} })).status, 403);
    }
    assert.equal((await call('/api/auth/login', { method: 'POST', body: '{invalid' })).status, 400);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: JSON.stringify({ x: 'x'.repeat(4 * 1024 * 1024) }) })).status, 413);
    assert.equal((await call('/api/auth/login', { method: 'POST', body: { username: { $ne: null }, password: { $ne: null } } })).status, 400);
    for (const username of ['alice', 'bob']) assert.equal((await call('/api/auth/register', { method: 'POST', headers: { Origin: base }, body: { username, password: 'fixture-secure-pass', passwordConfirm: 'fixture-secure-pass' } })).status, 201);
    const alice = await login('alice'), bob = await login('bob'), admin = await login('', undefined, true);
    assert.equal(alice.status, 200); assert.equal(bob.status, 200); assert.equal(admin.status, 200);
    assert.equal((await call('/api/posts?tab=' + alice.tab, { cookie: alice.cookie })).status, 401);
    assert.equal((await call('/api/account/security', bob)).data.enabled, false);
    assert.equal((await call('/api/account/security/setup', { ...alice, method: 'POST', body: { password: 'wrong' } })).status, 400);
    const setup = await call('/api/account/security/setup', { ...alice, method: 'POST', body: { password: 'fixture-secure-pass' } });
    assert.equal(setup.status, 200); assert.match(setup.data.qr, /^data:image\/png;base64,/);
    const secret = setup.data.secret; assert.match(secret, /^[A-Z2-7]{32}$/);
    assert.ok(!JSON.stringify(stores.Session).includes(secret));
    assert.equal((await call('/api/account/security/confirm', { ...bob, method: 'POST', body: { code: generateSync({ secret }) } })).status, 400);
    const enabled = await call('/api/account/security/confirm', { ...alice, method: 'POST', body: { code: generateSync({ secret }) } });
    assert.equal(enabled.status, 200); assert.equal(enabled.data.recoveryCodes.length, 10);
    assert.ok(!JSON.stringify(stores.User).includes(secret)); assert.ok(!JSON.stringify(stores.User).includes(enabled.data.recoveryCodes[0].replace(/-/g, '')));
    assert.equal((await login('alice')).status, 401);
    assert.equal((await login('alice', 'wrong')).status, 401);
    assert.equal((await call('/api/auth/login',{method:'POST',body:{username:'alice',password:'fixture-secure-pass',tabToken:crypto.randomUUID(),remember:true}})).status,401);
    // The enrollment code has already been consumed.
    assert.equal((await login('alice', generateSync({ secret }))).status, 401);
    const future = generateSync({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    const races = await Promise.all([login('alice', future), login('alice', future)]);
    assert.deepEqual(races.map(x => x.status).sort(), [200, 401]);
    const recovery = enabled.data.recoveryCodes[0];
    const recovered = await login('alice', recovery); assert.equal(recovered.status, 200); assert.equal((await login('alice', recovery)).status, 401);
    assert.equal((await call('/api/account/security', recovered)).data.enabled, true);
    const proof = stores.Session.find(x => x.tokenHash === crypto.createHash('sha256').update(recovered.cookie.split('=')[1]).digest('hex'));
    proof.mfaVerified = false; assert.equal((await call('/api/posts',recovered)).status,401);
    proof.mfaVerified = true;
    assert.equal((await call('/api/account/security', bob)).data.enabled, false);
    const disabled = await call('/api/account/security/disable', { ...recovered, method: 'POST', body: { password: 'fixture-secure-pass', code: enabled.data.recoveryCodes[1] } });
    assert.equal(disabled.status, 200); assert.equal((await call('/api/posts', races.find(x => x.status === 200))).status, 401);
    const legacy = stores.User.find(x => x.username === 'alice');
    legacy.passwordHash = (await require('node:util').promisify(crypto.scrypt)('fixture-secure-pass', legacy.passwordSalt, 64)).toString('hex'); delete legacy.passwordKdf;
    assert.equal((await login('alice')).status, 200); assert.equal(legacy.passwordKdf, 'scrypt-v2');
    // Admin enrollment is also password-gated, private, and uses the existing admin login.
    const adminSetup = await call('/api/account/security/setup', { ...admin, method: 'POST', body: { password: 'security-fixture-admin' } }); assert.equal(adminSetup.status, 200);
    const adminEnabled = await call('/api/account/security/confirm', { ...admin, method: 'POST', body: { code: generateSync({ secret: adminSetup.data.secret }) } }); assert.equal(adminEnabled.status, 200);
    assert.equal((await login('', undefined, true)).status, 401);
    assert.equal((await login('', adminEnabled.data.recoveryCodes[0], true)).status, 200);
    process.env.RENDER = 'true';
    const secure = await login('bob'); assert.equal(secure.status, 200); assert.match(secure.responseHeaders.get('set-cookie'), /; Secure/); delete process.env.RENDER;
    const mediaId = 'aaaaaaaaaaaaaaaaaaaaaaaa';
    const payloads = ['<script>alert(1)</script><p onclick="alert(1)">safe</p>', '<svg><a><foreignObject><img src=x onerror=alert(1)></foreignObject></a></svg>', '<math><mtext></math><img src="x" onerror="alert(1)">', '<a href="java&#x73;cript:alert(1)">link</a>', '<p style="background:url(javascript:alert(1));position:fixed;color:#123456;font-size:27px">safe</p>', '<img src="/api/media/' + mediaId + '" onerror="alert(1)"><iframe srcdoc="<script>alert(1)</script>"></iframe>'];
    for (const html of payloads) {
      const output = sanitizeRichText(html); assert.ok(!/<(?:script|svg|math|iframe|object)\b|\bon\w+=|javascript:|position:|background:/i.test(output), output);
    }
    assert.equal(sanitizeRichText('<p style="font-size:27px;font-weight:700;color:#123456">한글 &amp; <b>서식</b></p>'), '<p style="font-size:27px;font-weight:700;color:#123456">한글 &amp; <b>서식</b></p>');
    assert.ok(sanitizeRichText('<img src="/api/media/' + mediaId + '">', new Map(), new Set([mediaId])).includes(mediaId));
    await fs.writeFile(path.join(temp, 'fake'), '<script>alert(1)</script>');
    assert.equal(await verifiedMediaType({ path: path.join(temp, 'fake'), mimetype: 'image/png' }), 'application/octet-stream');
    assert.equal(await verifiedMediaType({ path: 'public/assets/favicon.png', mimetype: 'text/html' }), 'image/png');
    assert.equal((await call('/fixture/rate', { headers: { 'X-Forwarded-For': '1.1.1.1' } })).status, 200);
    assert.equal((await call('/fixture/rate', { headers: { 'X-Forwarded-For': '2.2.2.2' } })).status, 200);
    const limited = await call('/fixture/rate', { headers: { 'X-Forwarded-For': '3.3.3.3' } }); assert.equal(limited.status, 429); assert.ok(Number(limited.headers.get('retry-after')) > 0);
    // Encrypted backup round-trip with a fake mongodump, never a live database.
    const fixture = path.join(temp, 'mongodump');
    await fs.writeFile(fixture, '#!/usr/bin/env node\nprocess.stdout.write("fixture GridFS and database archive");\n', { mode: 0o700 });
    const oldPath = process.env.PATH; process.env.PATH = temp + path.delimiter + oldPath;
    process.env.MONGODB_URI = 'mongodb://127.0.0.1/fixture'; process.env.PORTFOLIV_BACKUP_PASSWORD = crypto.randomBytes(32).toString('hex');
    const backup = require('./scripts/database-backup.cjs'), encrypted = path.join(temp, 'archive.enc'), plain = path.join(temp, 'archive.gz');
    await backup.backup(encrypted); assert.equal((await fs.stat(encrypted)).mode & 0o777, 0o600);
    assert.ok(!(await fs.readFile(encrypted)).includes(Buffer.from('fixture GridFS')));
    await backup.decrypt(encrypted, plain); assert.equal(await fs.readFile(plain, 'utf8'), 'fixture GridFS and database archive');
    const changed = await fs.readFile(encrypted); changed[changed.length - 18] ^= 1; await fs.writeFile(encrypted, changed);
    const bad = path.join(temp, 'bad.gz'); await assert.rejects(backup.decrypt(encrypted, bad)); await assert.rejects(fs.access(bad));
    process.env.PATH = oldPath;
    console.log('PASS security: browser headers/CSP, CSRF/origin, JSON limits/types, tab restrictions, member/admin MFA, encrypted secrets, replay and recovery-code races, session invalidation, XSS, file signatures, IP spoofing limits and encrypted backup integrity.');
  } finally { if (!serving) server.close(); await fs.rm(temp, { recursive: true, force: true }); }
})().catch(error => { console.error(error); process.exitCode = 1; });
