const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {pathToFileURL}=require('node:url');
const render=require('./browser-render.cjs');
const root=path.join(__dirname,'..');
const read=name=>fs.readFileSync(path.join(root,name),'utf8');
const chrome=process.env.AURALYRICS_CHROME || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';

for(const width of [1920,1366,780,390])test(`Studio preview, inspector and drafts at ${width}px`,{skip:!fs.existsSync(chrome)},async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auralyrics-studio-'));
  t.after(()=>{assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('auralyrics-studio-'));fs.rmSync(dir,{recursive:true,force:true,maxRetries:3,retryDelay:100});});
  const instrumented=read('studio.js').replace(/\}\)\(\);\s*$/,`window.__studio={state,openTrackInEditor,getCleanTrackPayload,seekTo,renderStep3Effects,saveCurrentTrackToDatabase,triggerStageBeatHit};})();`);
  let html=read('index.html').replace(/<link[^>]+>/g,'').replace(/<script[^>]+src=[^>]+><\/script>/g,'');
  html=html.replace('</head>',`<style>${read('studio.css')}\n${read('editor-layout.css')}</style></head>`);
  html=html.replace('</body>',`<pre id="result" hidden></pre><script>
  const errors=[],alerts=[];addEventListener('error',e=>errors.push(e.message));window.alert=message=>alerts.push(message);
  const track={title:'Canción de prueba',artist:'Artista',videoId:'test-video',duration:120,lines:[
    {time:0,text:'Una canción para probar',words:[{word:'Una',start:0,end:1},{word:'canción',start:1,end:2},{word:'para',start:2,end:3},{word:'probar',start:3,end:4}]},
    {time:20,text:'Otra parte',words:[{word:'Otra',start:20,end:21},{word:'parte',start:21,end:22}]}
  ],effects:{palette:'purple',bgMode:'radial-glow',keyframes:[{time:0,palette:'purple',bgMode:'radial-glow',color:'#9d4edd',layout:'center',variant:'lean',entry:'slide',shake:false}]}};
  const draft={title:track.title,artist:track.artist,videoId:track.videoId,hasBratEffects:true,raw:{found:true,track}};
  localStorage.setItem('auralyrics_cloud_tracks',JSON.stringify([draft]));
  let resolveSlow;
  window.fetch=async url=>{
    if(String(url).includes('slow.json'))return new Promise(resolve=>resolveSlow=()=>resolve({ok:true,json:async()=>({found:true,track:{...track,title:'Respuesta vieja',videoId:'slow'}})}));
    if(String(url).includes('catalog.json'))return {ok:true,json:async()=>({tracks:[{...draft,raw:undefined,title:'Canción de prueba'}]})};
    return {ok:false,json:async()=>({})};
  };
  ${read('brat-effects.js')}
  ${instrumented}
  const wait=ms=>new Promise(r=>setTimeout(r,ms)),checks=[],check=(name,pass)=>checks.push({name,pass:!!pass});
  addEventListener('DOMContentLoaded',()=>setTimeout(async()=>{try{
    const api=window.__studio;
    check('legacy colors do not delete drafts',JSON.parse(localStorage.getItem('auralyrics_cloud_tracks')).length===1&&api.state.libraryTracks[0].raw.track.effects.palette==='purple');
    await api.openTrackInEditor(draft,3);await wait(100);
    check('editor works without the YouTube API',api.state.currentView==='editor'&&errors.length===0);
    check('preview has one allowed scene',api.state.currentTrack.effects.keyframes.length===1&&api.state.currentTrack.effects.keyframes[0].palette==='lime');
    const stage=document.getElementById('step3-cinema-stage');
    check('preview is substantially taller',stage.getBoundingClientRect().height>=420);
    check('preview respects palette and entry',stage.dataset.bratPalette==='lime'&&stage.dataset.entry==='slide'&&!stage.hasAttribute('data-bg-mode')&&!stage.style.backgroundColor);
    api.seekTo(2.5);check('paused seek updates words and time immediately',api.state.currentTime===2.5&&document.getElementById('dock-time-current').textContent==='00:02.50'&&stage.querySelectorAll('.brat-word:not(.is-hidden)').length===3);
    const font=stage.querySelector('.cinema-brat-text').style.fontSize;
    document.querySelector('[data-entry="stamp"]').click();check('selected entry reaches the preview',stage.dataset.entry==='stamp'&&document.querySelector('.ve-entry-btn.active').dataset.entry==='stamp');
    document.querySelector('[data-palette="white"]').click();check('changing palette preserves disabled beats',!api.state.currentTrack.effects.keyframes[0].shake&&!document.getElementById('step3-chk-shake').checked);
    api.triggerStageBeatHit();check('disabled beats produce no flash',!stage.dataset.beat);
    document.querySelector('[data-layout="impact"]').click();check('unavailable font variants are explicitly disabled',[...document.querySelectorAll('.ve-var-btn')].every(button=>button.disabled)&&!document.getElementById('variant-hint').hidden);
    document.querySelector('[data-layout="center"]').click();document.querySelector('[data-variant="heavy"]').click();
    check('listed font variants work',stage.dataset.variant==='heavy'&&!document.querySelector('[data-variant="heavy"]').disabled);
    const input=document.getElementById('input-kf-time');input.value='00:10.00';input.dispatchEvent(new Event('change'));
    api.seekTo(30);document.getElementById('btn-add-keyframe-now').click();
    input.value='00:05.00';input.dispatchEvent(new Event('change'));
    check('moving a keyframe preserves its selection after sorting',api.state.currentTrack.effects.keyframes[api.state.selectedKeyframeIndex].time===5&&input.value==='00:05.00');
    input.value='99:99';input.dispatchEvent(new Event('change'));
    check('invalid keyframe time is rejected',input.getAttribute('aria-invalid')==='true'&&api.state.currentTrack.effects.keyframes[api.state.selectedKeyframeIndex].time===5);
    api.seekTo(-90);check('negative seeks clamp to zero',api.state.currentTime===0);api.seekTo(999);check('seeks clamp to duration',api.state.currentTime===120);
    document.getElementById('btn-export-track-modal').click();
    const payload=JSON.parse(document.getElementById('export-json-code-preview').textContent);
    check('header export opens the real modal',document.getElementById('modal-export').style.display==='flex');
    check('JSON export preserves complete keyframes',payload.track.effects.keyframes.length===2&&payload.track.effects.keyframes.every(frame=>frame.entry==='stamp'&&frame.shake===false));
    check('JSON export keeps lyrics and drops unlisted effects',payload.track.lines.length===2&&payload.track.lines[0].words[0].start===0&&!JSON.stringify(payload.track.effects).includes('purple')&&!JSON.stringify(payload.track.effects).includes('bgMode'));
    document.getElementById('btn-close-modal-export').click();check('export close button works',document.getElementById('modal-export').style.display==='none');
    await api.saveCurrentTrackToDatabase();
    const saved=JSON.parse(localStorage.getItem('auralyrics_cloud_tracks'));
    check('saving retains scenes in the browser',saved.length===1&&saved[0].raw.track.effects.keyframes.length===2);
    const published={...draft,raw:{found:true,track:{...track,title:track.title,effects:{keyframes:[{time:0,palette:'red'}]}}}};
    await api.openTrackInEditor(published,3);check('reopening prefers the local edited version',api.state.currentTrack.effects.keyframes.length===2);
    // Editing remains possible while media metadata is unavailable.
    const slow=api.openTrackInEditor({title:'Otra',artist:'Otro',videoId:'slow',fileName:'slow.json'},3);
    await Promise.resolve();await api.openTrackInEditor(draft,3);resolveSlow();await slow;
    check('late track load never replaces the current song',api.state.currentTrack.videoId==='test-video');
    api.seekTo(2.5);document.getElementById('btn-expand-preview').click();await wait(100);
    const expanded=stage.getBoundingClientRect();check('expanded stage fills the window',expanded.width>=innerWidth-70&&expanded.height>=innerHeight-140);
    check('expanded text refits instead of keeping its small font',parseInt(stage.querySelector('.cinema-brat-text').style.fontSize)>0);
    window.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape'}));await wait(50);
    check('Escape restores editor and scroll',!document.body.classList.contains('preview-expanded')&&document.getElementById('btn-expand-preview').getAttribute('aria-pressed')==='false');
    check('no horizontal page overflow',document.documentElement.scrollWidth<=innerWidth+1);
    // Present a large, allowed scene for the screenshot.
    api.state.currentTrack.effects.keyframes=[{time:0,palette:'lime',layout:'center',variant:'plain',entry:'rise',shake:true}];
    api.state.selectedKeyframeIndex=0;api.renderStep3Effects();api.seekTo(3.5);
    stage.scrollIntoView({block:'center'});await wait(100);
    check('no runtime errors '+errors.join(', '),errors.length===0);
  }catch(error){check(error.stack,false)}document.getElementById('result').textContent=JSON.stringify(checks)},50));
  </script></body>`);
  const file=path.join(dir,'fixture.html');fs.writeFileSync(file,html);
  const artifacts=path.join(__dirname,'artifacts');fs.mkdirSync(artifacts,{recursive:true});
  const checks=await render(chrome,dir,pathToFileURL(file).href,width,960,path.join(artifacts,'studio-'+width+'.png'),{hub:false});
  fs.writeFileSync(path.join(artifacts,'checks-'+width+'.json'),JSON.stringify(checks,null,2));
  for(const check of checks)assert.equal(check.pass,true,check.name);
});
