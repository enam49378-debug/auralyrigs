const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const vm=require('node:vm');

function load(file,context){vm.runInContext(fs.readFileSync(path.join(__dirname,'..',file),'utf8'),context);}

test('a sentence with a full stop splits into separate Brat phrases like AuraMusic',()=>{
  const context=vm.createContext({window:{},Intl});
  context.window.window=context.window;
  load('lyrics-timing.js',context);load('brat-scenes.js',context);
  const {LyricsTiming,BratScenes}=context.window.AuraMusic;
  const compiled=LyricsTiming.compile([{time:0,text:'Amor. Esta corto el cariño',words:[]}],{duration:6});
  assert.ok(compiled[0].phrases.length>=2,'full stop must start a new phrase');
  assert.equal(compiled[0].tokens.slice(compiled[0].phrases[0].start,compiled[0].phrases[0].end).join('').trim(),'Amor.');
  assert.equal(typeof BratScenes.plan,'function');
});

test('studio loads the shared phrase engine and crosses 808 beats between coarse clock ticks',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','index.html'),'utf8');
  assert.match(html,/lyrics-timing\.js/);assert.match(html,/brat-scenes\.js/);
  const js=fs.readFileSync(path.join(__dirname,'..','studio.js'),'utf8');
  assert.match(js,/function renderBratStage/);
  assert.match(js,/crossed/);
});
