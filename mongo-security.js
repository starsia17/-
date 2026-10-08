function configureMongoose(mongoose) {
  // Unknown filter fields must fail instead of silently broadening a query.
  mongoose.set('strictQuery', 'throw');
  // A disconnected database must not accumulate an unbounded command queue.
  mongoose.set('bufferCommands', false);
}

function connectionOptions(secure) {
  return {
    serverSelectionTimeoutMS: 10000,
    maxPoolSize: 20, minPoolSize: 0, maxConnecting: 2,
    waitQueueTimeoutMS: 5000, socketTimeoutMS: 30000,
    readPreference: 'primary', readConcern: { level: 'majority' },
    writeConcern: { w: 'majority', wtimeoutMS: 10000 },
    retryReads: true, retryWrites: true,
    ...(secure ? { tls: true, tlsAllowInvalidCertificates: false, tlsAllowInvalidHostnames: false } : {})
  };
}

module.exports = { configureMongoose, connectionOptions };
