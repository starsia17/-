const crypto = require('node:crypto');
const scrypt = require('node:util').promisify(crypto.scrypt);
const CURRENT_KDF = 'scrypt-v2';
let active = 0;
async function passwordHash(password, salt, kdf) {
  // Bound expensive hashing on the single Render instance, rather than queueing unlimited jobs.
  if (active >= 3) throw Object.assign(Error('로그인 요청이 많습니다. 잠시 후 다시 시도해주세요.'), { code: 'PASSWORD_BUSY' });
  ++active;
  try {
    const options = kdf === CURRENT_KDF ? { N: 65536, r: 8, p: 2, maxmem: 96 * 1024 * 1024 } : {};
    return (await scrypt(password, salt, 64, options)).toString('hex');
  } finally { --active; }
}
module.exports = { passwordHash, CURRENT_KDF };
