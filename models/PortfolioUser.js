const mongoose = require('mongoose');
const schema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  kind: { type: String, enum: ['member', 'admin'], default: 'member' },
  passwordHash: { type: String, select: false },
  passwordKdf: { type: String, select: false },
  passwordSalt: { type: String, select: false },
  canWriteNews: { type: Boolean, default: false },
  careerProfile: { type: mongoose.Schema.Types.Mixed, default: null },
  careerRevision: { type: Number, default: 0 },
  mfaEnabled: { type: Boolean, default: false },
  mfaSecret: { type: String, select: false },
  mfaLastStep: { type: Number, default: -1 },
  mfaRecoveryHashes: { type: [String], select: false, default: [] },
  authVersion: { type: Number, default: 0 },
  accountChangeWindowStart: { type: Date, default: null },
  accountChangeCount: { type: Number, default: 0 },
  createdAt: { type: Date, default: Date.now }
});
module.exports = mongoose.model('PortfolioUser', schema, 'portfolioUsers');
