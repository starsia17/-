require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const multer = require('multer');
const { v4: uuidv4 } = require('uuid');
const PortfolioPost = require('./models/PortfolioPost');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;
const ADMIN_PASSWORD = process.env.PORTFOLIO_ADMIN_PASSWORD || '';
const ADMIN_SESSION_SECRET = process.env.ADMIN_SESSION_SECRET || '';
const loginAttempts = new Map();
const TEMP_UPLOAD_DIR = path.join(os.tmpdir(), 'creative-work-archive-uploads');
const GRIDFS_BUCKET_NAME = 'portfolioMedia';
let mediaBucket;
const allowedMediaTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime'
]);

fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ database: connected ? 'connected' : 'disconnected' });
});

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, TEMP_UPLOAD_DIR),
  filename: (req, file, callback) => callback(null, `${uuidv4()}${path.extname(file.originalname).toLowerCase()}`)
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10 },
  fileFilter: (req, file, callback) => {
    if (allowedMediaTypes.has(file.mimetype)) return callback(null, true);
    callback(new Error('지원하지 않는 파일 형식입니다.'));
  }
});

function adminSessionToken(expiresAt) {
  const payload = Buffer.from(JSON.stringify({ expiresAt })).toString('base64url');
  const signature = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest('base64url');
  return `${payload}.${signature}`;
}

function isAdminRequest(req) {
  if (!ADMIN_SESSION_SECRET) return false;
  const cookie = (req.headers.cookie || '').split(';').map(value => value.trim())
    .find(value => value.startsWith('portfolio_admin='));
  if (!cookie) return false;
  let token;
  try { token = decodeURIComponent(cookie.slice('portfolio_admin='.length)); } catch { return false; }
  const [payload, suppliedSignature] = token.split('.');
  if (!payload || !suppliedSignature) return false;
  const expectedSignature = crypto.createHmac('sha256', ADMIN_SESSION_SECRET).update(payload).digest();
  let actualSignature;
  try { actualSignature = Buffer.from(suppliedSignature, 'base64url'); } catch { return false; }
  if (actualSignature.length !== expectedSignature.length || !crypto.timingSafeEqual(actualSignature, expectedSignature)) return false;
  try { return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')).expiresAt > Date.now(); }
  catch { return false; }
}

function requireAdmin(req, res, next) {
  if (isAdminRequest(req)) return next();
  res.status(401).json({ success: false, message: '게시물을 등록하려면 관리자 로그인이 필요합니다.' });
}

app.get('/api/admin/status', (req, res) => {
  res.json({ configured: Boolean(ADMIN_PASSWORD && ADMIN_SESSION_SECRET), authenticated: isAdminRequest(req) });
});

app.post('/api/admin/login', (req, res) => {
  if (!ADMIN_PASSWORD || !ADMIN_SESSION_SECRET) {
    return res.status(503).json({ success: false, message: 'PORTFOLIO_ADMIN_PASSWORD와 ADMIN_SESSION_SECRET 환경 변수를 먼저 설정해주세요.' });
  }
  const clientIp = req.ip || req.socket.remoteAddress || 'unknown';
  const now = Date.now();
  let attempts = loginAttempts.get(clientIp);
  if (!attempts || attempts.resetAt <= now) attempts = { count: 0, resetAt: now + 15 * 60 * 1000 };
  if (attempts.count >= 8) return res.status(429).json({ success: false, message: '로그인 시도가 많습니다. 15분 후 다시 시도해주세요.' });
  const submitted = Buffer.from(String(req.body.password || ''));
  const expected = Buffer.from(ADMIN_PASSWORD);
  if (submitted.length !== expected.length || !crypto.timingSafeEqual(submitted, expected)) {
    attempts.count += 1;
    loginAttempts.set(clientIp, attempts);
    return res.status(401).json({ success: false, message: '관리자 비밀번호가 올바르지 않습니다.' });
  }
  loginAttempts.delete(clientIp);
  const expiresAt = Date.now() + 12 * 60 * 60 * 1000;
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `portfolio_admin=${encodeURIComponent(adminSessionToken(expiresAt))}; HttpOnly; Path=/; SameSite=Lax; Max-Age=43200${secure}`);
  res.json({ success: true });
});

app.post('/api/admin/logout', (req, res) => {
  const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
  res.setHeader('Set-Cookie', `portfolio_admin=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0${secure}`);
  res.json({ success: true });
});

app.get('/api/posts', async (req, res) => {
  try {
    const posts = await PortfolioPost.find().sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, posts: posts.map(serializePost) });
  } catch (err) {
    res.status(500).json({ success: false, message: '게시물을 불러오지 못했습니다.' });
  }
});

app.get('/api/media/:id', async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
    return res.status(400).json({ success: false, message: '올바르지 않은 미디어 ID입니다.' });
  }
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.id);
    const file = await mediaBucket.find({ _id: fileId }).next();
    if (!file) return res.status(404).json({ success: false, message: '미디어 파일을 찾을 수 없습니다.' });
    let start = 0;
    let end = file.length - 1;
    let status = 200;
    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match || (!match[1] && !match[2])) {
        res.set('Content-Range', `bytes */${file.length}`);
        return res.status(416).end();
      }
      if (!match[1]) {
        const suffixLength = Number(match[2]);
        if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) {
          res.set('Content-Range', `bytes */${file.length}`);
          return res.status(416).end();
        }
        start = Math.max(file.length - suffixLength, 0);
      } else {
        start = Number(match[1]);
        end = match[2] ? Math.min(Number(match[2]), file.length - 1) : file.length - 1;
      }
      if (!Number.isSafeInteger(start) || !Number.isSafeInteger(end) || start < 0 || start >= file.length || start > end) {
        res.set('Content-Range', `bytes */${file.length}`);
        return res.status(416).end();
      }
      status = 206;
      res.set('Content-Range', `bytes ${start}-${end}/${file.length}`);
    }
    res.set({
      'Content-Type': allowedMediaTypes.has(file.metadata?.contentType) ? file.metadata.contentType : 'application/octet-stream',
      'Content-Length': String(Math.max(0, end - start + 1)),
      'Content-Disposition': 'inline',
      'X-Content-Type-Options': 'nosniff',
      'Accept-Ranges': 'bytes',
      'Cache-Control': 'public, max-age=31536000, immutable'
    });
    const download = mediaBucket.openDownloadStream(fileId, { start, end: end + 1 });
    download.on('error', error => {
      if (res.headersSent) res.destroy(error);
      else res.status(404).end();
    });
    download.pipe(res.status(status));
  } catch (err) {
    res.status(500).json({ success: false, message: '미디어 파일을 불러오지 못했습니다.' });
  }
});

app.post('/api/posts', requireAdmin, upload.array('media', 10), async (req, res) => {
  const uploadedIds = [];
  try {
    const title = (req.body.title || '').trim();
    const description = (req.body.description || '').trim();
    const category = (req.body.category || '기타').trim();
    if (!title) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '작업 제목을 입력해주세요.' });
    }
    if (title.length > 120 || description.length > 5000 || category.length > 40) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '입력한 내용이 허용 길이를 초과했습니다.' });
    }

    const media = [];
    for (const file of req.files || []) {
      const stored = await storeMediaFile(file, uploadedIds);
      media.push(stored);
    }
    const post = await PortfolioPost.create({ title, description, category, media });
    await cleanupTempFiles(req.files);
    res.status(201).json({ success: true, post: serializePost(post) });
  } catch (err) {
    await Promise.all([
      cleanupTempFiles(req.files),
      cleanupGridFsFiles(uploadedIds)
    ]);
    res.status(500).json({ success: false, message: '게시물을 저장하지 못했습니다.' });
  }
});

function serializePost(post) {
  const value = post.toObject ? post.toObject() : post;
  return {
    ...value,
    media: (value.media || []).map(({ fileId, ...item }) => ({ ...item, url: `/api/media/${fileId}` }))
  };
}

async function storeMediaFile(file, uploadedIds) {
  const stream = mediaBucket.openUploadStream(file.filename, {
    metadata: { contentType: file.mimetype }
  });
  uploadedIds.push(stream.id);
  const completed = new Promise((resolve, reject) => {
    let settled = false;
    const source = fs.createReadStream(file.path);
    const fail = error => {
      if (settled) return;
      settled = true;
      source.destroy();
      Promise.resolve(stream.abort()).catch(() => {}).finally(() => reject(error));
    };
    source.once('error', fail);
    stream.once('error', fail);
    stream.once('finish', () => {
      if (settled) return;
      settled = true;
      resolve();
    });
    source.pipe(stream);
  });
  await completed;
  return {
    fileId: stream.id,
    type: file.mimetype.startsWith('video/') ? 'video' : 'image',
    name: file.originalname,
    size: file.size
  };
}

async function cleanupTempFiles(files = []) {
  await Promise.all(files.map(file => fs.promises.unlink(file.path).catch(() => {})));
}

async function cleanupGridFsFiles(ids = []) {
  if (!mediaBucket) return;
  await Promise.all(ids.map(id => mediaBucket.delete(id).catch(() => {})));
}

app.use((err, req, res, next) => {
  if (res.headersSent) return next(err);
  const status = err instanceof multer.MulterError ? 400 : 500;
  let message = err.message || '요청을 처리하지 못했습니다.';
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') message = '파일당 최대 크기는 50MB입니다.';
  if (req.path.startsWith('/api/')) return res.status(status).json({ success: false, message });
  res.status(status).send(message);
});

if (!MONGO_URI) {
  console.error('MongoDB 연결 실패: MONGODB_URI 환경 변수를 설정해주세요.');
  process.exit(1);
}

mongoose.connect(MONGO_URI, { serverSelectionTimeoutMS: 10000 })
  .then(async () => {
    await PortfolioPost.createIndexes();
    console.log('MongoDB 연결 성공');
    mediaBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: GRIDFS_BUCKET_NAME });
    server.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB 연결 실패:', err.message);
    process.exit(1);
  });

