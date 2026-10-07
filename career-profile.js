const { resume, emptyResume } = require('./career-content');
module.exports = function mount(app, User, requireUser, sanitize, plain) {
  app.get('/api/career-profile', requireUser, async (req, res, next) => {
    try {
      const user = await User.findById(req.user._id).select('careerProfile careerRevision').lean();
      if (!user) return res.status(401).json({ success: false, message: '다시 로그인해주세요.' });
      res.json({ success: true, profile: user.careerProfile || emptyResume(), revision: user.careerRevision || 0 });
    } catch (error) { next(error); }
  });
  app.patch('/api/career-profile', requireUser, async (req, res, next) => {
    let values;
    try { values = resume(req.body.profile, sanitize, plain); }
    catch (error) { return res.status(400).json({ success: false, message: error.message }); }
    const revision = req.body.revision;
    if (!Number.isSafeInteger(revision) || revision < 0) return res.status(400).json({ success: false, message: '프로필을 다시 열어서 저장해주세요.' });
    try {
      const query = { _id: req.user._id };
      if (revision === 0) query.$or = [{ careerRevision: 0 }, { careerRevision: { $exists: false } }];
      else query.careerRevision = revision;
      const user = await User.findOneAndUpdate(query, { $set: { careerProfile: values }, $inc: { careerRevision: 1 } }, { new: true, runValidators: true }).lean();
      if (!user) return res.status(409).json({ success: false, message: '다른 화면에서 프로필이 수정되었습니다. 새로 열어서 확인해주세요.' });
      res.json({ success: true, profile: user.careerProfile, revision: user.careerRevision });
    } catch (error) { next(error); }
  });
};
