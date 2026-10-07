const { rich, resume } = require('./career-content');
module.exports = function mount(app, Collection, Post, requireUser, serializePost, Share, sanitize, plain) {
  const validId = id => typeof id === 'string' && /^[a-f\d]{24}$/i.test(id);
  const summary = item => ({ id: String(item._id), title: item.title, introduction: item.introduction,
    introductionHtml: item.introductionHtml || '', targetCompany: item.targetCompany || '', targetRole: item.targetRole || '',
    resume: item.resume || null, projectNotes: (item.projectNotes || []).map(note => ({ postId: String(note.postId), bodyHtml: note.bodyHtml })),
    layout: item.layout, postIds: item.postIds.map(String), revision: item.revision || 0,
    createdAt: item.createdAt, updatedAt: item.updatedAt, deletedAt: item.deletedAt || null, expiresAt: item.expiresAt || null });
  function input(body, existing = {}) {
    if (!body || typeof body.title !== 'string' || !body.title.trim() || body.title.trim().length > 100 ||
      typeof body.introduction !== 'string' || body.introduction.length > 2000 ||
      !['auto', 'gallery', 'story'].includes(body.layout) || !Array.isArray(body.postIds) ||
      body.postIds.length < 1 || body.postIds.length > 200 || body.postIds.some(id => !validId(id)) ||
      new Set(body.postIds.map(id => id.toLowerCase())).size !== body.postIds.length) return null;
    try {
      // Old clients do not send career fields. Preserve them during PATCH;
      // an explicit empty string, null resume or empty notes still clears them.
      const value = (key, fallback) => Object.hasOwn(body, key) ? body[key] : existing[key] ?? fallback;
      const introductionHtml = rich(value('introductionHtml', ''), sanitize, plain);
      const targetCompany = value('targetCompany', ''), targetRole = value('targetRole', '');
      if (typeof targetCompany !== 'string' || targetCompany.length > 100 || typeof targetRole !== 'string' || targetRole.length > 120) return null;
      const selected = new Set(body.postIds.map(id => id.toLowerCase()));
      const notes = Object.hasOwn(body, 'projectNotes') ? body.projectNotes :
        (existing.projectNotes || []).filter(note => selected.has(String(note.postId).toLowerCase()))
          .map(note => ({ postId: String(note.postId), bodyHtml: note.bodyHtml || '' }));
      if (!Array.isArray(notes) || notes.length > 200 || notes.some(note => !note || !validId(note.postId) || !body.postIds.some(id => id.toLowerCase() === note.postId.toLowerCase())) || new Set(notes.map(note => note.postId.toLowerCase())).size !== notes.length) return null;
      const projectNotes = notes.map(note => ({ postId: note.postId.toLowerCase(), bodyHtml: rich(note.bodyHtml, sanitize, plain) }));
      const profileValue = value('resume', null);
      const profile = profileValue == null ? null : resume(profileValue, sanitize, plain);
      if (introductionHtml.length + projectNotes.reduce((sum, note) => sum + note.bodyHtml.length, 0) + (profile?.bodyHtml.length || 0) > 600000) return null;
      return { title: body.title.trim(), introduction: body.introduction.trim(), introductionHtml, targetCompany: targetCompany.trim(), targetRole: targetRole.trim(),
        resume: profile, projectNotes, layout: body.layout, postIds: [...selected] };
    } catch { return null; }
  }
  async function available(ownerId, ids) {
    return await Post.countDocuments({ ownerId, _id: { $in: ids }, deletedAt: null }) === ids.length;
  }
  async function detail(item, ownerId) {
    const posts = await Post.find({ ownerId, _id: { $in: item.postIds }, deletedAt: null }).lean();
    const byId = new Map(posts.map(post => [String(post._id), post]));
    const ordered = item.postIds.map(id => byId.get(String(id))).filter(Boolean);
    const imageCount = ordered.filter(post => post.media?.some(media => media.type === 'image')).length;
    return { ...summary(item), resolvedLayout: item.layout === 'auto' ? (imageCount >= ordered.length / 2 && imageCount > 0 ? 'gallery' : 'story') : item.layout,
      posts: ordered.map(serializePost), unavailableCount: item.postIds.length - ordered.length };
  }
  app.get('/api/portfolios', requireUser, async (req, res, next) => {
    try { const rows = await Collection.find({ ownerId: req.user._id, deletedAt: null }).sort({ updatedAt: -1, _id: -1 }).lean();
      res.json({ success: true, portfolios: rows.map(summary) }); } catch (error) { next(error); }
  });
  app.get('/api/portfolios/:id', requireUser, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 포트폴리오 주소입니다.' });
    try { const item = await Collection.findOne({ _id: req.params.id, ownerId: req.user._id, deletedAt: null }).lean();
      if (!item) return res.status(404).json({ success: false, message: '포트폴리오를 찾을 수 없습니다.' });
      res.json({ success: true, portfolio: await detail(item, req.user._id) }); } catch (error) { next(error); }
  });
  app.post('/api/portfolios', requireUser, async (req, res, next) => {
    const values = input(req.body), key = req.body?.creationKey;
    if (!values || typeof key !== 'string' || !/^[\w-]{16,80}$/.test(key)) return res.status(400).json({ success: false, message: '제목과 만들 게시글을 올바르게 선택해주세요. 최대 200개까지 선택할 수 있습니다.' });
    try {
      const existing = await Collection.findOne({ ownerId: req.user._id, creationKey: key }).lean();
      if (existing?.deletedAt) return res.status(409).json({ success: false, message: '이 포트폴리오는 휴지통에 있습니다. 휴지통에서 복원해주세요.' });
      if (existing) return res.json({ success: true, portfolio: summary(existing) });
      if (!await available(req.user._id, values.postIds)) return res.status(400).json({ success: false, message: '선택한 게시글이 변경되었습니다. 본인의 휴지통에 없는 게시글만 선택해주세요.' });
      let item;
      try { item = await Collection.create({ ...values, ownerId: req.user._id, creationKey: key }); }
      catch (error) { if (error.code !== 11000) throw error; item = await Collection.findOne({ ownerId: req.user._id, creationKey: key }).lean(); if (!item) throw error; }
      if (item.deletedAt) return res.status(409).json({ success: false, message: '이 포트폴리오는 휴지통에 있습니다. 휴지통에서 복원해주세요.' });
      res.status(201).json({ success: true, portfolio: summary(item) });
    } catch (error) { next(error); }
  });
  app.post('/api/portfolios/:id/duplicate', requireUser, async (req, res, next) => {
    const key = req.body?.creationKey;
    if (!validId(req.params.id) || typeof key !== 'string' || !/^[\w-]{16,80}$/.test(key)) return res.status(400).json({ success: false, message: '복제 정보를 확인해주세요.' });
    try {
      const source = await Collection.findOne({ _id: req.params.id, ownerId: req.user._id, deletedAt: null }).lean();
      if (!source) return res.status(404).json({ success: false, message: '복제할 포트폴리오를 찾을 수 없습니다.' });
      let item = await Collection.findOne({ ownerId: req.user._id, creationKey: key }).lean();
      if (!item) {
        const values = summary(source);
        const title = (source.title + ' · 복제본').slice(0, 100);
        try { item = await Collection.create({ ownerId: req.user._id, creationKey: key, title, introduction: values.introduction,
          introductionHtml: values.introductionHtml, targetCompany: values.targetCompany, targetRole: values.targetRole,
          resume: values.resume, projectNotes: values.projectNotes, layout: values.layout, postIds: values.postIds }); }
        catch (error) { if (error.code !== 11000) throw error; item = await Collection.findOne({ ownerId: req.user._id, creationKey: key }).lean(); if (!item) throw error; }
      }
      if (item.deletedAt) return res.status(409).json({ success: false, message: '복제본이 휴지통에 있습니다. 복원한 뒤 사용해주세요.' });
      res.json({ success: true, portfolio: summary(item) });
    } catch (error) { next(error); }
  });
  app.patch('/api/portfolios/:id', requireUser, async (req, res, next) => {
    const revision = req.body?.revision;
    if (!validId(req.params.id) || !Number.isSafeInteger(revision) || revision < 0) return res.status(400).json({ success: false, message: '수정 정보를 올바르게 입력해주세요.' });
    try {
      const existing = await Collection.findOne({ _id: req.params.id, ownerId: req.user._id, deletedAt: null }).lean();
      if (!existing) return res.status(404).json({ success: false, message: '포트폴리오를 찾을 수 없습니다.' });
      const values = input(req.body, existing);
      if (!values) return res.status(400).json({ success: false, message: '수정 정보를 올바르게 입력해주세요.' });
      if (!await available(req.user._id, values.postIds)) return res.status(400).json({ success: false, message: '선택한 게시글이 변경되었습니다. 게시글 목록을 새로 불러와 선택해주세요.' });
      const item = await Collection.findOneAndUpdate({ _id: req.params.id, ownerId: req.user._id, deletedAt: null, revision },
        { $set: values, $inc: { revision: 1 } }, { new: true, runValidators: true }).lean();
      if (!item) return res.status(409).json({ success: false, message: '다른 화면에서 수정되었습니다. 다시 열어서 수정해주세요.' });
      res.json({ success: true, portfolio: summary(item) });
    } catch (error) { next(error); }
  });
  app.delete('/api/portfolios/:id', requireUser, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 포트폴리오 주소입니다.' });
    try {
      const deletedAt = new Date(), expiresAt = new Date(deletedAt.getTime() + 30 * 86400000);
      const item = await Collection.findOneAndUpdate({ _id: req.params.id, ownerId: req.user._id, deletedAt: null },
        { $set: { deletedAt, expiresAt }, $inc: { revision: 1 } }, { new: true }).lean();
      if (!item) return res.status(404).json({ success: false, message: '포트폴리오를 찾을 수 없거나 이미 휴지통에 있습니다.' });
      await Share.deleteMany({ ownerId: req.user._id, type: 'portfolio', sourceId: item._id });
      res.json({ success: true, portfolio: summary(item) });
    } catch (error) { next(error); }
  });
  app.post('/api/trash/portfolios/:id/restore', requireUser, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 포트폴리오 주소입니다.' });
    try {
      const item = await Collection.findOneAndUpdate({ _id: req.params.id, ownerId: req.user._id, deletedAt: { $ne: null }, expiresAt: { $gt: new Date() } },
        { $set: { deletedAt: null, expiresAt: null }, $inc: { revision: 1 } }, { new: true }).lean();
      if (!item) return res.status(404).json({ success: false, message: '휴지통에 없거나 보관 기간이 지난 포트폴리오입니다.' });
      res.json({ success: true, portfolio: summary(item) });
    } catch (error) { next(error); }
  });
  app.delete('/api/trash/portfolios/:id', requireUser, async (req, res, next) => {
    if (!validId(req.params.id)) return res.status(400).json({ success: false, message: '올바르지 않은 포트폴리오 주소입니다.' });
    try {
      const item = await Collection.findOneAndDelete({ _id: req.params.id, ownerId: req.user._id, deletedAt: { $ne: null } });
      if (!item) return res.status(404).json({ success: false, message: '휴지통에서 포트폴리오를 찾을 수 없습니다.' });
      res.json({ success: true });
    } catch (error) { next(error); }
  });
};
