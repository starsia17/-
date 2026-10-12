const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const express = require('express');
const fs = require('node:fs');
const { Types } = require('mongoose');
const { sanitizeRichText, app: unusedApp } = require('./server');
const plain = html => html.replace(/<[^>]*>/g,'');
const copy = x => x == null ? x : x instanceof Types.ObjectId ? new Types.ObjectId(x.toHexString()) :
  x instanceof Date ? new Date(x) : Array.isArray(x) ? x.map(copy) : typeof x === 'object' ?
    Object.fromEntries(Object.entries(x).map(([key,value])=>[key,copy(value)])) : x;
function matches(row, query) {
  return Object.entries(query).every(([key, value]) => {
    if (key === '$or') return value.some(q => matches(row, q));
    const path=key.split('.');function values(value,parts){if(!parts.length)return [value];if(Array.isArray(value)&&!/^\d+$/.test(parts[0]))return value.flatMap(item=>values(item,parts));return values(value?.[parts[0]],parts.slice(1));}const all=values(row,path);const actual=all[0];
    if (value && typeof value === 'object' && !(value instanceof Date)) {
      if ('$in' in value) return value.$in.some(v => String(v) === String(actual));
      if ('$ne' in value) return all.every(actual=>String(actual)!==String(value.$ne));
      if ('$gt' in value) return actual > value.$gt;
      if ('$exists' in value) return (actual !== undefined) === value.$exists;
    }
    return value == null ? actual == null : all.some(actual=>String(value)===String(actual));
  });
}
function model(rows = []) {
  function query(fn) { return { select(){return this;},sort(){return this;},lean(){return this;},then(a,b){return Promise.resolve(copy(fn())).then(a,b);} }; }
  const Model = { rows, find:q=>query(()=>rows.filter(row=>matches(row,q))), findOne:q=>query(()=>rows.find(row=>matches(row,q))||null), findById:id=>query(()=>rows.find(row=>row._id===id)||null),
    countDocuments:q=>Promise.resolve(rows.filter(row=>matches(row,q)).length),
    create:async values=> { if(rows.some(row=>values.creationKey && row.creationKey===values.creationKey && row.ownerId===values.ownerId)) throw Object.assign(Error('duplicate'),{code:11000});
      const row={_id:crypto.randomBytes(12).toString('hex'),revision:0,createdAt:new Date(),updatedAt:new Date(),deletedAt:null,expiresAt:null,...copy(values)}; rows.push(row);return copy(row); },
    findOneAndUpdate:(q,changes,opts={})=>query(()=>{let row=rows.find(row=>matches(row,q)); if(!row&&opts.upsert){row={_id:crypto.randomBytes(12).toString('hex'),...copy(changes.$setOnInsert)};rows.push(row);} if(!row)return null;Object.assign(row,copy(changes.$set||{})); for(const [key,by]of Object.entries(changes.$inc||{}))row[key]=(row[key]||0)+by;for(const[key,val]of Object.entries(changes.$push||{}))(row[key]||=[]).push(copy(val));for(const[key,val]of Object.entries(changes.$pull||{}))row[key]=(row[key]||[]).filter(item=>!matches(item,val));row.updatedAt=new Date();return row;}),
    findOneAndDelete:q=>query(()=>{const i=rows.findIndex(row=>matches(row,q));return i<0?null:rows.splice(i,1)[0];}),
    deleteMany:async q=>{for(let i=rows.length-1;i>=0;i--)if(matches(rows[i],q))rows.splice(i,1);},deleteOne:async q=>{const i=rows.findIndex(row=>matches(row,q));if(i>=0)rows.splice(i,1);} };
  return Model;
}
const alice='aaaaaaaaaaaaaaaaaaaaaaaa',bob='bbbbbbbbbbbbbbbbbbbbbbbb',postA='111111111111111111111111',postB='222222222222222222222222';
const users=model([{_id:alice,careerRevision:0},{_id:bob,careerRevision:0}]);
const posts=model([{_id:postA,ownerId:alice,title:'디자인 프로젝트',category:'디자인',description:'원본 작업 이야기',bodyHtml:'<p>원본 작업 이야기</p>',media:[],createdAt:new Date(),deletedAt:null}, {_id:postB,ownerId:bob,title:'다른 사용자 작업',category:'기타',description:'private',media:[],deletedAt:null}]);
const collections=model(),shares=model();
const app=express();require('./security').configureSecurity(app);app.use(express.json({limit:'4mb'}));
const requireUser=(req,res,next)=>{req.user={_id:req.headers['x-fixture-user']||alice};next();};
require('./career-profile')(app,users,requireUser,sanitizeRichText,plain);
require('./career-pdf-assets')(app);
const fixtureDir=fs.mkdtempSync(require('node:path').join(require('node:os').tmpdir(),'career-files-')),pdfFiles=new Map();
require('./career-templates')(app,users,requireUser,{
 upload:require('multer')({dest:fixtureDir,limits:{fileSize:20*1024*1024,files:1,fieldSize:350000}}).array('template',1),
 store:async(file,ids)=>{const id=crypto.randomBytes(12).toString('hex');ids.push(id);pdfFiles.set(id,fs.readFileSync(file.path));return {fileId:id};},
 stream:async(req,res,id)=>{const bytes=pdfFiles.get(String(id));if(!bytes)return res.sendStatus(404);res.type('pdf').send(bytes);},
 cleanupTemp:async files=>{for(const file of files)try{fs.unlinkSync(file.path);}catch{}},
 cleanupFiles:async ids=>{for(const id of ids)pdfFiles.delete(String(id));}
});

require('./portfolio-builder')(app,collections,posts,requireUser,p=>p,shares,sanitizeRichText,plain);
const fixtureImage = fs.readFileSync('public/assets/favicon.png');
require('./sharing')(app,shares,posts,collections,requireUser,(req,res)=>res.type('png').send(fixtureImage));
app.get('/api/media/:id',requireUser,(req,res)=>res.type('png').send(fixtureImage));
app.get('/api/auth/session',(req,res)=>res.json({success:true,authenticated:true,user:{id:alice,username:'preview-user',kind:'member',canWriteNews:false}}));
app.get('/api/posts',requireUser,(req,res)=>res.json({success:true,posts:copy(posts.rows.filter(p=>p.ownerId===req.user._id))}));
app.get('/api/posts/:id',requireUser,(req,res)=>{const post=posts.rows.find(p=>p._id===req.params.id&&p.ownerId===req.user._id);res.status(post?200:404).json(post?{success:true,post:copy(post)}:{success:false,message:'게시글을 찾을 수 없습니다.'});});
app.get('/api/account/security',(req,res)=>res.json({success:true,enabled:false,available:false}));
app.get('/api/account',(req,res)=>res.json({success:true,user:{id:alice,username:'preview-user',kind:'member',createdAt:new Date(),canWriteNews:false},changes:{remaining:2,resetsAt:new Date(Date.now()+86400000)}}));
app.get('/api/notices',(req,res)=>res.json({success:true,notices:[]}));
app.get('/api/news',(req,res)=>res.json({success:true,news:[],canWrite:false}));
app.use(express.static('public'));
app.use('/assets',express.static('../github-checkout/public/assets'));
app.use((err,req,res,next)=>res.status(500).json({success:false,message:err.message}));
(async()=>{
  const server=app.listen(process.argv.includes('--serve')?Number(process.env.CAREER_FIXTURE_PORT||4099):0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
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
    // A legacy client can update the original fields without losing new data.
    // MongoDB lean results contain ObjectIds, not the strings our HTTP DTO uses.
    collections.rows.find(row=>row._id===id).projectNotes[0].postId=new Types.ObjectId(postA);
    const legacy={title:'기존 화면에서 수정',introduction:'구형 소개',layout:'gallery',postIds:[postA],revision:0};
    const preserved=await call('/api/portfolios/'+id,'PATCH',legacy);assert.equal(preserved.status,200);
    for(const key of ['introductionHtml','targetCompany','targetRole','resume','projectNotes']) assert.deepEqual(preserved.data.portfolio[key],created.data.portfolio[key]);
    assert.equal((await call('/api/portfolios/'+id,'PATCH',legacy)).status,409);
    const malformed=await call('/api/portfolios/'+id,'PATCH',{...legacy,revision:1,projectNotes:null});assert.equal(malformed.status,400);
    const cleared=await call('/api/portfolios/'+id,'PATCH',{...legacy,revision:1,introductionHtml:'',targetCompany:'',targetRole:'',resume:null,projectNotes:[]});assert.equal(cleared.status,200);assert.equal(cleared.data.portfolio.resume,null);assert.deepEqual(cleared.data.portfolio.projectNotes,[]);
    // Keep the fixture useful for browser checks after the regression assertions.
    const restored=await call('/api/portfolios/'+id,'PATCH',{...body,revision:2});assert.equal(restored.status,200);
    const extra=await posts.create({ownerId:alice,title:'두 번째 프로젝트',category:'영상',description:'두 번째 원본',bodyHtml:'<p>두 번째 원본</p>',media:[]});
    const multi=await call('/api/portfolios','POST',{...body,title:'복수 작업 검토',creationKey:crypto.randomUUID(),postIds:[postA,extra._id],projectNotes:[...body.projectNotes,{postId:extra._id,bodyHtml:'<p>두 번째 설명</p>'}]});assert.equal(multi.status,201);
    const pruned=await call('/api/portfolios/'+multi.data.portfolio.id,'PATCH',{...legacy,revision:0});assert.equal(pruned.status,200);assert.deepEqual(pruned.data.portfolio.projectNotes,body.projectNotes);
    await call('/api/portfolios/'+multi.data.portfolio.id,'DELETE');
    const mediaId='333333333333333333333333';posts.rows[0].media=[{fileId:mediaId,type:'image',name:'검토 이미지',url:'/api/media/'+mediaId}];posts.rows[0].bodyHtml+='<figure><img src="/api/media/'+mediaId+'" alt="검토 이미지"></figure><p><a href="https://youtu.be/dQw4w9WgXcQ">영상 보기</a></p>';
    const withMedia=(await call('/api/shared/'+shared.data.token)).data;
    assert(withMedia.posts[0].bodyHtml.includes('/api/shared/'+shared.data.token+'/media/'+mediaId));
    assert.equal(withMedia.posts[0].media[0].url,'/api/shared/'+shared.data.token+'/media/'+mediaId);
    assert.equal((await fetch(base+withMedia.posts[0].media[0].url)).status,200);
    assert.equal((await call('/api/shared/'+shared.data.token+'/media/444444444444444444444444')).status,404);
    await call('/api/portfolios/'+duplicateId,'DELETE');assert.equal((await call('/api/portfolios/'+duplicateId)).status,404);await call('/api/trash/portfolios/'+duplicateId+'/restore','POST');assert.equal((await call('/api/portfolios/'+duplicateId)).data.portfolio.projectNotes[0].bodyHtml,'<p>회사별 설명</p>');
    await call('/api/portfolios/'+id,'DELETE');assert.equal((await call('/api/shared/'+shared.data.token)).status,404);await call('/api/trash/portfolios/'+id+'/restore','POST');
    // New upper fields preserve rich formatting and remain intact for older clients.
    const detailed={...profile,birthDate:'1995-02-28',address:'서울',experienceHtml:'<p style="font-weight:700">경력 서식</p>',educationHtml:'<p>교육</p>',skillsHtml:'<p>도구</p>',credentialsHtml:'<p>자격</p>'};
    let revision=(await call('/api/career-profile')).data.revision;
    const detailSaved=await call('/api/career-profile','PATCH',{profile:detailed,revision});assert.equal(detailSaved.status,200);
    revision=detailSaved.data.revision;const oldSaved=await call('/api/career-profile','PATCH',{profile,revision});assert.equal(oldSaved.status,200);assert.equal(oldSaved.data.profile.experienceHtml,detailed.experienceHtml);assert.equal(oldSaved.data.profile.birthDate,detailed.birthDate);
    revision=oldSaved.data.revision;assert.equal((await call('/api/career-profile','PATCH',{profile:{...detailed,birthDate:'2025-02-30'},revision})).status,400);
    const PDFDocument=require('pdf-lib').PDFDocument,doc=await PDFDocument.create();doc.addPage();const pdf=await doc.save();
    async function uploadPdf(key=crypto.randomUUID(),extra={},user=alice,bytes=pdf){const form=new FormData();form.append('template',new Blob([bytes],{type:'application/pdf'}),'fixture.pdf');form.append('creationKey',key);for(const[k,v]of Object.entries(extra))form.append(k,v);const response=await fetch(base+'/api/career-templates',{method:'POST',headers:{'x-fixture-user':user},body:form});return {status:response.status,data:await response.json()};}
    const key=crypto.randomUUID(),original=await uploadPdf(key);assert.equal(original.status,201);const fileId=original.data.file.id;
    assert.equal((await uploadPdf(key)).data.file.id,fileId);assert.equal(pdfFiles.size,1);
    assert.equal((await call('/api/career-templates/'+fileId,'GET',null,bob)).status,404);assert.equal((await call('/api/career-templates/'+fileId+'/state','GET',null,bob)).status,404);assert.equal((await call('/api/career-templates/'+fileId,'DELETE',null,bob)).status,404);
    assert.equal((await uploadPdf(crypto.randomUUID(),{},alice,Buffer.from('not pdf'))).status,400);
    const filled=await uploadPdf(crypto.randomUUID(),{sourceId:fileId,kind:'filled',editState:JSON.stringify({fields:[{name:'name',value:'홍길동'}],overlays:[]})});assert.equal(filled.status,201);
    assert.equal((await call('/api/career-templates/'+fileId,'DELETE')).status,409);
    assert.equal((await uploadPdf(crypto.randomUUID(),{sourceId:fileId,kind:'filled'},bob)).status,404);
    assert.equal((await uploadPdf(crypto.randomUUID(),{editState:JSON.stringify({fields:[],overlays:[{id:'bad',text:'x',page:0,x:-1,y:1,width:50,fontSize:12}]})})).status,400);
    assert.equal((await call('/api/career-templates/'+filled.data.file.id,'DELETE')).status,200);assert.equal((await call('/api/career-templates/'+fileId,'DELETE')).status,200);assert.equal(pdfFiles.size,0);
    for(let i=0;i<10;i++)assert.equal((await uploadPdf()).status,201);assert.equal((await uploadPdf()).status,409);
    for(const item of (await call('/api/career-templates')).data.files)await call('/api/career-templates/'+item.id,'DELETE');assert.equal(pdfFiles.size,0);
    const User=require('./models/PortfolioUser');for(const filter of [{_id:alice,'careerTemplates.9':{$exists:false},'careerTemplates.creationKey':{$ne:key}},{_id:alice,'careerTemplates.fileId':fileId,'careerTemplates.sourceId':{$ne:fileId}}])assert.doesNotThrow(()=>User.findOne(filter).cast(User));
    assert.equal((await call('/api/shared/'+shared.data.token)).status,404);
    console.log('PASS: resume upper fields/date/legacy preservation; private PDF upload, signature, idempotency, owner access, drafts, dependencies, limits, deletion and Mongoose query casting');
    console.log('PASS: private profile, sanitization, validation, owner isolation, idempotency, copy independence, revisions, preview parity, sharing revocation and restore');
    if(process.argv.includes('--serve'))console.log('Local fixture ready: '+base);else server.close();
  } catch(error){console.error(error);server.close();process.exitCode=1;}
})();
