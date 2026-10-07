const mongoose = require('mongoose');

const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  content: { type: String, required: true, trim: true, maxlength: 25000 },
  bodyHtml: { type: String, default: '', maxlength: 150000 },
  revision: { type: Number, default: 0 },
  updatedAt: { type: Date, default: null },
  creationKey: { type: String },
  authorId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'PortfolioUser' },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ createdAt: -1, _id: -1 });
schema.index({ authorId: 1, creationKey: 1 }, { unique: true, partialFilterExpression: { creationKey: { $type: 'string' } } });
module.exports = mongoose.model('PortfolioNotice', schema, 'portfolioNotices');
