const assert = require('node:assert/strict');
const mongoose = require('mongoose');
const { MongoClient } = require('mongodb');
const { configureMongoose, connectionOptions } = require('./mongo-security');
configureMongoose(mongoose);
const User = require('./models/PortfolioUser'), Post = require('./models/PortfolioPost'), Collection = require('./models/PortfolioCollection'), Share = require('./models/PortfolioShare');
const id = 'aaaaaaaaaaaaaaaaaaaaaaaa';
assert.equal(mongoose.get('strictQuery'), 'throw'); assert.equal(mongoose.get('bufferCommands'), false);
assert.throws(() => User.findOne({ unknownOwner: id }).cast(), /StrictModeError|not in schema/);
for (const [Model, query] of [
  [User, { _id: id, authVersion: 0, mfaSecret: 'ciphertext', mfaLastStep: { $lt: 99 } }],
  [User, { _id: id, mfaRecoveryHashes: 'hash', $or: [{ authVersion: 0 }, { authVersion: { $exists: false } }] }],
  [Post, { ownerId: id, deletedAt: null, 'media.fileId': id }],
  [Post, { deletedAt: { $ne: null }, expiresAt: { $lte: new Date() } }],
  [Collection, { ownerId: id, postIds: { $in: [id] }, revision: 0 }],
  [Share, { ownerId: id, sourceId: id, type: 'portfolio' }]
]) assert.doesNotThrow(() => Model.findOne(query).cast());
const options = connectionOptions(true), client = new MongoClient('mongodb://localhost:27017/fixture', options);
assert.equal(client.options.tls, true); assert.equal(client.options.rejectUnauthorized, true); assert.equal(client.options.checkServerIdentity, undefined); assert.equal(options.tlsAllowInvalidHostnames, false);
assert.equal(client.readPreference.mode, 'primary'); assert.equal(client.readConcern.level, 'majority'); assert.equal(client.writeConcern.w, 'majority');
assert.equal(client.options.maxPoolSize, 20); assert.equal(client.options.waitQueueTimeoutMS, 5000);
assert.equal(connectionOptions(false).tls, undefined);
// No network connection, production credentials, or database changes are used.
console.log('PASS MongoDB policy: strict filters preserve owner/MFA/media/trash/share queries, disconnected buffering disabled, validated TLS/primary/majority/client-pool options');
