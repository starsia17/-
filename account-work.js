// Local counters and MongoDB write leases keep withdrawal safe across aborts, restarts and overlapping service processes.
module.exports=function createAccountWork({User}={}){
 const active=new Map(),blocked=new Set(),listeners=new Map();
 async function begin(req,id){
  if(req.accountWrite||['GET','HEAD','OPTIONS'].includes(req.method)||req.method==='DELETE'&&req.path==='/api/account')return true;
  const key=String(id);if(blocked.has(key)||req.res?.destroyed)return false;
  const leaseId=require('node:crypto').randomUUID();
  if(User){await User.updateOne({_id:id,accountDeletionAt:null},{$pull:{accountWriteLeases:{expiresAt:{$lte:new Date()}}}});const saved=await User.updateOne({_id:id,accountDeletionAt:null,'accountWriteLeases.99':{$exists:false}},{$push:{accountWriteLeases:{id:leaseId,expiresAt:new Date(Date.now()+30*60000)}}});if(saved.modifiedCount!==1)return false;}
  active.set(key,(active.get(key)||0)+1);let released=false;
  req.accountWrite=async()=>{if(released)return;released=true;if(User)try{await User.updateOne({_id:id},{$pull:{accountWriteLeases:{id:leaseId}}});}catch{}const count=(active.get(key)||1)-1;if(count)active.set(key,count);else{active.delete(key);for(const notify of listeners.get(key)||[])notify();}};
  const responseEnded=()=>{if(!req.accountHandlerRunning)req.accountWrite();};req.res?.once('finish',responseEnded);req.res?.once('close',responseEnded);return true;
 }
 function install(app){for(const method of ['get','post','put','patch','delete']){const original=app[method];app[method]=function(...args){if(args.length>1&&typeof args.at(-1)==='function'){const handler=args.pop();args.push(function(req,res,next){if(res.destroyed&&req.accountWrite){req.accountWrite();return;}req.accountHandlerRunning=true;let result;try{result=handler(req,res,next);}catch(error){req.accountHandlerRunning=false;req.accountWrite?.();return next(error);}Promise.resolve(result).catch(next).finally(()=>{req.accountHandlerRunning=false;req.accountWrite?.();});});}return original.apply(this,args);};}}
 async function waitLocal(id,timeout=8000){const key=String(id);if(!active.has(key))return true;return new Promise(resolve=>{let settled=false;const done=()=>{if(settled)return;settled=true;clearTimeout(timer);const set=listeners.get(key);set?.delete(check);if(!set?.size)listeners.delete(key);resolve(!active.has(key));},check=()=>{if(!active.has(key))done();},timer=setTimeout(done,timeout);if(!listeners.has(key))listeners.set(key,new Set());listeners.get(key).add(check);check();});}
 async function wait(id,timeout=8000){const started=Date.now();if(!await waitLocal(id,timeout))return false;if(!User)return true;do{if(!await User.findOne({_id:id,'accountWriteLeases.expiresAt':{$gt:new Date()}}).select('_id'))return true;await new Promise(resolve=>setTimeout(resolve,200));}while(Date.now()-started<timeout);return false;}
 return {begin,install,wait,block:id=>blocked.add(String(id)),unblock:id=>blocked.delete(String(id)),isBlocked:id=>blocked.has(String(id))};
};
