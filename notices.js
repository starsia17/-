module.exports = function mountNotices(app, Notice, requireUser, sanitize, plainText) {
  const validId = id => /^[a-f\d]{24}$/i.test(id);
  const summary = notice => ({ _id: notice._id, title: notice.title, createdAt: notice.createdAt,
    updatedAt: notice.updatedAt || null, authorName: '관리자', revision: notice.revision || 0 });
  const serialize = notice => ({ ...summary(notice), content: notice.content, bodyHtml: notice.bodyHtml || '' });
  function input(body) {
    const title = typeof body?.title === 'string' ? body.title.trim() : '';
    if (!title || title.length > 120) return null;
    if (body.bodyHtml !== undefined && (typeof body.bodyHtml !== 'string' || body.bodyHtml.length > 150000)) return null;
    const bodyHtml = typeof body.bodyHtml === 'string' ? sanitize(body.bodyHtml) : '';
    const content = bodyHtml ? plainText(bodyHtml).trim() : typeof body.content === 'string' ? body.content.trim() : '';
    if (!content || content.length > 25000 || bodyHtml.length > 150000) return null;
    return { title, content, bodyHtml };
  }
  const invalid = res => res.status(400).json({ success: false, message: '제목은 1~120자, 본문은 1~25,000자로 입력해주세요. 서식을 포함한 본문은 150,000자 이내여야 합니다.' });
  app.get('/api/notices', requireUser, async (req, res, next) => {
    try { const rows = await Notice.find({}).select('title createdAt updatedAt revision').sort({ createdAt: -1, _id: -1 }).lean();
      res.json({ success: true, notices: rows.map(summary) }); } catch (error) { next(error); }
  });
  app.get('/api/notices/:id', requireUser, async (req, res, next) => {
    if (!validId(req.params.id)) return invalid(res);
    try { const notice = await Notice.findById(req.params.id).lean();
      if (!notice) return res.status(404).json({ success: false, message: '공지사항을 찾을 수 없습니다.' });
      res.json({ success: true, notice: serialize(notice) }); } catch (error) { next(error); }
  });
  app.post('/api/notices', requireUser, async (req, res, next) => {
    if (req.user.kind !== 'admin') return res.status(403).json({ success: false, message: '관리자만 공지사항을 등록할 수 있습니다.' });
    const values = input(req.body), key = req.body?.creationKey;
    if (!values || key !== undefined && (typeof key !== 'string' || !/^[\w-]{16,80}$/.test(key))) return invalid(res);
    try {
      let notice = key ? await Notice.findOne({ authorId: req.user._id, creationKey: key }).lean() : null;
      if (!notice) {
        try { notice = await Notice.create({ ...values, authorId: req.user._id, ...(key ? { creationKey: key } : {}) }); }
        catch (error) { if (error.code !== 11000 || !key) throw error; notice = await Notice.findOne({ authorId: req.user._id, creationKey: key }).lean(); if (!notice) throw error; }
      }
      res.status(201).json({ success: true, notice: serialize(notice) });
    } catch (error) { next(error); }
  });
  app.patch('/api/notices/:id', requireUser, async (req, res, next) => {
    if (req.user.kind !== 'admin') return res.status(403).json({ success: false, message: '관리자만 공지사항을 수정할 수 있습니다.' });
    const values = input(req.body), revision = req.body?.revision;
    if (!validId(req.params.id) || !values || !Number.isSafeInteger(revision) || revision < 0) return invalid(res);
    try {
      const query = { _id: req.params.id, ...(revision === 0 ? { $or: [{ revision: 0 }, { revision: { $exists: false } }] } : { revision }) };
      const notice = await Notice.findOneAndUpdate(query, { $set: { ...values, updatedAt: new Date() }, $inc: { revision: 1 } }, { new: true, runValidators: true }).lean();
      if (!notice) return res.status(409).json({ success: false, message: '공지사항이 변경되었거나 삭제되었습니다. 다시 열어서 수정해주세요.' });
      res.json({ success: true, notice: serialize(notice) });
    } catch (error) { next(error); }
  });
};
