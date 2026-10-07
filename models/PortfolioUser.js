const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['member', 'admin'], default: 'member' },
  passwordHash: { type: String, select: false },
  passwordSalt: { type: String, select: false },
  canWriteNews: { type: Boolean, default: false },
  authVersion: { type: Number, default: 0 },
  accountChangeWindowStart: { type: Date, default: null },
  accountChangeCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('PortfolioUser', schema, 'portfolioUsers');
