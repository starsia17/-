require('dotenv').config();
const crypto = require('crypto');
const fs = require('fs');
const http = require('http');
const os = require('os');
const path = require('path');
const express = require('express');
const mongoose = require('mongoose');
const { configureMongoose, connectionOptions } = require('./mongo-security');
configureMongoose(mongoose);
const multer = require('multer');
const sanitizeHtml = require('sanitize-html');
const { configureSecurity, verifiedMediaType, production } = require('./security');
const PortfolioPost = require('./models/PortfolioPost');
const PortfolioUser = require('./models/PortfolioUser');
const PortfolioSession = require('./models/PortfolioSession');
const PortfolioNotice = require('./models/PortfolioNotice');
const PortfolioNews = require('./models/PortfolioNews');
const PortfolioCollection = require('./models/PortfolioCollection');
const PortfolioShare = require('./models/PortfolioShare');
const auth = require('./auth')(PortfolioUser, PortfolioSession, process.env.PORTFOLIO_ADMIN_PASSWORD || '');

const app = express();
const server = http.createServer(app);
const PORT = process.env.PORT || 3000;
const MONGO_URI = process.env.MONGODB_URI;
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
configureSecurity(app);
app.use('/api/auth', express.json({ limit: '16kb' }));
app.use('/api/account/security', express.json({ limit: '16kb' }));
app.use(express.json({ limit: '4mb' }));
app.use(express.static(path.join(__dirname, 'public'), { dotfiles: 'deny' }));
server.headersTimeout = 20000;
server.requestTimeout = 300000;
server.keepAliveTimeout = 5000;
server.maxHeadersCount = 100;
server.maxConnections = 256;
server.maxRequestsPerSocket = 1000;
app.use('/api', async (req, res, next) => {
  if (Date.now() - lastTrashPurgeAt < 60 * 1000) return next();
  lastTrashPurgeAt = Date.now();
  try { await purgeExpiredTrash(); } catch (err) { console.error('휴지통 정리 실패:', err.message); }
  next();
});

app.get('/api/health', (req, res) => {
  const connected = mongoose.connection.readyState === 1;
  res.status(connected ? 200 : 503).json({ database: connected ? 'connected' : 'disconnected',
    version: '1.0.0', commit: /^[a-f\d]{40}$/i.test(process.env.RENDER_GIT_COMMIT || '') ? process.env.RENDER_GIT_COMMIT : null });
});

const storage = multer.diskStorage({
  destination: (req, file, callback) => callback(null, TEMP_UPLOAD_DIR),
  filename: (req, file, callback) => callback(null, crypto.randomUUID())
});
const uploadParser = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024, files: 10, fields: 20, parts: 30, fieldSize: 1024 * 1024, fieldNameSize: 100 },
  fileFilter: (req, file, callback) => callback(null, true)
});
let activeUploads = 0;
const uploadingUsers = new Set();
const upload = {
  array(field, count) {
    const parse = uploadParser.array(field, count);
    return (req, res, next) => {
      const user = String(req.user._id);
      if (activeUploads >= 3 || uploadingUsers.has(user)) {
        res.set('Retry-After', '5');
        return res.status(429).json({ success: false, message: '업로드가 진행 중입니다. 잠시 후 다시 시도해주세요.' });
      }
      ++activeUploads; uploadingUsers.add(user);
      let released = false;
      const release = () => { if (!released) { released = true; --activeUploads; uploadingUsers.delete(user); } };
      res.once('finish', release); res.once('close', release);
      parse(req, res, next);
    };
  }
};


auth.mount(app);
const requireUser = auth.requireUser;
require('./notices')(app, PortfolioNotice, requireUser, sanitizeRichText, plainTextFromHtml);
require('./member-portal')(app, PortfolioUser, PortfolioSession, PortfolioNews, auth);
require('./portfolio-builder')(app, PortfolioCollection, PortfolioPost, requireUser, serializePost, PortfolioShare, sanitizeRichText, plainTextFromHtml);
require('./career-profile')(app, PortfolioUser, requireUser, sanitizeRichText, plainTextFromHtml);
require('./sharing')(app, PortfolioShare, PortfolioPost, PortfolioCollection, requireUser, streamMedia);

app.get('/api/posts', requireUser, async (req, res) => {
  try {
    const posts = await PortfolioPost.find({ ownerId: req.user._id, deletedAt: null }).sort({ createdAt: -1, _id: -1 }).lean();
    res.json({ success: true, posts: posts.map(serializePost) });
  } catch (err) {
    console.error('게시물 목록 조회 실패:', err);
    res.status(500).json({ success: false, message: '게시물을 불러오지 못했습니다.' });
  }
});

app.get('/api/trash', requireUser, async (req, res) => {
  try {
    const now = new Date();
    const [posts, portfolios] = await Promise.all([
      PortfolioPost.find({ ownerId: req.user._id, deletedAt: { $ne: null }, expiresAt: { $gt: now } }).sort({ deletedAt: -1, _id: -1 }).lean(),
      PortfolioCollection.find({ ownerId: req.user._id, deletedAt: { $ne: null }, expiresAt: { $gt: now } }).sort({ deletedAt: -1, _id: -1 }).lean()
    ]);
    res.json({ success: true, posts: posts.map(serializePost), portfolios: portfolios.map(item => ({
      _id: String(item._id), title: item.title, postCount: item.postIds.length, deletedAt: item.deletedAt, expiresAt: item.expiresAt
    })) });
  } catch (err) {
    console.error('휴지통 조회 실패:', err);
    res.status(500).json({ success: false, message: '휴지통을 불러오지 못했습니다.' });
  }
});

app.get('/api/posts/:id', requireUser, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  try {
    const post = await PortfolioPost.findOne({ _id: req.params.id, ownerId: req.user._id, deletedAt: null }).lean();
    if (!post) return res.status(404).json({ success: false, message: '게시물을 찾을 수 없습니다.' });
    res.json({ success: true, post: serializePost(post) });
  } catch (err) {
    console.error('게시물 상세 조회 실패:', err);
    res.status(500).json({ success: false, message: '게시물을 불러오지 못했습니다.' });
  }
});

app.delete('/api/posts/:id', requireUser, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
    return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  }
  try {
    const deletedAt = new Date();
    const post = await PortfolioPost.findOneAndUpdate({ _id: req.params.id, ownerId: req.user._id, deletedAt: null },
      { $set: { deletedAt, expiresAt: new Date(deletedAt.getTime() + TRASH_RETENTION_MS) } }, { new: true });
    if (!post) return res.status(404).json({ success: false, message: '게시물을 찾을 수 없거나 이미 휴지통에 있습니다.' });
    await PortfolioShare.deleteMany({ ownerId: req.user._id, type: 'post', sourceId: post._id });
    res.json({ success: true, post: serializePost(post) });
  } catch (err) {
    console.error('게시물 휴지통 이동 실패:', err);
    res.status(500).json({ success: false, message: '게시물을 삭제하지 못했습니다.' });
  }
});

app.post('/api/trash/restore', requireUser, async (req, res) => {
  const ids = req.body?.ids ?? [], portfolioIds = req.body?.portfolioIds ?? [];
  const validIds = values => Array.isArray(values) && values.length <= 100 && values.every(id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id));
  if (!validIds(ids) || !validIds(portfolioIds) || ids.length + portfolioIds.length < 1 || ids.length + portfolioIds.length > 100) {
    return res.status(400).json({ success: false, message: '복원할 게시물을 올바르게 선택해 주세요.' });
  }
  try {
    const now = new Date();
    const postResult = await PortfolioPost.updateMany(
      { _id: { $in: ids }, ownerId: req.user._id, deletedAt: { $ne: null }, expiresAt: { $gt: now } },
      { $set: { deletedAt: null, expiresAt: null } }
    );
    const portfolioResult = await PortfolioCollection.updateMany(
      { _id: { $in: portfolioIds }, ownerId: req.user._id, deletedAt: { $ne: null }, expiresAt: { $gt: now } },
      { $set: { deletedAt: null, expiresAt: null }, $inc: { revision: 1 } }
    );
    res.json({ success: true, restored: postResult.modifiedCount + portfolioResult.modifiedCount,
      restoredPosts: postResult.modifiedCount, restoredPortfolios: portfolioResult.modifiedCount });
  } catch (err) {
    console.error('선택 게시물 복원 실패:', err);
    res.status(500).json({ success: false, message: '게시물을 복원하지 못했습니다.' });
  }
});

app.post('/api/trash/:id/restore', requireUser, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  try {
    const post = await PortfolioPost.findOneAndUpdate(
      { _id: req.params.id, ownerId: req.user._id, deletedAt: { $ne: null }, expiresAt: { $gt: new Date() } },
      { $set: { deletedAt: null, expiresAt: null } },
      { new: true }
    );
    if (!post) return res.status(404).json({ success: false, message: '휴지통에서 게시물을 찾을 수 없습니다.' });
    res.json({ success: true, post: serializePost(post) });
  } catch (err) {
    console.error('게시물 복원 실패:', err);
    res.status(500).json({ success: false, message: '게시물을 복원하지 못했습니다.' });
  }
});

app.delete('/api/trash/:id', requireUser, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  try {
    const post = await PortfolioPost.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id, deletedAt: { $ne: null } });
    if (!post) return res.status(404).json({ success: false, message: '휴지통에서 게시물을 찾을 수 없습니다.' });
    await cleanupGridFsFiles((post.media || []).map(item => item.fileId));
    res.json({ success: true });
  } catch (err) {
    console.error('게시물 영구 삭제 실패:', err);
    res.status(500).json({ success: false, message: '게시물을 완전히 삭제하지 못했습니다.' });
  }
});

app.get('/api/media/:id', requireUser, async (req, res) => {
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
    return res.status(400).json({ success: false, message: '올바르지 않은 미디어 ID입니다.' });
  }
  try {
    const fileId = new mongoose.Types.ObjectId(req.params.id);
    const ownerPost = await PortfolioPost.findOne({ ownerId: req.user._id, 'media.fileId': fileId }).select('_id');
    if (!ownerPost) return res.status(404).json({ success: false, message: '미디어 파일을 찾을 수 없습니다.' });
    await streamMedia(req, res, fileId);
  } catch (err) {
    res.status(500).json({ success: false, message: '미디어 파일을 불러오지 못했습니다.' });
  }
});

app.post('/api/posts', requireUser, upload.array('media', 10), async (req, res) => {
  const uploadedIds = [];
  try {
    if (['title', 'category', 'bodyHtml'].some(key => req.body[key] !== undefined && typeof req.body[key] !== 'string')) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '입력 형식이 올바르지 않습니다.' });
    }
    const title = (req.body.title || '').trim();
    const category = (req.body.category || '기타').trim();
    if (!title) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '작업 제목을 입력해주세요.' });
    }
    if (title.length > 120 || category.length > 40 || String(req.body.bodyHtml || '').length > 160000) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '입력한 내용이 허용 길이를 초과했습니다.' });
    }
    const media = [];
    for (const file of req.files || []) {
      const stored = await storeMediaFile(file, uploadedIds);
      media.push(stored);
    }
    const bodyHtml = sanitizeRichText(req.body.bodyHtml || '', createInlineMediaMap(req.body.inlineMedia, media), new Set(media.map(item => String(item.fileId))));
    const description = plainTextFromHtml(bodyHtml).trim();
    if (description.length > 25000 || bodyHtml.length > 150000) {
      await Promise.all([cleanupTempFiles(req.files), cleanupGridFsFiles(uploadedIds)]);
      return res.status(400).json({ success: false, message: '본문은 최대 25,000자까지 작성할 수 있어요.' });
    }
    const post = await PortfolioPost.create({ ownerId: req.user._id, title, description, bodyHtml, category, media });
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

app.put('/api/posts/:id', requireUser, upload.array('media', 10), async (req, res) => {
  const uploadedIds = [];
  if (!/^[a-f\d]{24}$/i.test(req.params.id)) {
    await cleanupTempFiles(req.files);
    return res.status(400).json({ success: false, message: '올바르지 않은 게시물 ID입니다.' });
  }
  try {
    const post = await PortfolioPost.findOne({ _id: req.params.id, ownerId: req.user._id, deletedAt: null });
    if (!post) {
      await cleanupTempFiles(req.files);
      return res.status(404).json({ success: false, message: '수정할 게시물을 찾을 수 없습니다.' });
    }
    if (['title', 'category', 'bodyHtml'].some(key => req.body[key] !== undefined && typeof req.body[key] !== 'string')) {
      await cleanupTempFiles(req.files);
      return res.status(400).json({ success: false, message: '입력 형식이 올바르지 않습니다.' });
    }
    const title = (req.body.title || '').trim();
    const category = (req.body.category || '기타').trim();
    if (!title || title.length > 120 || category.length > 40 || String(req.body.bodyHtml || '').length > 160000) {
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
    const bodyHtml = sanitizeRichText(req.body.bodyHtml || '', createInlineMediaMap(req.body.inlineMedia, addedMedia), new Set(media.map(item => String(item.fileId))));
    const description = plainTextFromHtml(bodyHtml).trim();
    if (description.length > 25000 || bodyHtml.length > 150000) {
      await Promise.all([cleanupTempFiles(req.files), cleanupGridFsFiles(uploadedIds)]);
      return res.status(400).json({ success: false, message: '본문은 최대 25,000자까지 작성할 수 있어요.' });
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
  const contentType = await verifiedMediaType(file);
  const originalName = path.basename(file.originalname.replace(/\\/g, '/')).replace(/[\x00-\x1f\x7f]/g, '').slice(0, 200) || 'download';
  const type = !inlineMediaTypes.has(contentType) ? 'file' : contentType.startsWith('video/') ? 'video' : 'image';
  const stream = mediaBucket.openUploadStream(file.filename, {
    metadata: { contentType, kind: type, originalName }
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
    name: originalName,
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
  await PortfolioCollection.deleteMany({ deletedAt: { $ne: null }, expiresAt: { $lte: new Date() } });
  if (!mediaBucket) return;
  const now = new Date();
  const expired = await PortfolioPost.find({ deletedAt: { $ne: null }, expiresAt: { $lte: now } }).select('_id media').lean();
  if (!expired.length) return;
  for (const candidate of expired) {
    const removed = await PortfolioPost.findOneAndDelete({ _id: candidate._id, deletedAt: { $ne: null }, expiresAt: { $lte: now } });
    if (removed) await cleanupGridFsFiles((removed.media || []).map(item => item.fileId));
  }
}

async function cleanupExpiredMediaOrphans() {
  if (!mediaBucket) return;
  const referencedIds = await PortfolioPost.distinct('media.fileId');
  const cutoff = new Date(Date.now() - TRASH_RETENTION_MS);
  const orphaned = await mediaBucket.find({ uploadDate: { $lt: cutoff }, _id: { $nin: referencedIds } }).project({ _id: 1 }).toArray();
  await cleanupGridFsFiles(orphaned.map(file => file._id));
}

const richTextTags = new Set(['p', 'div', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'blockquote', 'h1', 'h2', 'h3', 'span', 'figure', 'figcaption', 'img', 'video', 'a']);

function sanitizeRichText(input, inlineMedia = new Map(), allowedMedia = new Set()) {
  return sanitizeHtml(String(input).slice(0, 160000), {
    allowedTags: [...richTextTags],
    allowedAttributes: { '*': ['style'], figure: ['style', 'data-external-video'], img: ['src', 'alt', 'loading'], video: ['src', 'controls', 'playsinline', 'preload'], a: ['href', 'target', 'rel', 'download'] },
    allowedSchemes: ['https'], allowProtocolRelative: false,
    // Styles are normalized by our existing editor whitelist before serialization.
    parseStyleAttributes: false,
    nonTextTags: ['script', 'style', 'textarea', 'option', 'iframe', 'object', 'svg', 'math', 'template'],
    transformTags: {
      '*': (tag, attrs) => {
        const style = sanitizeEditorStyle(attrs.style || '');
        const safe = style ? { style } : {};
        if (tag === 'figure' && attrs['data-external-video'] === 'true') safe['data-external-video'] = 'true';
        const uploaded = inlineMedia.get(attrs['data-upload-token']);
        if (tag === 'img' || tag === 'video') {
          const expected = tag === 'img' ? 'image' : 'video';
          const src = uploaded?.type === expected ? `/api/media/${uploaded.fileId}` : attrs.src || '';
          if (/^\/api\/media\/[a-f\d]{24}$/i.test(src) && allowedMedia.has(src.split('/').pop())) {
            safe.src = src;
            if (tag === 'img') { safe.alt = (uploaded?.name || attrs.alt || '').slice(0, 200); safe.loading = 'lazy'; }
            else { safe.controls = ''; safe.playsinline = ''; safe.preload = 'metadata'; }
          }
        }
        if (tag === 'a') {
          const href = uploaded?.type === 'file' ? `/api/media/${uploaded.fileId}` : attrs.href || '';
          if (/^\/api\/media\/[a-f\d]{24}$/i.test(href) && allowedMedia.has(href.split('/').pop())) { safe.href = href; safe.download = ''; }
          else {
            try {
              const url = new URL(href);
              if (url.protocol === 'https:' && !url.username && !url.password) { safe.href = url.href; safe.target = '_blank'; safe.rel = 'noopener noreferrer'; }
            } catch {}
          }
        }
        return { tagName: tag, attribs: safe };
      }
    },
    exclusiveFilter: frame => ['img', 'video'].includes(frame.tag) && !frame.attribs.src
  });
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
  const status = ['PASSWORD_BUSY', 'MFA_RATE_LIMITED'].includes(err.code) ? 429 : err instanceof multer.MulterError ? (err.code === 'LIMIT_FILE_SIZE' ? 413 : 400) : ['entity.too.large'].includes(err.type) ? 413 : err.type === 'entity.parse.failed' ? 400 : err.status === 503 ? 503 : 500;
  let message = status === 413 ? '요청이 허용 크기를 초과했습니다.' : status === 400 ? '입력 형식이나 첨부 제한을 확인해주세요.' : '요청을 처리하지 못했습니다. 잠시 후 다시 시도해주세요.';
  if (err instanceof multer.MulterError && err.code === 'LIMIT_FILE_SIZE') message = '파일당 최대 크기는 50MB입니다.';
  if (err.status === 503 || ['PASSWORD_BUSY', 'MFA_RATE_LIMITED'].includes(err.code)) message = err.message;
  if (status === 429) res.set('Retry-After', err.code === 'MFA_RATE_LIMITED' ? '600' : '3');
  if (req.path.startsWith('/api/')) return res.status(status).json({ success: false, message });
  res.status(status).send(message);
});

async function start() {
  if (!MONGO_URI) throw new Error('MONGODB_URI 환경 변수를 설정해주세요.');
  await mongoose.connect(MONGO_URI, connectionOptions(production()));
  await Promise.all([PortfolioPost.createIndexes(), PortfolioUser.createIndexes(), PortfolioSession.createIndexes(), PortfolioNotice.createIndexes(), PortfolioNews.createIndexes(), PortfolioCollection.createIndexes(), PortfolioShare.createIndexes()]);
  await auth.initializeAdmin(PortfolioPost);
  mediaBucket = new mongoose.mongo.GridFSBucket(mongoose.connection.db, { bucketName: GRIDFS_BUCKET_NAME });
  await purgeExpiredTrash();
  await cleanupExpiredMediaOrphans();
  setInterval(async () => {
    try { await purgeExpiredTrash(); await cleanupExpiredMediaOrphans(); }
    catch (err) { console.error('휴지통 정리 실패:', err.message); }
  }, 60 * 60 * 1000).unref();
  server.listen(PORT, () => console.log('포트폴리오 서버 실행 중'));
}
module.exports = { app, start, sanitizeRichText, auth };
if (require.main === module) start().catch(error => { console.error('서버 시작 실패:', error.message); process.exit(1); });

async function streamMedia(req, res, rawId) {
  try {
    const fileId = new mongoose.Types.ObjectId(String(rawId));
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
      'Cache-Control': 'private, no-store'
    });
    const download = mediaBucket.openDownloadStream(fileId, { start, end: end + 1 });
    download.on('error', error => {
      if (res.headersSent) res.destroy(error);
      else res.status(404).end();
    });
    download.pipe(res.status(status));
  } catch (error) { if (res.headersSent) res.destroy(error); else res.status(500).json({ success: false, message: '미디어 파일을 불러오지 못했습니다.' }); }
}
