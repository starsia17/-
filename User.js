const mongoose = require('mongoose');
const { v4: uuidv4 } = require('uuid');

const UserSchema = new mongoose.Schema({
  ip: { type: String, required: true, unique: true }, // IP당 1개 프로필
  uid: { type: String, required: true, unique: true, default: uuidv4 }, // 다른 사용자에게 노출되는 익명 식별자 (IP 대신 사용)
  nickname: { type: String, required: true, trim: true, maxlength: 20 },
  avatar: { type: String, default: '' }, // 이미지 URL 또는 base64
  createdAt: { type: Date, default: Date.now }
});

module.exports = mongoose.model('User', UserSchema);
