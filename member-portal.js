const crypto = require('crypto');
const scrypt = require('util').promisify(crypto.scrypt);
const PERIOD_MS = 14 * 24 * 60 * 60 * 1000;
function changeWindow(user, now = Date.now()) {
  const anchor = new Date(user.createdAt).getTime();
  const start = anchor + Math.max(0, Math.floor((now - anchor) / PERIOD_MS)) * PERIOD_MS;
  const used = new Date(user.accountChangeWindowStart || 0).getTime() === start ? (user.accountChangeCount || 0) : 0;
  return { limit: 2, used, remaining: Math.max(0, 2 - used), windowStartedAt: new Date(start), resetsAt: new Date(start + PERIOD_MS) };
}
function profile(user) {
  return { id: String(user._id), username: user.kind === 'admin' ? '관리자' : user.username, kind: user.kind, createdAt: user.createdAt, canWriteNews: user.kind === 'admin' || user.canWriteNews === true };
}
function equal(a, b) { const left = Buffer.from(a || ''), right = Buffer.from(b || ''); return left.length === right.length && crypto.timingSafeEqual(left, right); }
module.exports = function mountPortal(app, User, Session, News, auth) {
  const requireAdmin = (req, res, next) => req.user.kind === 'admin' ? next() : res.status(403).json({ success: false, message: '관리자만 사용할 수 있습니다.' });
  app.get('/api/account', auth.requireUser, (req, res) => {
    res.json({ success: true, user: profile(req.user), changes: req.user.kind === 'member' ? changeWindow(req.user) : null });
  });
  app.patch('/api/account', auth.requireUser, auth.rateLimit, async (req, res, next) => {
    if (req.user.kind !== 'member') return res.status(403).json({ success: false, message: '기존 관리자 로그인은 서버에 설정한 관리자 비밀번호를 사용합니다.' });
    try {
      const user = await User.findById(req.user._id).select('+passwordHash +passwordSalt');
      if (!user) return res.status(401).json({ success: false, message: '계정을 찾을 수 없습니다. 다시 로그인해주세요.' });
      const currentPassword = typeof req.body.currentPassword === 'string' ? req.body.currentPassword : '';
      const username = typeof req.body.username === 'string' ? req.body.username.trim().toLowerCase() : user.username;
      const password = typeof req.body.password === 'string' ? req.body.password : '';
      const confirm = typeof req.body.passwordConfirm === 'string' ? req.body.passwordConfirm : '';
      if (!currentPassword || currentPassword.length > 128) return res.status(400).json({ success: false, message: '현재 비밀번호를 입력해주세요.' });
      const currentHash = (await scrypt(currentPassword, user.passwordSalt, 64)).toString('hex');
      if (!equal(currentHash, user.passwordHash)) return res.status(400).json({ success: false, message: '현재 비밀번호가 올바르지 않습니다.' });
      if (!/^[a-z0-9][a-z0-9._-]{2,29}$/.test(username)) return res.status(400).json({ success: false, message: '아이디는 영문·숫자로 시작하는 3~30자이며 ., _, -를 사용할 수 있어요.' });
      if ((password && (password.length < 8 || password.length > 128)) || password !== confirm) return res.status(400).json({ success: false, message: '새 비밀번호는 8~128자이며 비밀번호 확인과 일치해야 합니다.' });
      const newPassword = password && password !== currentPassword;
      if (username === user.username && !newPassword) return res.status(400).json({ success: false, message: '변경할 아이디 또는 새 비밀번호를 입력해주세요.' });
      const quota = changeWindow(user);
      if (!quota.remaining) return res.status(429).json({ success: false, message: '이번 2주 동안의 변경 횟수를 모두 사용했습니다. 다음 초기화 날짜 이후 변경해주세요.', changes: quota });
      const oldVersion = user.authVersion || 0;
      const fields = { username, authVersion: oldVersion + 1, accountChangeWindowStart: quota.windowStartedAt, accountChangeCount: quota.used + 1 };
      if (newPassword) {
        fields.passwordSalt = crypto.randomBytes(16).toString('hex');
        fields.passwordHash = (await scrypt(password, fields.passwordSalt, 64)).toString('hex');
      }
      // Version comparison prevents parallel saves from exceeding the quota.
      const query = { _id: user._id, kind: 'member', username: user.username, passwordHash: user.passwordHash };
      if (oldVersion === 0) query.$or = [{ authVersion: 0 }, { authVersion: { $exists: false } }];
      else query.authVersion = oldVersion;
      const updated = await User.findOneAndUpdate(query, { $set: fields }, { new: true, runValidators: true });
      if (!updated) return res.status(409).json({ success: false, message: '다른 화면에서 계정 정보가 변경되었습니다. 다시 로그인한 후 확인해주세요.' });
      // Only the current session remains valid after a credential change.
      await Session.updateOne({ _id: req.authSession._id, userId: user._id }, { $set: { authVersion: updated.authVersion } });
      res.json({ success: true, user: profile(updated), changes: changeWindow(updated) });
    } catch (error) {
      if (error.code === 11000) return res.status(409).json({ success: false, message: '이미 사용 중인 아이디입니다. 변경 횟수는 차감되지 않았습니다.' });
      next(error);
    }
  });
  app.get('/api/admin/users', auth.requireUser, requireAdmin, async (req, res, next) => {
    try {
      const users = await User.find({ kind: 'member' }).select('_id username kind createdAt canWriteNews').sort({ createdAt: -1, _id: -1 }).lean();
      res.json({ success: true, users: users.map(profile) });
    } catch (error) { next(error); }
  });
  app.patch('/api/admin/users/:id/news-permission', auth.requireUser, requireAdmin, async (req, res, next) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id) || typeof req.body.canWriteNews !== 'boolean') return res.status(400).json({ success: false, message: '회원과 권한 설정을 확인해주세요.' });
    try {
      const user = await User.findOneAndUpdate({ _id: req.params.id, kind: 'member' }, { $set: { canWriteNews: req.body.canWriteNews } }, { new: true, runValidators: true });
      if (!user) return res.status(404).json({ success: false, message: '회원을 찾을 수 없습니다.' });
      res.json({ success: true, user: profile(user) });
    } catch (error) { next(error); }
  });
  const newsView = item => ({ _id: item._id, title: item.title, content: item.content, sourceUrl: item.sourceUrl, authorName: item.authorName, createdAt: item.createdAt });
  app.get('/api/news', auth.requireUser, async (req, res, next) => {
    try {
      const news = await News.find({}).sort({ createdAt: -1, _id: -1 }).lean();
      res.json({ success: true, news: news.map(newsView), canWrite: req.user.kind === 'admin' || req.user.canWriteNews === true });
    } catch (error) { next(error); }
  });
  app.post('/api/news', auth.requireUser, async (req, res, next) => {
    if (req.user.kind !== 'admin' && req.user.canWriteNews !== true) return res.status(403).json({ success: false, message: '오늘의 뉴스 작성 권한이 없습니다. 관리자에게 권한을 요청해주세요.' });
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    let sourceUrl = typeof req.body.sourceUrl === 'string' ? req.body.sourceUrl.trim() : '';
    if (!title || title.length > 120 || !content || content.length > 25000 || sourceUrl.length > 2048) return res.status(400).json({ success: false, message: '제목은 1~120자, 본문은 1~25,000자로 입력해주세요.' });
    if (sourceUrl) {
      try { const url = new URL(sourceUrl); if (url.protocol !== 'https:' || url.username || url.password || url.href.length > 2048) throw Error(); sourceUrl = url.href; }
      catch { return res.status(400).json({ success: false, message: '원문 링크는 올바른 HTTPS 주소로 입력해주세요.' }); }
    }
    try {
      const news = await News.create({ title, content, sourceUrl, authorId: req.user._id, authorName: req.user.kind === 'admin' ? '관리자' : req.user.username });
      res.status(201).json({ success: true, news: newsView(news) });
    } catch (error) { next(error); }
  });
};
