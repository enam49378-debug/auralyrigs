const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const os=require('node:os');
const path=require('node:path');
const {createServer}=require('../server.js');

test('local server saves supported scenes and serves only public assets',async t=>{
  const dir=fs.mkdtempSync(path.join(os.tmpdir(),'auralyrics-api-'));
  const server=createServer({databaseDir:dir});
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  t.after(async()=>{await new Promise(resolve=>server.close(resolve));assert.equal(path.dirname(path.resolve(dir)),path.resolve(os.tmpdir()));assert.ok(path.basename(dir).startsWith('auralyrics-api-'));fs.rmSync(dir,{recursive:true,force:true});});
  const base='http://127.0.0.1:'+server.address().port;
  const payload={track:{title:'Mi canción',artist:'Autor',humanReviewed:true,videoId:'test',duration:20,expressions:[{t:1,face:':3'},{t:5,face:'cara invalida'}],lines:[{time:0,text:'Prueba'}],effects:{bgMode:'radial-glow',keyframes:[{time:0,palette:'blue',entry:'slide',layout:'center',shake:false}]}}};
  const saved=await fetch(base+'/api/lyrics/save',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(payload)});
  assert.equal(saved.status,200);
  const file=(await saved.json()).fileName;
  const stored=JSON.parse(fs.readFileSync(path.join(dir,'private',file),'utf8'));
  const published=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8'));
  assert.equal(published.track.lines.length,0,'public file never carries lyric text');
  assert.deepEqual(published.track.expressions,[{t:1,face:':3'}],'expressions are saved apart from the lyrics and sanitised');
  assert.ok(!JSON.stringify(published).includes('Prueba'));
  assert.equal(stored.track.humanReviewed,true);
  assert.equal(stored.track.effects.keyframes[0].shake,false);
  assert.equal(stored.track.effects.bgMode,undefined);
  assert.equal(stored.track.lines[0].text,'Prueba');
  assert.equal((await (await fetch(base+'/api/lyrics/get?videoId=test')).json()).track.title,'Mi canción');
  assert.equal((await (await fetch(base+'/api/lyrics/get?title=%E2%9D%A4%EF%B8%8F')).json()).found,false);
  assert.equal((await fetch(base+'/brat-effects.js')).status,200);
  assert.equal((await fetch(base+'/editor-layout.css')).status,200);
  for(const resource of ['/.git/config','/server.js','/does-not-exist.js','/%E0%A4%A'])assert.ok([400,404].includes((await fetch(base+resource)).status),resource);
  assert.equal((await fetch(base+'/api/lyrics/save',{method:'POST',body:'{'})).status,400);
  assert.equal((await fetch(base+'/api/lyrics/save',{method:'POST',headers:{Origin:'https://unrelated.example'},body:JSON.stringify(payload)})).status,403);
  assert.equal((await fetch(base+'/studio.css',{method:'POST'})).status,405);
});

test('npm start entry actually starts a loopback server',async t=>{
  const {spawn}=require('node:child_process');
  const child=spawn(process.execPath,['server.js'],{cwd:path.join(__dirname,'..'),env:{...process.env,PORT:'0'},windowsHide:true,stdio:['ignore','pipe','pipe']});
  t.after(()=>child.kill());
  const address=await new Promise((resolve,reject)=>{
    const timer=setTimeout(()=>reject(new Error('Server did not start')),5000);let output='';
    child.stdout.on('data',chunk=>{output+=chunk;const match=output.match(/Web Editor:\s+(http:\/\/127\.0\.0\.1:\d+)/);if(match){clearTimeout(timer);resolve(match[1]);}});
    child.on('error',error=>{clearTimeout(timer);reject(error);});
    child.on('exit',code=>{clearTimeout(timer);reject(new Error('Early exit '+code));});
  });
  const response=await fetch(address+'/api/status');
  assert.equal(response.status,200);assert.equal((await response.json()).name,'AuraLyrics Studio');
});

test('track matching prefers exact title and artist over loose partial matches', () => {
  const {findTrack} = require('../server.js');
  const tracks = [
    {title: 'Love Story', artist: 'Taylor Swift', videoId: 'a'},
    {title: 'Love', artist: 'Kendrick Lamar', videoId: 'b'}
  ];
  assert.equal(findTrack(tracks, {title: 'Love', artist: 'Kendrick Lamar'}).videoId, 'b');
  assert.equal(findTrack(tracks, {title: 'Love Story', artist: ''}).videoId, 'a');
  assert.equal(findTrack(tracks, {title: 'xyz', artist: ''}), null);
  assert.equal(findTrack(tracks, {title: '', artist: '', videoId: 'a'}).title, 'Love Story');
  assert.equal(findTrack(tracks, {title: 'Love', artist: 'Someone Else'}), null);
});
