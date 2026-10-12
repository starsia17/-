const assert = require('node:assert/strict');
const {EventEmitter} = require('node:events');
const express = require('express');
const {createTokenBucket,createIpConcurrencyLimit,createBodyBudget,configureSecurity} = require('./security');

function response() {
  const res=new EventEmitter(); res.headers={}; res.statusCode=200;
  res.set=(key,value)=>{res.headers[key]=value;return res;};
  res.status=code=>{res.statusCode=code;return res;};
  res.json=()=>res; return res;
}
function admission(limiter,ip='a') { const res=response(); let admitted=false; limiter({ip},res,()=>{admitted=true;}); return {res,admitted}; }

(async()=>{
  let now=0;
  const bucket=createTokenBucket({capacity:2,refillPerSecond:1,maxKeys:2,clock:()=>now});
  assert.equal(admission(bucket).admitted,true); assert.equal(admission(bucket).admitted,true);
  const denied=admission(bucket); assert.equal(denied.res.statusCode,429); assert.equal(denied.res.headers['Retry-After'],'1');
  now=500; assert.equal(admission(bucket).admitted,false);
  now=1000; assert.equal(admission(bucket).admitted,true); assert.equal(admission(bucket).admitted,false);
  // Crossing a wall-clock second cannot refill the whole burst budget.
  now=1999; assert.equal(admission(bucket).admitted,false);
  now=2000; assert.equal(admission(bucket).admitted,true);
  assert.equal(admission(bucket,'b').admitted,true); assert.equal(admission(bucket,'c').admitted,false);
  now=62000; assert.equal(admission(bucket,'c').admitted,true);
  const slots=createIpConcurrencyLimit(2), first=admission(slots), second=admission(slots);
  assert.equal(first.admitted,true); assert.equal(second.admitted,true); assert.equal(admission(slots).res.statusCode,503);
  assert.equal(admission(slots,'b').admitted,true);
  first.res.emit('finish'); first.res.emit('close');
  const replacement=admission(slots); assert.equal(replacement.admitted,true); assert.equal(admission(slots).admitted,false);
  replacement.res.emit('close'); assert.equal(admission(slots).admitted,true);
  const bodyBudget=createBodyBudget({limitBytes:6,maxRequestBytes:4});
  const bodyAdmission=(headers,json=true)=>{const res=response();let admitted=false;bodyBudget({headers,is:()=>json},res,()=>{admitted=true;});return {res,admitted};};
  const large=bodyAdmission({'content-length':'4'});assert.equal(large.admitted,true);
  assert.equal(bodyAdmission({'content-length':'4'}).res.statusCode,503);
  assert.equal(bodyAdmission({'content-length':'5'}).res.statusCode,413);
  assert.equal(bodyAdmission({'content-length':'invalid'}).res.statusCode,400);
  assert.equal(bodyAdmission({'content-length':'500'},false).admitted,true);
  large.res.emit('finish');large.res.emit('close');
  const chunked=bodyAdmission({'transfer-encoding':'chunked'});assert.equal(chunked.admitted,true);
  assert.equal(bodyAdmission({'content-length':'3'}).admitted,false);
  chunked.res.emit('close');assert.equal(bodyAdmission({'content-length':'4'}).admitted,true);
  // Hold real HTTP requests locally. Never send attack traffic to production.
  const app=express(); configureSecurity(app);
  const releases=[];
  app.get('/api/hold',(req,res)=>releases.push(()=>res.end('released')));
  app.get('/api/health',(req,res)=>res.json({healthy:true}));
  app.get('/api/normal',(req,res)=>res.json({ok:true}));
  const server=app.listen(0,'127.0.0.1'); await new Promise(resolve=>server.once('listening',resolve));
  const base='http://127.0.0.1:'+server.address().port;
  const held=Array.from({length:24},()=>fetch(base+'/api/hold'));
  try {
    for(let i=0;releases.length<24&&i<100;i++)await new Promise(resolve=>setTimeout(resolve,10));
    assert.equal(releases.length,24);
    assert.equal((await fetch(base+'/api/normal')).status,503);
    const probe=await fetch(base+'/api/health'); assert.equal(probe.status,200); assert.equal((await probe.json()).healthy,true);
    // Raw HTTP verifies health body rejection before JSON parsing.
    const http=require('node:http');
    const rawStatus=await new Promise((resolve,reject)=>{const req=http.request(base+'/api/health',{method:'GET',headers:{'Content-Length':'1'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end('x');});
    assert.equal(rawStatus,400);
    releases.splice(0).forEach(release=>release()); await Promise.all(held);
    assert.equal((await fetch(base+'/api/normal')).status,200);
  } finally { releases.forEach(release=>release()); server.closeAllConnections();server.close(); }
  console.log('PASS DDoS admission: monotonic refill, burst denial, bounded map expiry, per-IP isolation, aborted/finished slot release, HTTP overload rejection, independent health budget and recovery');
})().catch(error=>{console.error(error);process.exitCode=1;});
