// All ownership comes from the authenticated session. No client-supplied owner is accepted.
module.exports=function mount(app,{User,Session,Post,Collection,Share,News,Notice,auth,work,removeFiles,ownedMediaIds=async()=>[],retireAdmin=async()=>{}}){
 const running=new Map();
 async function removeOwnedFiles(owner,ids){
  const valid=[...new Set(ids.map(String))].filter(id=>/^[a-f\d]{24}$/i.test(id));if(!valid.length)return;
  // Preserve any reference held by another account, even for legacy inconsistent data.
  const [postRefs,userRefs,pendingRefs]=await Promise.all([Post.distinct('media.fileId',{ownerId:{$ne:owner},'media.fileId':{$in:valid}}),User.distinct('careerTemplates.fileId',{_id:{$ne:owner},'careerTemplates.fileId':{$in:valid}}),User.distinct('accountDeletionFiles',{_id:{$ne:owner},accountDeletionFiles:{$in:valid}})]);
  const foreign=new Set([...postRefs,...userRefs,...pendingRefs].map(String));await removeFiles(valid.filter(id=>!foreign.has(id)),owner);
 }
 async function cleanup(owner){
  const key=String(owner);if(running.has(key))return running.get(key);
  const operation=(async()=>{
   work.block(owner);if(!await work.wait(owner))return false;
   let user=await User.findById(owner).lean();if(!user||!user.accountDeletionAt){work.unblock(owner);return !user;}
   if(user.kind==='admin')await retireAdmin();
   await Session.deleteMany({userId:owner});await Share.deleteMany({ownerId:owner});
   await removeOwnedFiles(owner,user.accountDeletionFiles||[]);
   await User.updateOne({_id:owner,accountDeletionAt:{$ne:null}},{$set:{accountDeletionFiles:[]}});
   while(true){
    const posts=await Post.find({ownerId:owner}).select('_id media').limit(100).lean();if(!posts.length)break;
    const ids=posts.flatMap(post=>(post.media||[]).map(media=>media.fileId));
    await User.updateOne({_id:owner,accountDeletionAt:{$ne:null}},{$set:{accountDeletionFiles:ids}});
    await Post.deleteMany({ownerId:owner,_id:{$in:posts.map(post=>post._id)}});
    await removeOwnedFiles(owner,ids);await User.updateOne({_id:owner},{$set:{accountDeletionFiles:[]}});
   }
   user=await User.findById(owner).lean();
   const ids=[...(user?.careerTemplates||[]).map(file=>file.fileId),...await ownedMediaIds(owner)];
   for(let offset=0;offset<ids.length;offset+=1000){const batch=ids.slice(offset,offset+1000);await User.updateOne({_id:owner},{$set:{accountDeletionFiles:batch}});await removeOwnedFiles(owner,batch);}
   await Collection.deleteMany({ownerId:owner});await News.deleteMany({authorId:owner});await Notice.deleteMany({authorId:owner});
   await Share.deleteMany({ownerId:owner});await Session.deleteMany({userId:owner});
   await User.deleteOne({_id:owner,accountDeletionAt:{$ne:null}});work.unblock(owner);return true;
  })();running.set(key,operation);
  try{return await operation;}finally{running.delete(key);}
 }
 app.delete('/api/account',auth.requireUser,async(req,res,next)=>{
  if(!req.body||req.body.confirmed!==true||Object.keys(req.body).some(key=>key!=='confirmed'))return res.status(400).json({success:false,message:'본인 계정 탈퇴를 확인해주세요.'});
  const owner=req.user._id;work.block(owner);
  try{
   const user=await User.findOneAndUpdate({_id:owner,accountDeletionAt:null},{$set:{accountDeletionAt:new Date()},$inc:{authVersion:1}},{new:true});
   if(!user){work.unblock(owner);return res.status(409).json({success:false,message:'계정 상태가 변경되었습니다. 다시 확인해주세요.'});}
   auth.forgetAccount?.(owner);await Session.deleteMany({userId:owner});await Share.deleteMany({ownerId:owner});
   let completed=false;try{completed=await cleanup(owner);}catch(error){console.error('회원탈퇴 자료 정리 재시도 필요:',error.name||'Error');}
   res.status(completed?200:202).json({success:true,pending:!completed,message:completed?'회원탈퇴가 완료되었습니다. 본인 계정과 자료를 삭제했습니다.':'탈퇴가 접수되어 로그인을 차단했습니다. 진행 중인 작업이나 일시적인 연결 문제로 남은 자료는 자동 정리합니다.'});
  }catch(error){let user;try{user=await User.findById(owner).lean();}catch{}if(user?.accountDeletionAt)return res.status(202).json({success:true,pending:true,message:'탈퇴가 접수되어 로그인을 차단했습니다. 남은 자료는 자동 정리합니다.'});work.unblock(owner);next(error);}
 });
 let scanning=false;
 async function resume(){if(scanning)return;scanning=true;try{let after;while(true){const query={accountDeletionAt:{$ne:null}};if(after)query._id={$gt:after};const users=await User.find(query).select('_id').sort({_id:1}).limit(100).lean();for(const user of users)try{await cleanup(user._id);}catch(error){console.error('회원탈퇴 자료 정리 재시도 필요:',error.name||'Error');}if(users.length<100)break;after=users.at(-1)._id;}}finally{scanning=false;}}
 return {cleanup,resume};
};
