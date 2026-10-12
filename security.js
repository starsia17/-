const helmet = require('helmet');
const fs = require('node:fs/promises');

const production = () => process.env.NODE_ENV === 'production' || process.env.RENDER === 'true';

function configureSecurity(app) {
  app.disable('x-powered-by');
  // Render terminates TLS at its reverse proxy. Never trust arbitrary forwarded chains.
  app.set('trust proxy', production() ? 1 : false);
  app.use(helmet({
    strictTransportSecurity: production() ? { maxAge: 31536000, includeSubDomains: false } : false,
    referrerPolicy: { policy: 'no-referrer' },
    contentSecurityPolicy: { directives: {
      defaultSrc: ["'self'"], scriptSrc: ["'self'"], scriptSrcAttr: ["'none'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ["'self'", 'https://fonts.gstatic.com'], imgSrc: ["'self'", 'data:', 'blob:', 'https:'],
      mediaSrc: ["'self'", 'blob:', 'https:'], connectSrc: ["'self'"],
      frameSrc: ['https://www.youtube-nocookie.com', 'https://player.vimeo.com'],
      objectSrc: ["'none'"], baseUri: ["'self'"], formAction: ["'self'"], frameAncestors: ["'none'"],
      upgradeInsecureRequests: production() ? [] : null
    } }
  }));
  app.use((req, res, next) => {
    res.set('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=()');
    if (req.originalUrl.length > 4096) return res.status(414).send('요청 주소가 너무 깁니다.');
    next();
  });
  const health = req => req.method === 'GET' && req.originalUrl.split('?')[0] === '/api/health';
  const outsideHealth = limiter => (req, res, next) => health(req) ? next() : limiter(req, res, next);
  // Cheap health checks have a separate budget, so busy media/API slots cannot starve probes.
  const healthGlobal = createRateLimit({ limit: 20, windowMs: 1000, maxKeys: 1, key: () => 'health' });
  const healthIp = createRateLimit({ limit: 60, windowMs: 60000 });
  app.use((req, res, next) => {
    if (!health(req)) return next();
    if (req.headers['transfer-encoding'] || (req.headers['content-length'] && req.headers['content-length'] !== '0')) return res.status(400).end();
    healthGlobal(req, res, () => healthIp(req, res, next));
  });
  // All paths, including static files and unknown paths, are bounded before parsing or DB work.
  app.use(outsideHealth(createTokenBucket({ capacity: 300, refillPerSecond: 150, maxKeys: 1, key: () => 'instance' })));
  app.use(outsideHealth(createConcurrencyLimit(128)));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    next();
  });
  // Global admission precedes per-IP accounting to limit map growth under distributed floods.
  app.use('/api', outsideHealth(createTokenBucket({ capacity: 120, refillPerSecond: 60, maxKeys: 1, key: () => 'api' })));
  app.use('/api', outsideHealth(createRateLimit({ limit: 600, windowMs: 60000 })));
  app.use('/api', outsideHealth(createConcurrencyLimit(40)));
  app.use('/api', outsideHealth(createIpConcurrencyLimit(24)));
  app.use('/api', (req, res, next) => {
    res.set('Cache-Control', 'private, no-store');
    res.vary('Cookie'); res.vary('X-Portfolio-Tab');
    if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
    if (req.get('Sec-Fetch-Site') === 'cross-site') return forbidden(res);
    if (req.headers.origin !== undefined) {
      try {
        const origin = new URL(req.headers.origin);
        const expected = production() ? new URL('https://portfoliv.onrender.com') : new URL(`${req.protocol}://${req.get('host')}`);
        if (origin.origin !== expected.origin || origin.username || origin.password || origin.pathname !== '/' || origin.search || origin.hash) return forbidden(res);
      } catch { return forbidden(res); }
    }
    next();
  });
}

function createConcurrencyLimit(limit) {
  let active = 0;
  return (req, res, next) => {
    if (active >= limit) {
      res.set('Retry-After', '2');
      return res.status(503).json({ success: false, message: '접속 요청이 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    ++active;
    let released = false;
    const release = () => { if (!released) { released = true; --active; } };
    res.once('finish', release); res.once('close', release); next();
  };
}

function createIpConcurrencyLimit(limit) {
  const active = new Map();
  return (req, res, next) => {
    const id = req.ip, count = active.get(id) || 0;
    if (count >= limit) {
      res.set('Retry-After', '2');
      return res.status(503).json({ success: false, message: '동시 접속 요청이 많습니다. 잠시 후 다시 시도해주세요.' });
    }
    active.set(id, count + 1);
    let released = false;
    const release = () => {
      if (released) return; released = true;
      const remaining = (active.get(id) || 1) - 1;
      if (remaining) active.set(id, remaining); else active.delete(id);
    };
    res.once('finish', release); res.once('close', release); next();
  };
}

function createBodyBudget({ limitBytes = 16 * 1024 * 1024, maxRequestBytes = 4 * 1024 * 1024 } = {}) {
  let reserved = 0;
  return (req, res, next) => {
    if (!req.is('application/json') || (!req.headers['content-length'] && !req.headers['transfer-encoding'])) return next();
    const length = Number(req.headers['content-length']);
    if (req.headers['content-length'] !== undefined && (!Number.isSafeInteger(length) || length < 0)) return res.status(400).json({ success: false, message: '요청 크기 형식이 올바르지 않습니다.' });
    if (length > maxRequestBytes) return res.status(413).json({ success: false, message: '요청이 허용 크기를 초과했습니다.' });
    const cost = req.headers['transfer-encoding'] ? maxRequestBytes : Math.max(0, length);
    if (reserved + cost > limitBytes) {
      res.set('Retry-After', '2');
      return res.status(503).json({ success: false, message: '큰 요청이 처리 중입니다. 잠시 후 다시 시도해주세요.' });
    }
    reserved += cost;
    let released = false;
    const release = () => { if (!released) { released = true; reserved -= cost; } };
    res.once('finish', release); res.once('close', release); next();
  };
}

function createTokenBucket({ capacity, refillPerSecond, maxKeys = 10000, key = req => req.ip, clock = () => performance.now() }) {
  if (!(capacity > 0) || !(refillPerSecond > 0) || !(maxKeys > 0)) throw Error('Invalid request bucket limits');
  const buckets = new Map();
  const idleMs = Math.max(60000, capacity / refillPerSecond * 1000);
  let lastSweep = -Infinity;
  return (req, res, next) => {
    const now = clock();
    if (now - lastSweep >= 60000) {
      for (const [id, value] of buckets) if (now - value.seen >= idleMs) buckets.delete(id);
      lastSweep = now;
    }
    const id = key(req);
    let value = buckets.get(id);
    if (!value) {
      if (buckets.size >= maxKeys) return deny(res, 1000);
      value = { tokens: capacity, seen: now };
      buckets.set(id, value);
    }
    value.tokens = Math.min(capacity, value.tokens + Math.max(0, now - value.seen) / 1000 * refillPerSecond);
    value.seen = now;
    if (value.tokens < 1) return deny(res, (1 - value.tokens) / refillPerSecond * 1000);
    --value.tokens; next();
  };
}

function forbidden(res) { return res.status(403).json({ success: false, message: '허용되지 않은 요청입니다.' }); }

// Bounded storage, periodic cleanup, and a shared IP bucket across all authentication routes.
function createRateLimit({ limit = 30, windowMs = 15 * 60 * 1000, maxKeys = 10000, key = req => req.ip } = {}) {
  const attempts = new Map();
  let lastSweep = 0;
  return (req, res, next) => {
    const now = Date.now();
    if (now - lastSweep > 60000) {
      for (const [id, value] of attempts) if (value.until <= now) attempts.delete(id);
      lastSweep = now;
    }
    const id = key(req), previous = attempts.get(id);
    if (!previous && attempts.size >= maxKeys) return deny(res, windowMs);
    const value = previous && previous.until > now ? previous : { count: 0, until: now + windowMs };
    attempts.set(id, value);
    if (++value.count > limit) return deny(res, value.until - now);
    next();
  };
}
function deny(res, wait) {
  res.set('Retry-After', String(Math.max(1, Math.ceil(wait / 1000))));
  return res.status(429).json({ success: false, message: '시도가 많습니다. 잠시 후 다시 시도해주세요.' });
}

async function verifiedMediaType(file) {
  const handle = await fs.open(file.path, 'r');
  const bytes = Buffer.alloc(512);
  let length;
  try { ({ bytesRead: length } = await handle.read(bytes, 0, bytes.length, 0)); } finally { await handle.close(); }
  const b = bytes.subarray(0, length), ascii = (start, end) => b.toString('ascii', start, end);
  let detected = 'application/octet-stream';
  if (b.length >= 8 && b.subarray(0, 8).equals(Buffer.from([137,80,78,71,13,10,26,10]))) detected = 'image/png';
  else if (b.length >= 3 && b[0] === 255 && b[1] === 216 && b[2] === 255) detected = 'image/jpeg';
  else if (['GIF87a', 'GIF89a'].includes(ascii(0, 6))) detected = 'image/gif';
  else if (ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') detected = 'image/webp';
  else if (b.length >= 12 && ascii(4, 8) === 'ftyp') {
    const brands = ascii(8, b.length).match(/.{4}/g) || [];
    if (brands.includes('qt  ')) detected = 'video/quicktime';
    else if (brands.some(x => ['isom','iso2','mp41','mp42','avc1','M4V '].includes(x))) detected = 'video/mp4';
  } else if (b.length >= 4 && b.subarray(0, 4).equals(Buffer.from([26,69,223,163])) && b.includes(Buffer.from('webm'))) detected = 'video/webm';
  return detected;
}

module.exports = { configureSecurity, createRateLimit, createConcurrencyLimit, createIpConcurrencyLimit, createTokenBucket, createBodyBudget, verifiedMediaType, production };
