const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true },
  type: { type: String, enum: ['post', 'portfolio'], required: true },
  sourceId: { type: mongoose.Schema.Types.ObjectId, required: true },
  token: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});
schema.index({ ownerId: 1, type: 1, sourceId: 1 }, { unique: true });
schema.index({ token: 1 }, { unique: true });
module.exports = mongoose.model('PortfolioShare', schema, 'portfolioShares');
