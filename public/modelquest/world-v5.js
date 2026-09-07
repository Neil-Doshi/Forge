/* ModelQuest World v5 payload loader. */
(async()=>{
  try{
    if(!('DecompressionStream' in window)) throw new Error('Modern browser required for ModelQuest World.');
    const b64=(window.__mqv5||[]).join('');
    const bytes=Uint8Array.from(atob(b64),c=>c.charCodeAt(0));
    const stream=new Blob([bytes]).stream().pipeThrough(new DecompressionStream('gzip'));
    const code=await new Response(stream).text();
    window.__mqv5=[];
    new Function(code)();
  }catch(e){
    console.error('ModelQuest World failed to load',e);
  }
})();
