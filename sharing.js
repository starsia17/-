const crypto = require('crypto');
module.exports = function mount(app, Share, Post, Collection, requireUser, streamMedia) {
  const valid = req => ['post', 'portfolio'].includes(req.params.type) && /^[a-f\d]{24}$/i.test(req.params.id);
  const owned = req => ({ ownerId: req.user._id, type: req.params.type, sourceId: req.params.id });
  const notFound = res => res.status(404).json({ success: false, message: '공유가 중지되었거나 항목을 확인할 수 없습니다.' });
  async function source(type, id, ownerId) { return (type === 'post' ? Post : Collection).findOne({ _id: id, ownerId, deletedAt: null }).lean(); }
  async function shared(token) {
    if (!/^[\w-]{43}$/.test(token)) return null;
    const share = await Share.findOne({ token }).lean(); if (!share) return null;
    const item = await source(share.type, share.sourceId, share.ownerId); if (!item) return null;
    const posts = share.type === 'post' ? [item] : await Post.find({ ownerId: share.ownerId, _id: { $in: item.postIds }, deletedAt: null }).lean();
    const map = new Map(posts.map(post => [String(post._id), post]));
    return { share, item, posts: share.type === 'post' ? posts : item.postIds.map(id => map.get(String(id))).filter(Boolean) };
  }
  app.get('/api/shares/:type/:id', requireUser, async (req, res, next) => {
    if (!valid(req)) return notFound(res);
    try { if (!await source(req.params.type, req.params.id, req.user._id)) return notFound(res);
      const item = await Share.findOne(owned(req)).lean(); res.json({ success: true, token: item?.token || null });
    } catch (error) { next(error); }
  });
  app.post('/api/shares/:type/:id', requireUser, async (req, res, next) => {
    if (!valid(req)) return notFound(res);
    try {
      if (!await source(req.params.type, req.params.id, req.user._id)) return notFound(res);
      let item;
      try { item = await Share.findOneAndUpdate(owned(req), { $setOnInsert: { ...owned(req), token: crypto.randomBytes(32).toString('base64url') } }, { new: true, upsert: true, runValidators: true }).lean(); }
      catch (error) { if (error.code !== 11000) throw error; item = await Share.findOne(owned(req)).lean(); if (!item) throw error; }
      res.json({ success: true, token: item.token });
    } catch (error) { next(error); }
  });
  app.delete('/api/shares/:type/:id', requireUser, async (req, res, next) => {
    if (!valid(req)) return notFound(res);
    try { await Share.deleteOne(owned(req)); res.json({ success: true }); } catch (error) { next(error); }
  });
  app.get('/api/shared/:token', async (req, res, next) => {
    try {
      const data = await shared(req.params.token); if (!data) return notFound(res);
      const mediaPath = id => '/api/shared/' + data.share.token + '/media/' + id;
      const posts = data.posts.map(post => ({ title: post.title, category: post.category, description: post.description,
        bodyHtml: (post.bodyHtml || '').replace(/\/api\/media\/([a-f\d]{24})/gi, (_, id) => mediaPath(id)),
        media: (post.media || []).map(media => ({ type: media.type, name: media.name, url: mediaPath(media.fileId) })) }));
      res.set('Referrer-Policy', 'no-referrer');
      res.json({ success: true, type: data.share.type, title: data.item.title, introduction: data.item.introduction || '', layout: data.item.layout || 'story', posts });
    } catch (error) { next(error); }
  });
  app.get('/api/shared/:token/media/:id', async (req, res, next) => {
    if (!/^[a-f\d]{24}$/i.test(req.params.id)) return notFound(res);
    try {
      const data = await shared(req.params.token); if (!data || !data.posts.some(post => post.media?.some(media => String(media.fileId) === req.params.id.toLowerCase()))) return notFound(res);
      await streamMedia(req, res, req.params.id);
    } catch (error) { next(error); }
  });
};
