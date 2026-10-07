const fields = { name: 80, role: 120, email: 254, phone: 60, website: 2048 };
function rich(value, sanitize, plain) {
  if (typeof value !== 'string' || value.length > 150000) throw Error('편집한 글은 최대 25,000자까지 저장할 수 있습니다.');
  const html = sanitize(value);
  if (plain(html).length > 25000) throw Error('편집한 글은 최대 25,000자까지 저장할 수 있습니다.');
  return html;
}
function resume(value, sanitize, plain) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('프로필 정보를 확인해주세요.');
  const result = {};
  for (const [key, max] of Object.entries(fields)) {
    if (typeof value[key] !== 'string' || value[key].length > max) throw Error('프로필 항목의 길이를 확인해주세요.');
    result[key] = value[key].trim();
  }
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw Error('이메일 주소를 확인해주세요.');
  if (result.website) { try { if (new URL(result.website).protocol !== 'https:') throw Error(); } catch { throw Error('개인 링크는 https:// 주소로 입력해주세요.'); } }
  result.bodyHtml = rich(value.bodyHtml || '', sanitize, plain);
  return result;
}
const emptyResume = () => ({ name: '', role: '', email: '', phone: '', website: '', bodyHtml: '' });
module.exports = { rich, resume, emptyResume };
