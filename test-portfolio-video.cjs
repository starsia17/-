const assert=require('node:assert/strict');
const express=require('express');
const {chromium}=require('playwright');
const {configureSecurity}=require('./security');

(async()=>{
  const app=express();configureSecurity(app);
  app.get('/portfolio-fixture',(req,res)=>res.send('<!doctype html><meta name="referrer" content="no-referrer"><div id="output"></div><script src="/js/portfolio-presentation.js"></script>'));
  const data={success:true,type:'portfolio',title:'영상 검증',posts:[{title:'영상',bodyHtml:'<p>앞 설명</p><figure data-external-video="true" style="text-align:right"><a href="https://youtu.be/dQw4w9WgXcQ">YouTube</a></figure><p>중간 설명</p><a href="https://vimeo.com/123456789">Vimeo</a><p>뒤 설명</p>',media:[]}]};
  app.get('/api/shared/:token',(req,res)=>res.json(data));
  app.use(express.static('public'));
  const server=app.listen(0,'127.0.0.1');await new Promise(resolve=>server.once('listening',resolve));
  const origin='http://127.0.0.1:'+server.address().port;
  const browser=await chromium.launch({executablePath:'/usr/bin/chromium',headless:true,args:['--no-sandbox']});
  try{
    for(const width of [1440,390])for(const shared of [false,true]){
      const context=await browser.newContext({viewport:{width,height:900}}),page=await context.newPage(),requests=[];
      await context.route(/https:\/\/(www\.youtube-nocookie\.com|player\.vimeo\.com)\//,async route=>{
        requests.push({url:route.request().url(),headers:await route.request().allHeaders()});
        await route.fulfill({status:200,contentType:'text/html',body:'<!doctype html><button>검증용 영상 플레이어</button>'});
      });
      await page.goto(origin+(shared?'/share.html#'+'a'.repeat(43):'/portfolio-fixture?private=must-not-leak'));
      if(!shared)await page.evaluate(data=>document.querySelector('#output').append(window.portfolioPresentation.render(data)),data);
      await page.locator('iframe').first().waitFor();
      for(const frame of await page.locator('iframe').all()){
        await frame.scrollIntoViewIfNeeded();await frame.contentFrame().locator('button').waitFor();
      }
      assert.equal(requests.length,2);
      for(const request of requests)assert.equal(request.headers.referer,origin+'/',request.url+' must receive origin-only Referer');
      for(const frame of await page.locator('iframe').all())assert.match(await frame.getAttribute('allow'),/encrypted-media/);
      assert.match(await page.locator('body').textContent(),/앞 설명/);assert.match(await page.locator('body').textContent(),/중간 설명/);assert.match(await page.locator('body').textContent(),/뒤 설명/);
      assert.equal(await page.locator('[data-external-video]').evaluate(e=>e.style.textAlign),'right');
      await context.close();console.log('PASS portfolio video '+width+'px '+(shared?'public share':'private result')+': origin-only player identity, playback permissions and content/alignment retained');
    }
  }finally{await browser.close();server.closeAllConnections();server.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
