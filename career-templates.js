const fs=require('node:fs/promises');
const path=require('node:path');
const MAX_FILES=10,MAX_BYTES=20*1024*1024;
const validId=id=>typeof id==='string'&&/^[a-f\d]{24}$/i.test(id);
function draftState(value) {
  if(!value)return null;
  if(typeof value==='string'){if(value.length>300000)throw Error('PDF 작성 내용이 너무 큽니다.');value=JSON.parse(value);}
  if(!value||!Array.isArray(value.fields)||!Array.isArray(value.overlays)||value.fields.length>400||value.overlays.length>100)throw Error('PDF 작성 내용을 확인해주세요.');
  const fields=value.fields.map(item=>{
    if(!item||typeof item.name!=='string'||item.name.length>300)throw Error('PDF 항목 이름을 확인해주세요.');
    const val=item.value;
    if(!(typeof val==='boolean'||typeof val==='string'&&val.length<=25000||Array.isArray(val)&&val.length<=40&&val.every(x=>typeof x==='string'&&x.length<=300)))throw Error('PDF 항목 내용을 확인해주세요.');
    return {name:item.name,value:val};
  });
  const overlays=value.overlays.map(item=>{
    if(!item||typeof item.id!=='string'||item.id.length>80||typeof item.text!=='string'||item.text.length>10000||!Number.isInteger(item.page)||item.page<0||item.page>=200||!['x','y','width','fontSize'].every(key=>Number.isFinite(item[key]))||item.x<0||item.y<0||item.x>20000||item.y>20000||item.width<1||item.width>20000||item.fontSize<7||item.fontSize>36)throw Error('PDF 텍스트 위치와 크기를 확인해주세요.');
    return {id:item.id,page:item.page,text:item.text,x:item.x,y:item.y,width:item.width,fontSize:item.fontSize};
  });
  const state={fields,overlays};if(JSON.stringify(state).length>300000)throw Error('PDF 작성 내용이 너무 큽니다.');return state;
}
function summary(item){return {id:String(item.fileId),name:item.name,size:item.size,format:item.format,kind:item.kind||'template',sourceId:item.sourceId?String(item.sourceId):null,company:item.company||'',createdAt:item.createdAt};}
module.exports=function mount(app,User,requireUser,storage){
  async function owned(req){const user=await User.findById(req.user._id).select('careerTemplates').lean();return user?.careerTemplates||[];}
  app.get('/api/career-templates',requireUser,async(req,res,next)=>{try{res.json({success:true,files:(await owned(req)).map(summary)});}catch(e){next(e);}});
  app.post('/api/career-templates',requireUser,storage.upload,async(req,res,next)=>{
    let ids=[];
    try{
      const file=req.files?.[0];if(!file||req.files.length!==1)return res.status(400).json({success:false,message:'PDF 파일 한 개를 선택해주세요.'});
      if(req.body.company!==undefined&&typeof req.body.company!=='string'||req.body.kind!==undefined&&!['template','filled'].includes(req.body.kind))return res.status(400).json({success:false,message:'파일 정보를 확인해주세요.'});
      const key=req.body.creationKey,kind=req.body.kind==='filled'?'filled':'template',company=(req.body.company||'').trim(),sourceId=req.body.sourceId||'';
      if(typeof key!=='string'||! /^[\w-]{16,80}$/.test(key)||company.length>100||(sourceId&&!validId(sourceId)))return res.status(400).json({success:false,message:'파일 정보를 확인해주세요.'});
      const existing=await owned(req),duplicate=existing.find(item=>item.creationKey===key);
      if(duplicate)return res.json({success:true,file:summary(duplicate)});
      if(existing.length>=MAX_FILES)return res.status(409).json({success:false,message:'양식·작성본은 최대 10개입니다. 필요 없는 파일을 먼저 삭제해주세요.'});
      if(sourceId&&!existing.some(item=>String(item.fileId)===sourceId))return res.status(404).json({success:false,message:'본인의 원본 양식을 찾을 수 없습니다.'});
      if(file.size>MAX_BYTES)return res.status(413).json({success:false,message:'PDF 파일은 최대 20MB입니다.'});
      const rawName=file.originalname;const decoded=[...rawName].every(c=>c.charCodeAt(0)<=255)?Buffer.from(rawName,'latin1').toString('utf8'):rawName;const normalized=decoded.includes('\ufffd')?rawName:decoded;
      const name=path.basename(normalized.replace(/\\/g,'/')).replace(/[\x00-\x1f\x7f]/g,'').slice(0,200);
      const handle=await fs.open(file.path,'r'),header=Buffer.alloc(8);try{await handle.read(header,0,8,0);}finally{await handle.close();}
      if(!/\.pdf$/i.test(name)||!header.subarray(0,5).equals(Buffer.from('%PDF-')))return res.status(400).json({success:false,message:'실제 PDF 파일만 불러올 수 있습니다.'});
      let state;try{state=draftState(req.body.editState);}catch(e){return res.status(400).json({success:false,message:e.message});}
      file.originalname=name;const saved=await storage.store(file,ids,req.user._id);
      const item={fileId:saved.fileId,name,size:file.size,format:'pdf',kind,sourceId:sourceId||null,creationKey:key,company,editState:state,createdAt:new Date()};
      const query={_id:req.user._id,'careerTemplates.9':{$exists:false},'careerTemplates.creationKey':{$ne:key}};if(sourceId)query['careerTemplates.fileId']=sourceId;
      const user=await User.findOneAndUpdate(query,{$push:{careerTemplates:item}},{new:true,runValidators:true}).select('careerTemplates').lean();
      if(!user){const duplicate=(await owned(req)).find(entry=>entry.creationKey===key);if(duplicate)return res.json({success:true,file:summary(duplicate)});return res.status(409).json({success:false,message:'파일 목록이 변경됐거나 최대 개수에 도달했습니다. 다시 확인해주세요.'});}
      ids=[];res.status(201).json({success:true,file:summary(item)});
    }catch(e){next(e);}finally{await storage.cleanupTemp(req.files||[]);if(ids.length)await storage.cleanupFiles(ids);}
  });
  app.get('/api/career-templates/:id/state',requireUser,async(req,res,next)=>{try{if(!validId(req.params.id))return res.status(400).json({success:false,message:'파일 주소를 확인해주세요.'});const item=(await owned(req)).find(item=>String(item.fileId)===req.params.id);if(!item)return res.status(404).json({success:false,message:'본인의 파일을 찾을 수 없습니다.'});res.json({success:true,file:summary(item),editState:item.editState||null});}catch(e){next(e);}});
  app.get('/api/career-templates/:id',requireUser,async(req,res,next)=>{try{if(!validId(req.params.id))return res.status(400).json({success:false,message:'파일 주소를 확인해주세요.'});if(!(await owned(req)).some(item=>String(item.fileId)===req.params.id))return res.status(404).json({success:false,message:'본인의 파일을 찾을 수 없습니다.'});await storage.stream(req,res,req.params.id,{contentType:'application/pdf'});}catch(e){next(e);}});
  app.delete('/api/career-templates/:id',requireUser,async(req,res,next)=>{try{
    if(!validId(req.params.id))return res.status(400).json({success:false,message:'파일 주소를 확인해주세요.'});
    const files=await owned(req);if(!files.some(item=>String(item.fileId)===req.params.id))return res.status(404).json({success:false,message:'본인의 파일을 찾을 수 없습니다.'});
    if(files.some(item=>String(item.sourceId||'')===req.params.id))return res.status(409).json({success:false,message:'작성본에 연결된 원본입니다. 작성본을 먼저 삭제해주세요.'});
    const user=await User.findOneAndUpdate({_id:req.user._id,'careerTemplates.fileId':req.params.id,'careerTemplates.sourceId':{$ne:req.params.id}},{$pull:{careerTemplates:{fileId:req.params.id}}},{new:true}).select('_id').lean();
    if(!user)return res.status(404).json({success:false,message:'파일이 이미 삭제됐습니다.'});
    await storage.cleanupFiles([req.params.id]);res.json({success:true});
  }catch(e){next(e);}});
};
module.exports.draftState=draftState;
