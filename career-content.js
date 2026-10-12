const fields = { name: 80, role: 120, email: 254, phone: 60, website: 2048 };
const detailFields = ['experienceHtml', 'educationHtml', 'skillsHtml', 'credentialsHtml'];
const resumeSize = value => ['bodyHtml', ...detailFields].reduce((size,key)=>size+(value?.[key]?.length||0),0);
function rich(value, sanitize, plain) {
  if (typeof value !== 'string' || value.length > 150000) throw Error('편집한 글은 최대 25,000자까지 저장할 수 있습니다.');
  const html = sanitize(value);
  if (plain(html).length > 25000) throw Error('편집한 글은 최대 25,000자까지 저장할 수 있습니다.');
  return html;
}
function resume(value, sanitize, plain, existing = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw Error('프로필 정보를 확인해주세요.');
  const result = {};
  for (const [key, max] of Object.entries(fields)) {
    if (typeof value[key] !== 'string' || value[key].length > max) throw Error('프로필 항목의 길이를 확인해주세요.');
    result[key] = value[key].trim();
  }
  if (result.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(result.email)) throw Error('이메일 주소를 확인해주세요.');
  if (result.website) { try { if (new URL(result.website).protocol !== 'https:') throw Error(); } catch { throw Error('개인 링크는 https:// 주소로 입력해주세요.'); } }
  result.bodyHtml = rich(value.bodyHtml || '', sanitize, plain);
  for (const key of detailFields) result[key] = rich(Object.hasOwn(value,key)?value[key]:existing[key]||'',sanitize,plain);
  for (const [key,max] of [['birthDate',10],['address',200]]) {
    const input=Object.hasOwn(value,key)?value[key]:existing[key]||'';
    if(typeof input!=='string'||input.length>max)throw Error('개인정보 항목을 확인해주세요.');
    result[key]=input.trim();
  }
  if(result.birthDate && (!/^\d{4}-\d{2}-\d{2}$/.test(result.birthDate)||!Number.isFinite(Date.parse(result.birthDate))||new Date(result.birthDate).toISOString().slice(0,10)!==result.birthDate||result.birthDate<'1900-01-01'||result.birthDate>new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()))) throw Error('생년월일을 확인해주세요.');
  if(resumeSize(result)>600000)throw Error('이력서 전체 내용이 너무 큽니다.');
  return result;
}
const emptyResume = () => ({ name: '', role: '', email: '', phone: '', website: '', birthDate:'',address:'',bodyHtml: '',...Object.fromEntries(detailFields.map(key=>[key,''])) });
module.exports = { rich, resume, emptyResume, detailFields, resumeSize };
