const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const { sanitizeRichText, app: unusedApp } = require('./server');
const plain = html => html.replace(/<[^>]*>/g,'');
const copy = x => x == null ? x : structuredClone(x);
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q));
    const actual = row[key];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$in' in value) return value.$in.some(v => String(v) === String(actual));
      if ('$ne' in value) return actual != value.$ne;
      if ('$gt' in value) return actual > value.$gt;
      if ('$exists' in value) return (actual !== undefined) === value.$exists;
    }
    return value == null ? actual == null : String(value) === String(actual);
  });
}
function model(rows = []) {
  function query(fn) { return { select(){return this;},sort(){return this;},lean(){return this;},then(a,b){return Promise.resolve(copy(fn())).then(a,b);} }; }
  const Model = { rows, find:q=>query(()=>rows.filter(row=>matches(row,q))), findOne:q=>query(()=>rows.find(row=>matches(row,q))||null), findById:id=>query(()=>rows.find(row=>row._id===id)||null),
    countDocuments:q=>Promise.resolve(rows.filter(row=>matches(row,q)).length),
    create:async values=> { if(rows.some(row=>values.creationKey && row.creationKey===values.creationKey && row.ownerId===values.ownerId)) throw Object.assign(Error('duplicate'),{code:11000});
      const row={_id:crypto.randomBytes(12).toString('hex'),revision:0,createdAt:new Date(),updatedAt:new Date(),deletedAt:null,expiresAt:null,...copy(values)}; rows.push(row);return copy(row); },
    findOneAndUpdate:(q,changes,opts={})=>query(()=>{let row=rows.find(row=>matches(row,q)); if(!row&&opts.upsert){row={_id:crypto.randomBytes(12).toString('hex'),...copy(changes.$setOnInsert)};rows.push(row);} if(!row)return null;Object.assign(row,copy(changes.$set||{})); for(const [key,by]of Object.entries(changes.$inc||{}))row[key]=(row[key]||0)+by;row.updatedAt=new Date();return row;}),
    findOneAndDelete:q=>query(()=>{const i=rows.findIndex(row=>matches(row,q));return i<0?null:rows.splice(i,1)[0];}),
    deleteMany:async q=>{for(let i=rows.length-1;i>=0;i--)if(matches(rows[i],q))rows.splice(i,1);},deleteOne:async q=>{const i=rows.findIndex(row=>matches(row,q));if(i>=0)rows.splice(i,1);} };
  return Model;
}
const alice='aaaaaaaaaaaaaaaaaaaaaaaa',bob='bbbbbbbbbbbbbbbbbbbbbbbb',postA='111111111111111111111111',postB='222222222222222222222222';
const users=model([{_id:alice,careerRevision:0},{_id:bob,careerRevision:0}]);
const posts=model([{_id:postA,ownerId:alice,title:'디자인 프로젝트',category:'디자인',description:'원본 작업 이야기',bodyHtml:'<p>원본 작업 이야기</p>',media:[],createdAt:new Date(),deletedAt:null}, {_id:postB,ownerId:bob,title:'다른 사용자 작업',category:'기타',description:'private',media:[],deletedAt:null}]);
const collections=model(),shares=model();
const app=express();app.use(express.json({limit:'4mb'}));
const requireUser=(req,res,next)=>{req.user={_id:req.headers['x-fixture-user']||alice};next();};
require('./career-profile')(app,users,requireUser,sanitizeRichText,plain);
require('./portfolio-builder')(app,collections,posts,requireUser,p=>p,shares,sanitizeRichText,plain);
require('./sharing')(app,shares,posts,collections,requireUser,()=>{});
app.get('/api/auth/session',(req,res)=>res.json({success:true,authenticated:true,user:{id:alice,username:'preview-user',kind:'member',canWriteNews:false}}));
app.get('/api/posts',requireUser,(req,res)=>res.json({success:true,posts:copy(posts.rows.filter(p=>p.ownerId===req.user._id))}));
app.get('/api/account',(req,res)=>res.json({success:true,user:{id:alice,username:'preview-user',kind:'member',createdAt:new Date(),canWriteNews:false},changes:{remaining:2,resetsAt:new Date(Date.now()+86400000)}}));
app.get('/api/notices',(req,res)=>res.json({success:true,notices:[]}));
app.get('/api/news',(req,res)=>res.json({success:true,news:[],canWrite:false}));
app.use(express.static('public'));
app.use('/assets',express.static('../github-checkout/public/assets'));
app.use((err,req,res,next)=>res.status(500).json({success:false,message:err.message}));
(async()=>{
  const server=app.listen(process.argv.includes('--serve')?4099:0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function call(url,method='GET',body,user=alice){const r=await fetch(base+url,{method,headers:{'Content-Type':'application/json','x-fixture-user':user},body:body?JSON.stringify(body):undefined});return {status:r.status,data:await r.json()};}
  try {
    const profile={name:'테스트 지원자',role:'디자이너',email:'test@example.com',phone:'',website:'https://example.com',bodyHtml:'<h2>경력</h2><p style="font-size:24px;color:#123456">작업 경험</p><script>alert(1)</script>'};
    const saved=await call('/api/career-profile','PATCH',{profile,revision:0});assert.equal(saved.status,200);assert.equal(saved.data.revision,1);assert(!saved.data.profile.bodyHtml.includes('script'));assert(saved.data.profile.bodyHtml.includes('font-size:24px'));
    assert.equal((await call('/api/career-profile','GET',null,bob)).data.profile.name,'');
    assert.equal((await call('/api/career-profile','PATCH',{profile,revision:0})).status,409);
    assert.equal((await call('/api/career-profile','PATCH',{profile:{...profile,website:'javascript:alert(1)'},revision:1})).status,400);
    const body={title:'취업용 포트폴리오',introduction:'소개',introductionHtml:'<p style="font-weight:700">나의 작업</p>',layout:'story',postIds:[postA],creationKey:crypto.randomUUID(),targetCompany:'비공개 지원회사',targetRole:'디자인',resume:saved.data.profile,projectNotes:[{postId:postA,bodyHtml:'<h2>문제와 해결</h2><p>프로젝트 설명</p>'}]};
    const created=await call('/api/portfolios','POST',body);assert.equal(created.status,201);const id=created.data.portfolio.id;
    assert.equal((await call('/api/portfolios','POST',body)).data.portfolio.id,id);assert.equal(collections.rows.length,1);
    assert.equal((await call('/api/portfolios','POST',{...body,creationKey:crypto.randomUUID(),postIds:[postB]})).status,400);
    assert.equal((await call('/api/portfolios','POST',{...body,creationKey:crypto.randomUUID(),projectNotes:[{postId:postB,bodyHtml:'foreign'}]})).status,400);
    assert.equal((await call('/api/portfolios/'+id,'GET',null,bob)).status,404);
    const preview=await call('/api/portfolios/'+id+'/preview');assert.equal(preview.status,200);assert.equal(preview.data.posts[0].projectHtml,body.projectNotes[0].bodyHtml);assert.equal(preview.data.resume.name,profile.name);assert.equal(preview.data.ownerId,undefined);assert.equal(preview.data.targetCompany,undefined);assert.equal(shares.rows.length,0);
    assert.equal((await call('/api/portfolios/'+id+'/preview','GET',null,bob)).status,404);
    assert.equal((await call('/api/posts/'+postA+'/preview','GET',null,bob)).status,404);
    const duplicationKey=crypto.randomUUID();const duplicated=await call('/api/portfolios/'+id+'/duplicate','POST',{creationKey:duplicationKey});const duplicateId=duplicated.data.portfolio.id;assert.notEqual(duplicateId,id);assert.equal(duplicated.data.portfolio.projectNotes[0].bodyHtml,body.projectNotes[0].bodyHtml);
    assert.equal((await call('/api/portfolios/'+id+'/duplicate','POST',{creationKey:duplicationKey})).data.portfolio.id,duplicateId);assert.equal(collections.rows.length,2);
    assert.equal((await call('/api/portfolios/'+id+'/duplicate','POST',{creationKey:crypto.randomUUID()},bob)).status,404);
    const change={...body,title:'회사 A 포트폴리오',resume:null,revision:0,projectNotes:[{postId:postA,bodyHtml:'<p>회사별 설명</p>'}]};assert.equal((await call('/api/portfolios/'+duplicateId,'PATCH',change)).status,200);
    assert.equal((await call('/api/portfolios/'+duplicateId,'PATCH',change)).status,409);assert.equal((await call('/api/portfolios/'+id)).data.portfolio.projectNotes[0].bodyHtml,body.projectNotes[0].bodyHtml);
    const shared=await call('/api/shares/portfolio/'+id,'POST');const publicData=(await call('/api/shared/'+shared.data.token)).data;assert.deepEqual(publicData,preview.data);assert.equal(publicData.targetCompany,undefined);
    await call('/api/portfolios/'+duplicateId,'DELETE');assert.equal((await call('/api/portfolios/'+duplicateId)).status,404);await call('/api/trash/portfolios/'+duplicateId+'/restore','POST');assert.equal((await call('/api/portfolios/'+duplicateId)).data.portfolio.projectNotes[0].bodyHtml,'<p>회사별 설명</p>');
    await call('/api/portfolios/'+id,'DELETE');assert.equal((await call('/api/shared/'+shared.data.token)).status,404);await call('/api/trash/portfolios/'+id+'/restore','POST');
    console.log('PASS: private profile, sanitization, validation, owner isolation, idempotency, copy independence, revisions, preview parity, sharing revocation and restore');
    if(process.argv.includes('--serve'))console.log('Local fixture ready: '+base);else server.close();
  } catch(error){console.error(error);server.close();process.exitCode=1;}
})();
