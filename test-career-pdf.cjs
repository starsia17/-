// Isolated fixture only: node test-career.cjs --serve
const assert=require('node:assert/strict');
const {PDFDocument}=require('pdf-lib');
const {chromium}=require('playwright');
const base='http://127.0.0.1:'+(process.env.CAREER_FIXTURE_PORT||4099);
(async()=>{
 const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
 try {
  const existing=(await(await fetch(base+'/api/career-templates')).json()).files;for(const item of [...existing.filter(x=>x.kind==='filled'),...existing.filter(x=>x.kind!=='filled')])assert.equal((await fetch(base+'/api/career-templates/'+item.id,{method:'DELETE'})).status,200);
  for(const width of [1440,390]){
   const context=await browser.newContext({viewport:{width,height:width===390?844:1000}}),page=await context.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.goto(base+'/#mypage/resume');await page.waitForFunction(()=>document.querySelector('.career-profile-form button[type=submit]')?.disabled===false);
   const doc=await PDFDocument.create(),sheet=doc.addPage([595,842]),form=doc.getForm();form.createTextField('name').addToPage(sheet,{x:80,y:680,width:300,height:35});form.createCheckBox('agree').addToPage(sheet,{x:80,y:610,width:25,height:25});const dropdown=form.createDropdown('job');dropdown.addOptions(['Design','Development']);dropdown.addToPage(sheet,{x:80,y:555,width:200,height:30});doc.addPage([595,842]);
   await page.getByLabel('회사 PDF 양식 파일').setInputFiles({name:'company-'+width+'.pdf',mimeType:'application/pdf',buffer:Buffer.from(await doc.save())});
   const dialog=page.locator('.career-pdf-dialog');await dialog.waitFor();await page.waitForFunction(()=>document.querySelector('.career-pdf-dialog .career-pdf-status').textContent.includes('입력 칸을 눌러'));
   await dialog.getByLabel('PDF 입력 칸 선택').selectOption('name');await dialog.getByLabel('PDF 입력 내용').fill('홍길동');
   await dialog.getByLabel('PDF 입력 칸 선택').selectOption('agree');await dialog.getByLabel('PDF 입력 내용').check();
   await dialog.getByLabel('PDF 입력 칸 선택').selectOption('job');await dialog.getByLabel('PDF 입력 내용').selectOption('Design');
   await dialog.getByRole('button',{name:'글자 추가',exact:true}).click();await dialog.locator('canvas').click({position:{x:120,y:410}});await dialog.getByLabel('PDF 입력 내용').fill('자기소개 한국어 검증');
   await dialog.getByLabel('PDF 화면 확대').selectOption('1.5');await dialog.getByLabel('PDF 화면 확대').selectOption('1');await dialog.getByRole('button',{name:'다음 페이지',exact:true}).click();await dialog.getByRole('button',{name:'이전 페이지',exact:true}).click();
   await dialog.getByRole('button',{name:'새 작성본 저장',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.career-pdf-status').textContent.includes('마이프로필에 저장했습니다'));
   const files=await page.evaluate(async()=> (await(await portfolioAuth.fetch('/api/career-templates')).json()).files),filled=files.filter(x=>x.kind==='filled').at(-1),source=files.find(x=>x.id===filled.sourceId);assert(source);assert.notEqual(filled.id,source.id);
   const state=await page.evaluate(async id=>(await(await portfolioAuth.fetch('/api/career-templates/'+id+'/state')).json()).editState,filled.id);assert.equal(state.fields.find(x=>x.name==='name').value,'홍길동');assert.equal(state.fields.find(x=>x.name==='agree').value,true);assert.equal(state.overlays[0].text,'자기소개 한국어 검증');
   const text=await page.evaluate(async id=>{const pdfjs=await import('/vendor/pdf.min.mjs'),r=await portfolioAuth.fetch('/api/career-templates/'+id),task=pdfjs.getDocument({data:new Uint8Array(await r.arrayBuffer()),isEvalSupported:false});const doc=await task.promise,p=await doc.getPage(1),text=(await p.getTextContent()).items.map(x=>x.str).join(' ');await task.destroy();return text;},filled.id);assert(text.includes('홍길동'),text);assert(text.includes('자기소개 한국어 검증'),text);
   assert.equal((await context.request.get(base+'/api/career-templates/'+filled.id,{headers:{'x-fixture-user':'bbbbbbbbbbbbbbbbbbbbbbbb'}})).status(),404);
   assert.equal((await context.request.delete(base+'/api/career-templates/'+source.id)).status(),409);
   await dialog.getByRole('button',{name:'닫기',exact:true}).click();const card=page.locator('.career-template-card').filter({has:page.getByText(filled.name,{exact:true})});await card.getByRole('button',{name:'PDF 열고 작성',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.career-pdf-status')?.textContent.includes('입력 칸을 눌러'));await dialog.getByLabel('PDF 입력 칸 선택').selectOption('name');assert.equal(await dialog.getByLabel('PDF 입력 내용').inputValue(),'홍길동');
   assert(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth+1),'page overflow');await page.screenshot({path:'/tmp/career-pdf-'+width+'.png'});
   const downloadPromise=page.waitForEvent('download');await dialog.getByRole('button',{name:'작성본 내려받기',exact:true}).click();const download=await downloadPromise;assert((await download.suggestedFilename()).endsWith('.pdf'));
   assert(filled.name.includes('작성본'),'Unicode filename damaged');
   await dialog.getByRole('button',{name:'닫기',exact:true}).click();
   const flat=await PDFDocument.create();flat.addPage([595,842]).drawText('Company template');const flatBytes=Buffer.from(await flat.save());
   await page.getByLabel('회사 PDF 양식 파일').setInputFiles({name:'flat-'+width+'.pdf',mimeType:'application/pdf',buffer:flatBytes});
   await page.waitForFunction(()=>document.querySelector('.career-pdf-status')?.textContent.includes('입력 칸이 없는 양식'));
   await dialog.getByRole('button',{name:'글자 추가',exact:true}).click();await dialog.locator('canvas').click({position:{x:100,y:220}});await dialog.getByLabel('PDF 입력 내용').fill('경력 활동 자유 입력');
   await dialog.getByRole('button',{name:'새 작성본 저장',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.career-pdf-status').textContent.includes('마이프로필에 저장했습니다'));
   const flatFiles=await page.evaluate(async()=>(await(await portfolioAuth.fetch('/api/career-templates')).json()).files),flatSaved=flatFiles.filter(x=>x.kind==='filled').at(-1);
   const originalBytes=Buffer.from(await(await context.request.get(base+'/api/career-templates/'+flatSaved.sourceId)).body());assert.deepEqual(originalBytes,flatBytes,'Original template changed');
   await page.evaluate(()=>portfolioAuth.expire());assert.equal(await page.locator('.career-pdf-dialog').count(),0);assert.equal(await page.locator('.career-template-card').count(),0);assert.deepEqual(errors,[]);await context.close();console.log('PASS PDF browser '+width+': fields, Korean text, overlays, paging, save/reopen, owner isolation, download, logout');
  }
  // A legacy body is split only in the editing draft, with original formatting retained.
  const context=await browser.newContext({viewport:{width:390,height:844}}),page=await context.newPage();
  const revision=(await(await fetch(base+'/api/career-profile')).json()).revision;
  await page.route('**/api/career-profile',route=>route.request().method()!=='GET'?route.continue():route.fulfill({json:{success:true,revision,profile:{name:'기존회원',role:'',email:'',phone:'',website:'',bodyHtml:'<h2>경력 · 활동</h2><p style="font-weight:700">이전 경력</p><h2>학력 · 교육</h2><p>교육 내용</p><h2>자기소개</h2><p>소개 보존</p>'}}}));
  await page.goto(base+'/#mypage/resume');await page.waitForFunction(()=>document.querySelector('.career-profile-form input[name=name]')?.value==='기존회원');
  assert((await page.getByRole('textbox',{name:'경력 · 활동',exact:true,includeHidden:true}).innerHTML()).includes('font-weight:700'));assert.equal(await page.getByRole('textbox',{name:'학력 · 교육',exact:true,includeHidden:true}).textContent(),'교육 내용');assert((await page.getByRole('textbox',{name:'이력서 본문',exact:true}).innerText()).includes('소개 보존'));assert(!(await page.getByRole('textbox',{name:'이력서 본문',exact:true}).innerText()).includes('이전 경력'));await page.getByRole('button',{name:'프로필 저장',exact:true}).click();await page.waitForFunction(()=>document.querySelector('.career-profile-status').textContent.includes('저장했습니다'));await page.unroute('**/api/career-profile');const migrated=await page.evaluate(async()=>(await(await portfolioAuth.fetch('/api/career-profile')).json()).profile);assert(migrated.experienceHtml.includes('이전 경력'));assert(migrated.educationHtml.includes('교육 내용'));await context.close();console.log('PASS legacy resume migration: upper sections, body separation and formatting preserved');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
