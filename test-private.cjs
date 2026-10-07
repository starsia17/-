const assert = require('node:assert/strict');
const crypto = require('crypto');
process.env.PORTFOLIO_ADMIN_PASSWORD = 'fixture-admin-password';
process.env.NODE_ENV = 'test';
const stores = { User: [], Session: [], Post: [], Collection: [], Share: [] };
function matches(doc, query) {
  return Object.entries(query).every(([key, value]) => {
    const actual = key === 'media.fileId' ? (doc.media || []).map(x => String(x.fileId)) : doc[key];
    if (value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Date)) {
      if ('$in' in value && !value.$in.some(x => String(x) === String(actual))) return false;
      if ('$ne' in value && (actual == null ? value.$ne == null : String(actual) === String(value.$ne))) return false;
      if ('$gt' in value && !(actual > value.$gt)) return false;
      if ('$lte' in value && !(actual <= value.$lte)) return false;
      return true;
    }
    if (Array.isArray(actual)) return actual.includes(String(value));
    return value == null ? actual == null : String(actual) === String(value);
  });
}
function query(fn) { return { sort() { return this; }, select() { return this; }, lean() { return this; }, then(a,b) { return Promise.resolve(fn()).then(a,b); } }; }
function model(name) {
  const store = stores[name];
  const create = async data => {
    if (name === 'User' && store.some(x => x.username === data.username)) throw Object.assign(Error('duplicate'), {code:11000});
    const doc = { _id: crypto.randomBytes(12).toString('hex'), createdAt: new Date(), deletedAt:null, expiresAt:null, ...data };
    Object.defineProperty(doc, 'save', { value: async () => doc });
    store.push(doc); return doc;
  };
  return {
    create, find: q => query(() => store.filter(x => matches(x,q))),
    findOne: q => query(() => store.find(x => matches(x,q)) || null),
    findById: id => query(() => store.find(x => String(x._id) === String(id)) || null),
    async updateMany(q, change) { let count=0; store.filter(x => matches(x,q)).forEach(x => { Object.assign(x,change.$set);count++; }); return {modifiedCount:count}; },
    async updateOne(q, change) { const x=store.find(x => matches(x,q)); if(x)Object.assign(x,change.$set); },
    async findOneAndUpdate(q, change, options={}) { let x=store.find(x => matches(x,q)); if(!x && options.upsert)x=await create(change.$setOnInsert); if(x && change.$set)Object.assign(x,change.$set);return x; },
    async findOneAndDelete(q) { const i=store.findIndex(x => matches(x,q));return i<0?null:store.splice(i,1)[0]; },
    async deleteOne(q) { const i=store.findIndex(x => matches(x,q));if(i>=0)store.splice(i,1); },
    async deleteMany(q) { for(let i=store.length-1;i>=0;i--)if(matches(store[i],q))store.splice(i,1); }
  };
}
for (const [file,name] of [['PortfolioUser','User'],['PortfolioSession','Session'],['PortfolioPost','Post'],['PortfolioCollection','Collection'],['PortfolioShare','Share']]) {
  const path=require.resolve('./models/'+file); require.cache[path]={id:path,filename:path,loaded:true,exports:model(name)};
}
const {app,auth,sanitizeRichText}=require('./server');
const Post=require('./models/PortfolioPost');
const legacyId='aaaaaaaaaaaaaaaaaaaaaaaa', foreignFile='bbbbbbbbbbbbbbbbbbbbbbbb';
(async () => {
  await Post.create({_id:legacyId,title:'legacy',bodyHtml:'<p>original</p>',media:[{fileId:foreignFile,type:'image'}]});
  await auth.initializeAdmin(Post);
  assert.equal(stores.Post[0].ownerId,stores.User[0]._id);
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve => server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  async function call(path,{method='GET',body,cookie,tab,origin}={}) {
    const headers={}; if(cookie)headers.Cookie=cookie; if(tab)headers['X-Portfolio-Tab']=tab;if(origin)headers.Origin=origin;
    if(body && !(body instanceof FormData)) {headers['Content-Type']='application/json';body=JSON.stringify(body);}
    const response=await fetch(base+path,{method,headers,body});return {status:response.status,data:await response.json(),cookie:response.headers.get('set-cookie')};
  }
  try {
    assert.equal((await call('/api/posts')).status,401);
    assert.equal((await call('/api/trash')).status,401);
    assert.equal((await call('/api/media/'+foreignFile)).status,401);
    assert.equal((await call('/api/auth/register',{method:'POST',body:{username:'alice',password:'secure-pass-1',passwordConfirm:'wrong'}})).status,400);
    for (const username of ['alice','bob']) assert.equal((await call('/api/auth/register',{method:'POST',body:{username,password:'secure-pass-1',passwordConfirm:'secure-pass-1'}})).status,201);
    assert.equal((await call('/api/auth/register',{method:'POST',body:{username:'alice',password:'secure-pass-1',passwordConfirm:'secure-pass-1'}})).status,409);
    assert.equal(stores.User[1].password,undefined);assert.equal(stores.User[1].passwordHash.length,128);
    const tab=crypto.randomUUID();
    const a=await call('/api/auth/login',{method:'POST',body:{username:'alice',password:'secure-pass-1',tabToken:tab,remember:false}});
    assert.equal(a.status,200);assert.ok(!/Max-Age|Expires/i.test(a.cookie));assert.match(a.cookie,/HttpOnly/);
    const alice={cookie:a.cookie.split(';')[0],tab};
    assert.equal((await call('/api/posts',{cookie:alice.cookie,tab:crypto.randomUUID()})).status,401);
    assert.equal((await call('/api/posts',alice)).data.posts.length,0);
    assert.equal((await call('/api/posts/'+legacyId,alice)).status,404);
    assert.equal((await call('/api/media/'+foreignFile,alice)).status,404);
    assert.equal((await call('/api/posts/'+legacyId,{...alice,method:'DELETE'})).status,404);
    const form=new FormData();form.set('title','Alice post');form.set('bodyHtml','<p>'+'가'.repeat(25000)+'</p>');form.set('ownerId',stores.User[0]._id);
    const made=await call('/api/posts',{...alice,method:'POST',body:form});assert.equal(made.status,201);
    const id=made.data.post._id;assert.equal(made.data.post.ownerId,stores.User[1]._id);
    const b=await call('/api/auth/login',{method:'POST',body:{username:'bob',password:'secure-pass-1',tabToken:crypto.randomUUID(),remember:true}});
    const bob={cookie:b.cookie.split(';')[0]};assert.equal((await call('/api/posts',bob)).status,200);
    assert.equal((await call('/api/posts',bob)).data.posts.length,0);
    assert.equal((await call('/api/posts/'+id,bob)).status,404);
    const edit=new FormData();edit.set('title','stolen');edit.set('bodyHtml','<p>changed</p>');
    assert.equal((await call('/api/posts/'+id,{...bob,method:'PUT',body:edit})).status,404);
    assert.equal((await call('/api/posts/'+id,{...alice,method:'DELETE'})).status,200);
    assert.equal((await call('/api/trash',bob)).data.posts.length,0);
    assert.equal((await call('/api/trash/'+id+'/restore',{...bob,method:'POST'})).status,404);
    assert.equal((await call('/api/trash/'+id,{...bob,method:'DELETE'})).status,404);
    assert.equal((await call('/api/trash/restore',{...bob,method:'POST',body:{ids:[id]}})).data.restored,0);
    assert.equal((await call('/api/trash/restore',{...alice,method:'POST',body:{ids:[id,legacyId]}})).data.restored,1);
    assert.equal((await call('/api/posts/'+id,alice)).data.post.bodyHtml,made.data.post.bodyHtml);
    assert.equal((await call('/api/auth/logout',{...alice,method:'POST',origin:'https://evil.example'})).status,403);
    const admin=await call('/api/auth/admin/login',{method:'POST',body:{password:'fixture-admin-password',tabToken:tab,remember:false}});
    const administrator={cookie:admin.cookie.split(';')[0],tab};
    assert.deepEqual((await call('/api/posts',administrator)).data.posts.map(x=>x._id),[legacyId]);
    assert.equal((await call('/api/posts/'+id,administrator)).status,404);
    const sanitized=sanitizeRichText('<img src="/api/media/'+foreignFile+'"><a href="/api/media/'+foreignFile+'">file</a><script>alert(1)</script>');
    assert.ok(!sanitized.includes('/api/media/'));assert.ok(!sanitized.includes('<script'));
    stores.Session.find(x=>x.userId===stores.User[2]._id).lastSeenAt=new Date(Date.now()-31*60000);
    assert.equal((await call('/api/posts',bob)).status,401);
    assert.equal((await call('/api/auth/logout',{...alice,method:'POST'})).status,200);
    assert.equal((await call('/api/posts',alice)).status,401);
    console.log('PASS: real HTTP routes with isolated in-memory model fixtures; registration, password hashing, admin migration, user isolation, foreign CRUD/media/trash, bulk restore, 25,000 chars, tab binding, idle expiry, logout, origin protection and sanitization.');
    if(process.env.FIXTURE_SERVER) { console.log('Fixture UI server '+base);return; }
  } finally { if(!process.env.FIXTURE_SERVER)server.close(); }
})().catch(error=>{console.error(error);process.exit(1);});
