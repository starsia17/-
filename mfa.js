const crypto = require('node:crypto');
const otp = require('otplib');
const QRCode = require('qrcode');

const hash = value => crypto.createHash('sha256').update(value).digest('hex');
function encryptionKey() {
  const secret = process.env.PORTFOLIO_MFA_SECRET || process.env.ADMIN_SESSION_SECRET || '';
  if (secret.length < 32) throw Object.assign(Error('2단계 인증을 사용하려면 서버의 2단계 인증 암호화 키 설정이 필요합니다.'), { status: 503 });
  return crypto.createHash('sha256').update(secret).digest();
}
function encrypt(secret, ownerId) {
  const iv = crypto.randomBytes(12), cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(String(ownerId)));
  const data = Buffer.concat([cipher.update(secret, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), data].map(x => x.toString('base64url')).join('.');
}
function decrypt(value, ownerId) {
  const [iv, tag, data] = value.split('.').map(x => Buffer.from(x, 'base64url'));
  const cipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), iv);
  cipher.setAAD(Buffer.from(String(ownerId))); cipher.setAuthTag(tag);
  return Buffer.concat([cipher.update(data), cipher.final()]).toString('utf8');
}
function requiresMfa(user) { return !!user && (user.mfaEnabled === true || (typeof user.mfaSecret === 'string' && user.mfaSecret.length > 0)); }
function validCode(code) { return typeof code === 'string' && /^\d{6}$/.test(code); }
function codeStep(code, secret) {
  if (!validCode(code)) return null;
  const result = otp.verifySync({ token: code, secret, epochTolerance: 30 });
  return result.valid ? result.timeStep : null;
}

module.exports = function createMfa(User, Session, auth) {
  const attempts = new Map(); let lastSweep = 0;
  function reserveAttempt(id) {
    const now = Date.now();
    if (now - lastSweep > 60000) { for (const [key, value] of attempts) if (value.until <= now) attempts.delete(key); lastSweep = now; }
    const previous = attempts.get(id);
    const value = previous && previous.until > now ? previous : { count: 0, until: now + 10 * 60000 };
    if (value.count >= 10 || (!previous && attempts.size >= 10000)) throw Object.assign(Error('인증 시도가 많습니다. 10분 후 다시 시도해주세요.'), { code: 'MFA_RATE_LIMITED' });
    ++value.count; attempts.set(id, value);
  }
  async function verify(user, code) {
    // Always read persisted enrollment; projected or stale flags must never bypass MFA.
    // Atomic consumption prevents concurrent login/disable requests from replaying a code.
    const stored = await User.findById(user._id).select('+mfaSecret +mfaRecoveryHashes');
    if (!stored || (stored.authVersion || 0) !== (user.authVersion || 0)) return false;
    const required = requiresMfa(stored);
    user.mfaEnabled = required;
    if (!required) return true;
    const identity = String(stored._id); reserveAttempt(identity);
    const accept = result => { if (result) attempts.delete(identity); return !!result; };
    if (!stored.mfaSecret) return false;
    const normalized = typeof code === 'string' ? code.replace(/-/g, '').toLowerCase() : '';
    if (/^[a-f\d]{32}$/.test(normalized)) {
      const recoveryHash = hash(normalized);
      return accept(await User.findOneAndUpdate({ _id: user._id, mfaSecret: stored.mfaSecret, authVersion: stored.authVersion || 0, mfaRecoveryHashes: recoveryHash }, { $set: { mfaEnabled: true }, $pull: { mfaRecoveryHashes: recoveryHash } }));
    }
    const step = codeStep(code, decrypt(stored.mfaSecret, user._id));
    if (step === null) return false;
    return accept(await User.findOneAndUpdate({ _id: user._id, mfaSecret: stored.mfaSecret, authVersion: stored.authVersion || 0, mfaLastStep: { $lt: step } }, { $set: { mfaLastStep: step, mfaEnabled: true } }));
  }
  async function passwordGate(req, res) {
    if (!await auth.verifyPassword(req.user, req.body.password)) {
      res.status(400).json({ success: false, message: '현재 비밀번호가 올바르지 않습니다.' }); return false;
    }
    return true;
  }
  async function invalidateSessions(req, updated) {
    await Session.updateOne({ _id: req.authSession._id, userId: req.user._id }, { $set: { authVersion: updated.authVersion, mfaVerified: updated.mfaEnabled === true, mfaSetupSecret: null, mfaSetupExpiresAt: null } });
    // authVersion invalidates every other session even if deletion temporarily fails.
    await Session.deleteMany({ userId: req.user._id, _id: { $ne: req.authSession._id } });
  }
  function mount(app) {
    app.get('/api/account/security', auth.requireUser, (req, res) => {
      res.json({ success: true, enabled: req.user.mfaEnabled === true, available: (process.env.PORTFOLIO_MFA_SECRET || process.env.ADMIN_SESSION_SECRET || '').length >= 32 });
    });
    app.post('/api/account/security/setup', auth.requireUser, auth.rateLimit, async (req, res, next) => {
      try {
        if (!await passwordGate(req, res)) return;
        if (req.user.mfaEnabled) return res.status(409).json({ success: false, message: '이미 2단계 인증이 설정되어 있습니다.' });
        const secret = otp.generateSecret();
        const encrypted = encrypt(secret, req.user._id);
        await Session.updateOne({ _id: req.authSession._id, userId: req.user._id }, { $set: { mfaSetupSecret: encrypted, mfaSetupExpiresAt: new Date(Date.now() + 10 * 60000) } });
        const label = req.user.kind === 'admin' ? '관리자' : req.user.username;
        const uri = otp.generateURI({ label, issuer: '포트폴리브', secret });
        res.json({ success: true, secret, qr: await QRCode.toDataURL(uri, { width: 240, margin: 2 }), expiresIn: 600 });
      } catch (error) { next(error); }
    });
    app.post('/api/account/security/confirm', auth.requireUser, auth.rateLimit, async (req, res, next) => {
      try {
        const session = await Session.findById(req.authSession._id).select('+mfaSetupSecret');
        if (!session?.mfaSetupSecret || !(session.mfaSetupExpiresAt > new Date())) return res.status(400).json({ success: false, message: '설정 시간이 만료되었습니다. 처음부터 다시 설정해주세요.' });
        const step = codeStep(req.body.code, decrypt(session.mfaSetupSecret, req.user._id));
        if (step === null) return res.status(400).json({ success: false, message: '인증 앱의 6자리 코드를 확인해주세요.' });
        const recoveryCodes = Array.from({ length: 10 }, () => crypto.randomBytes(16).toString('hex'));
        const updated = await User.findOneAndUpdate({ _id: req.user._id, authVersion: req.user.authVersion || 0, mfaEnabled: { $ne: true } }, {
          $set: { mfaEnabled: true, mfaSecret: session.mfaSetupSecret, mfaLastStep: step, mfaRecoveryHashes: recoveryCodes.map(hash) }, $inc: { authVersion: 1 }
        }, { new: true });
        if (!updated) return res.status(409).json({ success: false, message: '계정이 다른 화면에서 변경되었습니다. 다시 로그인해주세요.' });
        await invalidateSessions(req, updated);
        res.json({ success: true, recoveryCodes: recoveryCodes.map(x => x.match(/.{8}/g).join('-')) });
      } catch (error) { next(error); }
    });
    app.post('/api/account/security/disable', auth.requireUser, auth.rateLimit, async (req, res, next) => {
      try {
        if (!await passwordGate(req, res)) return;
        if (!req.user.mfaEnabled || !await verify(req.user, req.body.code)) return res.status(400).json({ success: false, message: '인증 코드 또는 미사용 복구 코드를 확인해주세요.' });
        const updated = await User.findOneAndUpdate({ _id: req.user._id, authVersion: req.user.authVersion || 0, mfaEnabled: true }, {
          $set: { mfaEnabled: false, mfaSecret: null, mfaRecoveryHashes: [], mfaLastStep: -1 }, $inc: { authVersion: 1 }
        }, { new: true });
        if (!updated) return res.status(409).json({ success: false, message: '계정이 다른 화면에서 변경되었습니다. 다시 로그인해주세요.' });
        await invalidateSessions(req, updated);
        res.json({ success: true });
      } catch (error) { next(error); }
    });
  }
  return { mount, verify };
};
module.exports.encrypt = encrypt;
module.exports.decrypt = decrypt;
module.exports.codeStep = codeStep;

module.exports.requiresMfa = requiresMfa;
