const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');

test('database/ is public: no track may carry lyric text, only timings',()=>{
  const dir=path.join(__dirname,'..','database');
  const offenders=[];
  for(const file of fs.readdirSync(dir).filter(name=>name.endsWith('.json')&&name!=='catalog.json')){
    const track=JSON.parse(fs.readFileSync(path.join(dir,file),'utf8')).track||{};
    // Fichas antiguas de ejemplo conservan texto; las nuevas deben ir solo con tiempos.
    if(track.timing&&Array.isArray(track.lines)&&track.lines.some(line=>String(line.text||'').trim()))offenders.push(file);
  }
  assert.deepEqual(offenders,[],'timing-only tracks must have no line text');
});

test('private/ is ignored by git so full lyrics are never committed',()=>{
  const ignore=fs.readFileSync(path.join(__dirname,'..','.gitignore'),'utf8');
  assert.match(ignore,/^private\/$/m);
});
