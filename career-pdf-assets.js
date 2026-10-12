const express=require('express');
const path=require('node:path');
module.exports=function mount(app){
  const assets={
    '/vendor/pdf-lib.min.js':require.resolve('pdf-lib/dist/pdf-lib.min.js'),
    '/vendor/fontkit.umd.min.js':require.resolve('@pdf-lib/fontkit/dist/fontkit.umd.min.js'),
    '/vendor/pdf.min.mjs':require.resolve('pdfjs-dist/build/pdf.min.mjs'),
    '/vendor/pdf.worker.min.mjs':require.resolve('pdfjs-dist/build/pdf.worker.min.mjs'),
    '/vendor/resume-korean-license.txt':require.resolve('@expo-google-fonts/noto-sans-kr/LICENSE_FONT'),
    '/vendor/resume-korean.ttf':require.resolve('@expo-google-fonts/noto-sans-kr/400Regular/NotoSansKR_400Regular.ttf')
  };
  for(const[url,file]of Object.entries(assets))app.get(url,(req,res)=>{
    if(url.endsWith('pdf.worker.min.mjs'))res.set('Content-Security-Policy',"default-src 'none'; script-src 'self' 'wasm-unsafe-eval'; connect-src 'self'; worker-src 'self'");
    res.sendFile(file,{maxAge:'1h'});
  });
  const root=path.dirname(require.resolve('pdfjs-dist/package.json'));
  for(const[route,folder]of [['/vendor/pdf-fonts','standard_fonts'],['/vendor/pdf-cmaps','cmaps'],['/vendor/pdf-wasm','wasm']])app.use(route,express.static(path.join(root,folder),{maxAge:'1h',dotfiles:'deny'}));
};
