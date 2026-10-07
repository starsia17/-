module.exports = function mountNotices(app, Notice, requireUser) {
  const serialize = notice => ({
    _id: notice._id, title: notice.title, content: notice.content,
    createdAt: notice.createdAt, authorName: '관리자'
  });
  app.get('/api/notices', requireUser, async (req, res, next) => {
    try {
      const notices = await Notice.find({}).sort({ createdAt: -1, _id: -1 }).lean();
      res.json({ success: true, notices: notices.map(serialize) });
    } catch (error) { next(error); }
  });
  app.post('/api/notices', requireUser, async (req, res, next) => {
    if (req.user.kind !== 'admin') return res.status(403).json({ success: false, message: '관리자만 공지사항을 등록할 수 있습니다.' });
    const title = typeof req.body.title === 'string' ? req.body.title.trim() : '';
    const content = typeof req.body.content === 'string' ? req.body.content.trim() : '';
    if (!title || !content || title.length > 120 || content.length > 25000) {
      return res.status(400).json({ success: false, message: '제목은 1~120자, 내용은 1~25,000자로 입력해주세요.' });
    }
    try {
      const notice = await Notice.create({ title, content, authorId: req.user._id });
      res.status(201).json({ success: true, notice: serialize(notice) });
    } catch (error) { next(error); }
  });
};
