const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  ownerId: { type: mongoose.Schema.Types.ObjectId, required: true, ref: 'PortfolioUser' },
  title: { type: String, required: true, maxlength: 100 },
  introduction: { type: String, default: '', maxlength: 2000 },
  layout: { type: String, enum: ['auto', 'gallery', 'story'], default: 'auto' },
  postIds: { type: [mongoose.Schema.Types.ObjectId], required: true },
  creationKey: { type: String, required: true },
  revision: { type: Number, default: 0 },
  deletedAt: { type: Date, default: null },
  expiresAt: { type: Date, default: null }
}, { timestamps: true });
schema.index({ ownerId: 1, updatedAt: -1 });
schema.index({ ownerId: 1, creationKey: 1 }, { unique: true });
schema.index({ ownerId: 1, deletedAt: 1, updatedAt: -1 });
schema.index({ expiresAt: 1 }, { expireAfterSeconds: 0, partialFilterExpression: { expiresAt: { $type: 'date' } } });
module.exports = mongoose.model('PortfolioCollection', schema, 'portfolioCollections');
