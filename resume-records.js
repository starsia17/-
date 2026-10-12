const limits={company:120,department:120,position:100,employmentType:40,startMonth:7,endMonth:7};
function experiences(value,sanitize,plain){
 if(!Array.isArray(value)||value.length>30)throw Error('직장 경력은 최대 30개까지 작성할 수 있습니다.');
 const today=new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul'}).format(new Date()).slice(0,7);
 return value.map(row=>{if(!row||typeof row!=='object'||Array.isArray(row))throw Error('경력 항목을 확인해주세요.');const result={};for(const[key,max]of Object.entries(limits)){const text=row[key]??'';if(typeof text!=='string'||text.length>max)throw Error('경력 항목 길이를 확인해주세요.');result[key]=text.trim();}if(!result.company)throw Error('경력의 직장 이름을 입력해주세요.');if(typeof row.current!=='boolean')throw Error('재직 여부를 확인해주세요.');result.current=row.current;for(const key of ['startMonth','endMonth'])if(result[key]&&(!/^\d{4}-(0[1-9]|1[0-2])$/.test(result[key])||result[key]<'1900-01'||result[key]>today))throw Error('입사·퇴사 시기를 확인해주세요.');if(result.current)result.endMonth='';if(result.startMonth&&result.endMonth&&result.endMonth<result.startMonth)throw Error('퇴사 시기는 입사 시기보다 빠를 수 없습니다.');result.descriptionHtml=require('./career-content').rich(row.descriptionHtml||'',sanitize,plain);return result;});
}
module.exports={experiences};
