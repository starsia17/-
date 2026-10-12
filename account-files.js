const {Types}=require('mongoose');
module.exports=async function removeAccountFiles(db,bucket,ids,owner){
 const values=ids.map(id=>new Types.ObjectId(String(id))),files=db.collection(bucket+'.files');
 const foreign=await files.find({_id:{$in:values},'metadata.ownerId':{$exists:true,$ne:String(owner)}}).project({_id:1}).toArray();
 const protectedIds=new Set(foreign.map(file=>String(file._id))),allowed=values.filter(id=>!protectedIds.has(String(id)));
 if(!allowed.length)return;
 // Retry-safe: remove chunks before file metadata; a missing file may still have orphaned chunks.
 await db.collection(bucket+'.chunks').deleteMany({files_id:{$in:allowed}});
 await files.deleteMany({_id:{$in:allowed}});
};
