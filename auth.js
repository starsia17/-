const crypto = require('crypto');
const { promisify } = require('util');
const scrypt = promisify(crypto.scrypt);
const IDLE_MS = 30 * 60 * 1000;
const COOKIE = 'portfolio_session';
const ADMIN_USERNAME = '__archive_admin__';
const digest = value => crypto.createHash('sha256').update(String(value)).digest('hex');
function equal(a, b) {
  const left = Buffer.from(a || ''), right = Buffer.from(b || '');
  return left.length === right.length && crypto.timingSafeEqual(left, right);
}
const publicUser = user => ({ id: String(user._id), username: user.kind === 'admin' ? '관리자' : user.username, kind: user.kind, canWriteNews: user.kind === 'admin' || user.canWriteNews === true });

module.exports = function createAuth(User, Session, adminPassword = '') {
  const attempts = new Map();
  function cookieToken(req) {
    const part = (req.headers.cookie || '').split(';').map(value => value.trim()).find(value => value.startsWith(`${COOKIE}=`));
    const value = part ? part.slice(COOKIE.length + 1) : '';
    return /^[a-f0-9]{64}$/.test(value) ? value : '';
  }
  function setCookie(res, token) {
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    // No Max-Age or Expires: browser-session cookie, never a persistent login cookie.
    res.setHeader('Set-Cookie', `${COOKIE}=${token}; HttpOnly; Path=/; SameSite=Strict${token ? '' : '; Max-Age=0'}${secure}`);
  }
  function rateLimit(req, res, next) {
    const now = Date.now(), key = `${req.path}:${req.ip}`;
    for (const [id, value] of attempts) if (value.until < now) attempts.delete(id);
    const value = attempts.get(key) || { count: 0, until: now + 15 * 60 * 1000 };
    if (++value.count > 12) return res.status(429).json({ success: false, message: '시도가 많습니다. 15분 후 다시 시도해주세요.' });
    attempts.set(key, value); next();
  }
  async function authenticate(req) {
    const token = cookieToken(req);
    if (!token) return null;
    const now = Date.now();
    const session = await Session.findOne({ tokenHash: digest(token), expiresAt: { $gt: new Date(now) }, lastSeenAt: { $gt: new Date(now - IDLE_MS) } });
    if (!session) return null;
    const tab = req.get('X-Portfolio-Tab') || req.query.tab || '';
    if (!session.remember && !equal(digest(tab), session.tabHash)) return null;
    const user = await User.findById(session.userId);
    if (!user) return null;
    if ((session.authVersion || 0) !== (user.authVersion || 0)) return null;
    await Session.updateOne({ _id: session._id }, { $set: { lastSeenAt: new Date(now), expiresAt: new Date(now + IDLE_MS) } });
    req.user = user; req.authSession = session;
    return user;
  }
  async function requireUser(req, res, next) {
    try {
      if (await authenticate(req)) return next();
      return res.status(401).json({ success: false, message: '로그인이 필요하거나 로그인 시간이 만료되었습니다.' });
    } catch (error) { next(error); }
  }
  async function issueSession(req, res, user) {
    const tab = String(req.body.tabToken || '');
    if (!/^[a-f\d-]{36}$/i.test(tab)) return res.status(400).json({ success: false, message: '로그인 화면을 새로고침한 뒤 다시 시도해주세요.' });
    const old = cookieToken(req);
    if (old) await Session.deleteOne({ tokenHash: digest(old) });
    const token = crypto.randomBytes(32).toString('hex');
    await Session.create({ tokenHash: digest(token), userId: user._id, tabHash: digest(tab), remember: req.body.remember === true, authVersion: user.authVersion || 0, lastSeenAt: new Date(), expiresAt: new Date(Date.now() + IDLE_MS) });
    setCookie(res, token);
    res.json({ success: true, user: publicUser(user), remember: req.body.remember === true });
  }
  function mount(app) {
    app.get('/api/auth/session', async (req, res, next) => {
      try {
        const user = await authenticate(req);
        res.json({ success: true, authenticated: !!user, user: user ? publicUser(user) : null });
      } catch (error) { next(error); }
    });
    app.post('/api/auth/register', rateLimit, async (req, res, next) => {
      try {
        const username = String(req.body.username || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return res.status(400).json({ success: false, message: '아이디는 영문·숫자로 시작하는 3~30자이며 ., _, -를 사용할 수 있어요.' });
        if (password.length < 8 || password.length > 128) return res.status(400).json({ success: false, message: '비밀번호는 8~128자로 입력해주세요.' });
        if (password !== req.body.passwordConfirm) return res.status(400).json({ success: false, message: '비밀번호 확인이 일치하지 않습니다.' });
        const salt = crypto.randomBytes(16).toString('hex');
        const hash = (await scrypt(password, salt, 64)).toString('hex');
        await User.create({ username, kind: 'member', passwordSalt: salt, passwordHash: hash });
        res.status(201).json({ success: true, message: '가입이 완료되었습니다. 만든 계정으로 로그인해주세요.' });
      } catch (error) {
        if (error.code === 11000) return res.status(409).json({ success: false, message: '이미 사용 중인 아이디입니다.' });
        next(error);
      }
    });
    app.post('/api/auth/login', rateLimit, async (req, res, next) => {
      try {
        const username = String(req.body.username || '').trim().toLowerCase();
        const password = String(req.body.password || '');
        if (password.length > 128) return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        const user = await User.findOne({ username, kind: 'member' }).select('+passwordHash +passwordSalt');
        const hash = (await scrypt(password, user?.passwordSalt || '00000000000000000000000000000000', 64)).toString('hex');
        if (!user || !equal(hash, user.passwordHash)) return res.status(401).json({ success: false, message: '아이디 또는 비밀번호가 올바르지 않습니다.' });
        await issueSession(req, res, user);
      } catch (error) { next(error); }
    });
    app.post('/api/auth/admin/login', rateLimit, async (req, res, next) => {
      try {
        const password = String(req.body.password || '');
        if (!adminPassword || password.length > 128 || !equal(password, adminPassword)) return res.status(401).json({ success: false, message: '관리자 비밀번호가 올바르지 않습니다.' });
        const user = await User.findOne({ username: ADMIN_USERNAME, kind: 'admin' });
        if (!user) return res.status(503).json({ success: false, message: '관리자 계정을 준비 중입니다. 잠시 후 다시 시도해주세요.' });
        await issueSession(req, res, user);
      } catch (error) { next(error); }
    });
    app.post('/api/auth/logout', async (req, res, next) => {
      try { const token = cookieToken(req); if (token) await Session.deleteOne({ tokenHash: digest(token) }); setCookie(res, ''); res.json({ success: true }); }
      catch (error) { next(error); }
    });
  }
  async function initializeAdmin(Post) {
    if (!adminPassword) return;
    const user = await User.findOneAndUpdate({ username: ADMIN_USERNAME }, { $setOnInsert: { username: ADMIN_USERNAME, kind: 'admin' } }, { upsert: true, new: true });
    await Post.updateMany({ ownerId: null }, { $set: { ownerId: user._id } });
  }
  return { mount, requireUser, initializeAdmin, rateLimit, IDLE_MS };
};
