// Operator-only tool. No HTTP endpoint, no secrets in argv, no plaintext database archives.
require('dotenv').config({ quiet: true });
const crypto = require('node:crypto');
const fs = require('node:fs/promises');
const { createReadStream, createWriteStream } = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pipeline } = require('node:stream/promises');
const { once } = require('node:events');
const scrypt = require('node:util').promisify(crypto.scrypt);

const FORMAT = 'portfoliv-mongodb-aes256gcm-v1';
async function backup(destination) {
  if (!process.env.MONGODB_URI) throw Error('MONGODB_URI가 설정되지 않았습니다.');
  const password = process.env.PORTFOLIV_BACKUP_PASSWORD;
  if (typeof password !== 'string' || password.length < 20) throw Error('백업 전용 PORTFOLIV_BACKUP_PASSWORD를 20자 이상으로 설정해주세요. 로그인 비밀번호와 다른 비밀번호를 사용하세요.');
  if (!destination) throw Error('암호화 백업 파일의 저장 경로를 지정해주세요.');
  const url = new URL(process.env.MONGODB_URI);
  if (!['mongodb:', 'mongodb+srv:'].includes(url.protocol)) throw Error('올바른 MongoDB 연결 설정이 필요합니다.');
  const database = decodeURIComponent(url.pathname.slice(1)) || 'test';
  const output = path.resolve(destination);
  const temp = await fs.mkdtemp(path.join(os.tmpdir(), 'portfoliv-backup-'));
  await fs.chmod(temp, 0o700);
  const config = path.join(temp, 'mongodump-config.yml');
  const salt = crypto.randomBytes(32), iv = crypto.randomBytes(12);
  const header = Buffer.from(JSON.stringify({ format: FORMAT, salt: salt.toString('base64url'), iv: iv.toString('base64url'), createdAt: new Date().toISOString() }) + '\n');
  let stream, command, created = false;
  try {
    await fs.writeFile(config, JSON.stringify({ uri: process.env.MONGODB_URI }), { mode: 0o600 });
    const key = await scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const cipher = crypto.createCipheriv('aes-256-gcm', key, iv); cipher.setAAD(header); key.fill(0);
    const handle = await fs.open(output, 'wx', 0o600); created = true; await handle.writeFile(header);
    stream = handle.createWriteStream();
    command = spawn('mongodump', ['--config', config, '--db', database, '--archive', '--gzip'], { stdio: ['ignore', 'pipe', 'ignore'] });
    // Attach rejection handling immediately, including executable-not-found errors.
    const completion = once(command, 'close').then(([code]) => { if (code !== 0) throw Error('MongoDB 백업에 실패했습니다. 접속 권한과 Database Tools 설치를 확인해주세요.'); });
    const transfer = pipeline(command.stdout, cipher, stream);
    await Promise.all([completion, transfer]);
    await fs.appendFile(output, cipher.getAuthTag());
    console.log('암호화된 데이터·GridFS 백업 파일을 생성했습니다.');
  } catch (error) {
    if (command && command.exitCode === null) command.kill();
    stream?.destroy(); if (created) await fs.unlink(output).catch(() => {});
    throw error;
  } finally { await fs.rm(temp, { recursive: true, force: true }); }
}

async function decrypt(input, destination) {
  if (!input || !destination) throw Error('입력 파일과 복호화 파일 경로가 필요합니다.');
  const password = process.env.PORTFOLIV_BACKUP_PASSWORD;
  if (!password) throw Error('PORTFOLIV_BACKUP_PASSWORD가 설정되지 않았습니다.');
  const source = await fs.open(path.resolve(input), 'r');
  let created = false;
  try {
    const size = (await source.stat()).size, prefix = Buffer.alloc(Math.min(4096, size));
    await source.read(prefix, 0, prefix.length, 0);
    const newline = prefix.indexOf(10);
    if (newline < 0 || size <= newline + 17) throw Error('올바르지 않은 백업 파일입니다.');
    const header = prefix.subarray(0, newline + 1), info = JSON.parse(header.toString('utf8'));
    if (info.format !== FORMAT) throw Error('지원하지 않는 백업 파일입니다.');
    const salt = Buffer.from(info.salt, 'base64url'), iv = Buffer.from(info.iv, 'base64url'), tag = Buffer.alloc(16);
    if (salt.length !== 32 || iv.length !== 12) throw Error('올바르지 않은 백업 파일입니다.');
    await source.read(tag, 0, 16, size - 16);
    const key = await scrypt(password, salt, 32, { N: 32768, r: 8, p: 1, maxmem: 64 * 1024 * 1024 });
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv); decipher.setAAD(header); decipher.setAuthTag(tag); key.fill(0);
    const output = await fs.open(path.resolve(destination), 'wx', 0o600); created = true;
    await pipeline(createReadStream(path.resolve(input), { start: newline + 1, end: size - 17 }), decipher, output.createWriteStream());
    console.log('백업 무결성과 비밀번호를 확인했습니다. 복호화된 파일은 본인만 접근할 수 있게 보관하고 복원 후 삭제하세요.');
  } catch { if (created) await fs.unlink(destination).catch(() => {}); throw Error('복호화에 실패했습니다. 파일과 비밀번호를 확인해주세요.'); }
  finally { await source.close(); }
}

if (require.main === module) {
  const [mode, first, second] = process.argv.slice(2);
  (mode === 'backup' ? backup(first) : mode === 'decrypt' ? decrypt(first, second) : Promise.reject(Error('backup 또는 decrypt 명령을 선택해주세요.')))
    .catch(error => { console.error(error.code === 'ENOENT' ? 'MongoDB Database Tools 설치 및 파일 경로를 확인해주세요.' : error.message); process.exitCode = 1; });
}
module.exports = { backup, decrypt };
