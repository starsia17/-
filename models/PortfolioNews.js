const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  title: { type: String, required: true, trim: true, maxlength: 120 },
  content: { type: String, required: true, trim: true, maxlength: 25000 },
  sourceUrl: { type: String, default: '', maxlength: 2048 },
  authorId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'PortfolioUser' },
  authorName: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ createdAt: -1, _id: -1 });
module.exports = mongoose.model('PortfolioNews', schema, 'portfolioNews');
