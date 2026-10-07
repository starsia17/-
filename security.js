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
    next();
  });
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

module.exports = { configureSecurity, createRateLimit, verifiedMediaType, production };
