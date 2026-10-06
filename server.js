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
const TRASH_RETENTION_MS = 30 * 24 * 60 * 60 * 1000;
let mediaBucket;
let lastTrashPurgeAt = 0;
const inlineMediaTypes = new Set([
  'image/jpeg', 'image/png', 'image/gif', 'image/webp',
  'video/mp4', 'video/webm', 'video/quicktime'
]);

fs.mkdirSync(TEMP_UPLOAD_DIR, { recursive: true });
app.set('trust proxy', true);
app.use(express.json({ limit: '2mb' }));
app.use(express.static(path.join(__dirname, 'public')));
app.use('/api', async (req, res, next) => {
  if (Date.now() - lastTrashPurgeAt < 60 * 1000) return next();
  lastTrashPurgeAt = Date.now();
  try { await purgeExpiredTrash(); } catch (err) { console.error('휴지통 정리 실패:', err.message); }
  next();
});

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
  fileFilter: (req, file, callback) => callback(null, true)
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
    const posts = await PortfolioPost.find({ deletedAt: null }).sort({ createdAt: -1 }).limit(100).lean();
    res.json({ success: true, posts: posts.map(serializePost) });
  } catch (err) {
    res.status(500).json({ success: false, message: '게시물을 불러오지 못했습니다.' });
  }
});

app.get('/api/trash', requireAdmin, async (req, res) => {
  try {
    const posts = await PortfolioPost.find({ deletedAt: { $ne: null } }).sort({ deletedAt: -1 }).limit(100).lean();
    res.json({ success: true, posts: posts.map(serializePost) });
  } catch (err) {
    res.status(500).json({ success: false, message: '휴지통을 불러오지 못했습니다.' });
  }
});

app.get('/api/posts/:id', async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  try {
    const post = await PortfolioPost.findOne({ _id: req.params.id, deletedAt: null }).lean();
    if (!post) return res.status(404).json({ success: false, message: '게시물을 찾을 수 없습니다.' });
    res.json({ success: true, post: serializePost(post) });
  } catch (err) {
    res.status(500).json({ success: false, message: '게시물을 불러오지 못했습니다.' });
  }
});

app.delete('/api/posts/:id', requireAdmin, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
    return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  }
  try {
    const post = await PortfolioPost.findById(req.params.id);
    if (!post) return res.status(404).json({ success: false, message: '게시물을 찾을 수 없습니다.' });
    if (post.deletedAt) return res.status(409).json({ success: false, message: '이미 휴지통에 있는 게시물입니다.' });
    const deletedAt = new Date();
    post.deletedAt = deletedAt;
    post.expiresAt = new Date(deletedAt.getTime() + 30 * 24 * 60 * 60 * 1000);
    await post.save();
    res.json({ success: true, post: serializePost(post) });
  } catch (err) {
    res.status(500).json({ success: false, message: '게시물을 삭제하지 못했습니다.' });
  }
});

app.post('/api/trash/restore', requireAdmin, async (req, res) => {
  const ids = req.body?.ids;
  if (!Array.isArray(ids) || ids.length < 1 || ids.length > 100 || ids.some(id => typeof id !== 'string' || !/^[a-f\d]{24}$/i.test(id))) {
    return res.status(400).json({ success: false, message: '복원할 게시물을 올바르게 선택해 주세요.' });
  }
  try {
    const result = await PortfolioPost.updateMany(
      { _id: { $in: ids }, deletedAt: { $ne: null } },
      { $set: { deletedAt: null, expiresAt: null } }
    );
    res.json({ success: true, restored: result.modifiedCount });
  } catch (err) {
    res.status(500).json({ success: false, message: '게시물을 복원하지 못했습니다.' });
  }
});

app.post('/api/trash/:id/restore', requireAdmin, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  try {
    const post = await PortfolioPost.findOneAndUpdate(
      { _id: req.params.id, deletedAt: { $ne: null } },
      { $set: { deletedAt: null, expiresAt: null } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: '휴지통에서 게시물을 찾을 수 없습니다.' });
    res.json({ success: true, post: serializePost(post) });
  } catch (err) {
    res.status(500).json({ success: false, message: '게시물을 복원하지 못했습니다.' });
  }
});

app.delete('/api/trash/:id', requireAdmin, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  try {
    const post = await PortfolioPost.findOneAndDelete({ _id: req.params.id, deletedAt: { $ne: null } });
    if (!post) return res.status(404).json({ success: false, message: '휴지통에서 게시물을 찾을 수 없습니다.' });
    await cleanupGridFsFiles((post.media || []).map(item => item.fileId));
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ success: false, message: '게시물을 완전히 삭제하지 못했습니다.' });
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
      'Content-Type': inlineMediaTypes.has(file.metadata?.contentType) ? file.metadata.contentType : 'application/octet-stream',
      'Content-Length': String(Math.max(0, end - start + 1)),
      'Content-Disposition': file.metadata?.kind === 'file'
        ? `attachment; filename*=UTF-8''${encodeURIComponent(file.metadata.originalName || 'download')}`
        : 'inline',
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
    const category = (req.body.category || '기타').trim();
    if (!title) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '작업 제목을 입력해주세요.' });
    }
    if (title.length > 120 || category.length > 40 || String(req.body.bodyHtml || '').length > 60000) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '입력한 내용이 허용 길이를 초과했습니다.' });
    }
    const media = [];
    for (const file of req.files || []) {
      const stored = await storeMediaFile(file, uploadedIds);
      media.push(stored);
    }
    const bodyHtml = sanitizeRichText(req.body.bodyHtml || '', createInlineMediaMap(req.body.inlineMedia, media));
    const description = plainTextFromHtml(bodyHtml).trim();
    if (description.length > 5000 || bodyHtml.length > 30000) {
      await Promise.all([cleanupTempFiles(req.files), cleanupGridFsFiles(uploadedIds)]);
      return res.status(400).json({ success: false, message: '본문은 5,000자까지 작성할 수 있어요.' });
    }
    const post = await PortfolioPost.create({ title, description, bodyHtml, category, media });
    await cleanupTempFiles(req.files);
    res.status(201).json({ success: true, post: serializePost(post) });
  } catch (err) {
    console.error('게시물 저장 실패:', err);
    await Promise.all([
      cleanupTempFiles(req.files),
      cleanupGridFsFiles(uploadedIds)
    ]);
    res.status(500).json({ success: false, message: '게시물을 저장하지 못했습니다.' });
  }
});

app.put('/api/posts/:id', requireAdmin, upload.array('media', 10), async (req, res) => {
  const uploadedIds = [];
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
    await cleanupTempFiles(req.files);
    return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  }
  try {
    const post = await PortfolioPost.findOne({ _id: req.params.id, deletedAt: null });
    if (!post) {
      await cleanupTempFiles(req.files);
      return res.status(404).json({ success: false, message: '수정할 게시물을 찾을 수 없습니다.' });
    }
    const title = (req.body.title || '').trim();
    const category = (req.body.category || '기타').trim();
    if (!title || title.length > 120 || category.length > 40 || String(req.body.bodyHtml || '').length > 60000) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '제목을 확인하거나 입력한 내용의 길이를 줄여주세요.' });
    }
    if ((post.media || []).length + (req.files || []).length > 10) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '한 게시물에는 최대 10개까지 첨부할 수 있어요.' });
    }
    const media = [...(post.media || [])];
    const addedMedia = [];
    for (const file of req.files || []) {
      const stored = await storeMediaFile(file, uploadedIds);
      media.push(stored);
      addedMedia.push(stored);
    }
    const bodyHtml = sanitizeRichText(req.body.bodyHtml || '', createInlineMediaMap(req.body.inlineMedia, addedMedia));
    const description = plainTextFromHtml(bodyHtml).trim();
    if (description.length > 5000 || bodyHtml.length > 30000) {
      await Promise.all([cleanupTempFiles(req.files), cleanupGridFsFiles(uploadedIds)]);
      return res.status(400).json({ success: false, message: '본문은 5,000자까지 작성할 수 있어요.' });
    }
    post.title = title;
    post.description = description;
    post.bodyHtml = bodyHtml;
    post.category = category;
    post.media = media;
    await post.save();
    await cleanupTempFiles(req.files);
    res.json({ success: true, post: serializePost(post) });
  } catch (err) {
    console.error('게시물 수정 실패:', err);
    await Promise.all([cleanupTempFiles(req.files), cleanupGridFsFiles(uploadedIds)]);
    res.status(500).json({ success: false, message: '게시물을 수정하지 못했습니다.' });
  }
});

function serializePost(post) {
  const value = post.toObject ? post.toObject() : post;
  return {
    ...value,
    media: (value.media || []).map(({ fileId, ...item }) => ({ ...item, url: `/api/media/${fileId}` }))
  };
}

function createInlineMediaMap(rawDescriptors, uploadedMedia) {
  let descriptors;
  try { descriptors = JSON.parse(String(rawDescriptors || '[]')); } catch { return new Map(); }
  if (!Array.isArray(descriptors)) return new Map();
  const mapping = new Map();
  descriptors.slice(0, uploadedMedia.length).forEach((descriptor, index) => {
    if (typeof descriptor?.token === 'string' && /^[a-f\d-]{36}$/i.test(descriptor.token)) {
      mapping.set(descriptor.token, uploadedMedia[index]);
    }
  });
  return mapping;
}

async function storeMediaFile(file, uploadedIds) {
  const type = !inlineMediaTypes.has(file.mimetype) ? 'file' : file.mimetype.startsWith('video/') ? 'video' : 'image';
  const stream = mediaBucket.openUploadStream(file.filename, {
    metadata: { contentType: file.mimetype, kind: type, originalName: file.originalname }
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
    type,
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

async function purgeExpiredTrash() {
  if (!mediaBucket) return;
  const now = new Date();
  const expired = await PortfolioPost.find({ deletedAt: { $ne: null }, expiresAt: { $lte: now } }).select('_id media').lean();
  if (!expired.length) return;
  await cleanupGridFsFiles(expired.flatMap(post => (post.media || []).map(item => item.fileId)));
  await PortfolioPost.deleteMany({ _id: { $in: expired.map(post => post._id) }, deletedAt: { $ne: null }, expiresAt: { $lte: now } });
}

async function cleanupExpiredMediaOrphans() {
  if (!mediaBucket) return;
  const referencedIds = await PortfolioPost.distinct('media.fileId');
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
  const orphaned = await mediaBucket.find({ uploadDate: { $lt: cutoff }, _id: { $nin: referencedIds } }).project({ _id: 1 }).toArray();
  await cleanupGridFsFiles(orphaned.map(file => file._id));
}

const richTextTags = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'span', 'figure', 'figcaption', 'img', 'video', 'a']);

function sanitizeRichText(input, inlineMedia = new Map()) {
  const source = String(input).slice(0, 60000)
    .replace(/<(script|style|iframe|object|svg|math|template)\b[^>]*>[\s\S]*?<\/\1\s*>/gi, '')
    .replace(/<!--[\s\S]*?-->/g, '');
  let output = '';
  const tokens = source.match(/<\/?[a-z][^>]*>|[^<]+|</gi) || [];
  for (const token of tokens) {
    const match = /^<\s*(\/?)\s*([a-z][\w-]*)\b([^>]*)>/i.exec(token);
    if (!match) { output += escapeHtml(decodeBasicEntities(token)); continue; }
    const closing = Boolean(match[1]);
    const tag = match[2].toLowerCase();
    if (!richTextTags.has(tag)) continue;
    if (closing) { if (tag !== 'br') output += `</${tag}>`; continue; }
    const attrs = match[3];
    const attribute = name => {
      const found = new RegExp(`\\b${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(attrs);
      return found ? (found[1] ?? found[2] ?? found[3] ?? '') : '';
    };
    const token = attribute('data-upload-token');
    const uploaded = inlineMedia.get(token);
    const styleMatch = /\bstyle\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(attrs);
    const style = styleMatch ? sanitizeEditorStyle(styleMatch[1] ?? styleMatch[2]) : '';
    let safeAttributes = style ? ` style="${escapeHtml(style)}"` : '';
    if (tag === 'img' || tag === 'video') {
      const expectedType = tag === 'img' ? 'image' : 'video';
      const src = uploaded?.type === expectedType ? `/api/media/${uploaded.fileId}` : attribute('src');
      if (!/^\/api\/media\/[a-f\d]{24}$/i.test(src)) continue;
      safeAttributes += ` src="${src}"`;
      if (tag === 'img') safeAttributes += ` alt="${escapeHtml(uploaded?.name || attribute('alt').slice(0, 200))}" loading="lazy"`;
      else safeAttributes += ' controls playsinline preload="metadata"';
    }
    if (tag === 'a') {
      const href = uploaded?.type === 'file' ? `/api/media/${uploaded.fileId}` : attribute('href');
      if (!/^\/api\/media\/[a-f\d]{24}$/i.test(href)) continue;
      safeAttributes += ` href="${href}" download`;
    }
    output += `<${tag}${safeAttributes}>`;
  }
  return output;
}

function sanitizeEditorStyle(raw) {
  const safe = [];
  for (const part of raw.split(';')) {
    const [property, ...valueParts] = part.split(':');
    const key = (property || '').trim().toLowerCase();
    const value = valueParts.join(':').trim();
    if (key === 'text-align' && /^(left|right|center|justify)$/i.test(value)) safe.push(`text-align:${value.toLowerCase()}`);
    if (key === 'color' && /^#(?:[\da-f]{3}|[\da-f]{4}|[\da-f]{6}|[\da-f]{8})$/i.test(value)) safe.push(`color:${value}`);
    if (key === 'font-size') {
      const size = /^(\d{1,2})px$/i.exec(value);
      if (size) safe.push(`font-size:${Math.min(48, Math.max(12, Number(size[1])))}px`);
    }
    if (key === 'font-weight' && /^(300|400|500|600|700|800|900|normal|bold)$/i.test(value)) safe.push(`font-weight:${value.toLowerCase()}`);
    if (key === 'font-family') {
      const family = value.replace(/["']/g, '').trim();
      const allowed = ['Noto Sans KR', 'Noto Serif KR', 'Georgia', 'Arial', 'Verdana', 'Tahoma', 'Trebuchet MS', 'Courier New', 'serif', 'sans-serif', 'monospace'];
      if (allowed.includes(family)) safe.push(`font-family:${family.includes(' ') ? `"${family}"` : family}`);
    }
  }
  return safe.join(';');
}

function escapeHtml(value) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function decodeBasicEntities(value) {
  return value.replace(/&(?:amp|lt|gt|quot|apos|nbsp);/gi, entity => ({ '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&apos;': "'", '&nbsp;': '\u00a0' }[entity.toLowerCase()]));
}

function plainTextFromHtml(html) {
  return decodeBasicEntities(html.replace(/<br\s*\/?\s*>|<\/(?:p|div|li|h[1-3]|blockquote)>/gi, '\n').replace(/<[^>]*>/g, ''));
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
    await purgeExpiredTrash();
    await cleanupExpiredMediaOrphans();
    setInterval(async () => {
      try { await purgeExpiredTrash(); await cleanupExpiredMediaOrphans(); }
      catch (err) { console.error('휴지통 정리 실패:', err.message); }
    }, 60 * 60 * 1000).unref();
    server.listen(PORT, () => console.log(`서버 실행 중: http://localhost:${PORT}`));
  })
  .catch(err => {
    console.error('MongoDB 연결 실패:', err.message);
    process.exit(1);
  });

