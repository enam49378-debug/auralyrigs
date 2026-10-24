const test=require('node:test');
const assert=require('node:assert/strict');
const path=require('node:path');
const {spawnSync}=require('node:child_process');

const script=`
import sys,json
sys.path.insert(0,${JSON.stringify(path.join(__dirname,'..','tools'))})
from align_voice import align,norm
lyrics=[{'key':norm(w),'t':t} for w,t in [('Hola',1.0),('mundo,',1.6),('canto',2.2),('hola',10.0),('mundo',10.6)]]
heard=[{'key':norm(w),'start':s} for w,s in [('hola',1.1),('mundos',1.7),('canto',2.3),('hola',10.2),('mundo',10.7)]]
print(json.dumps(align(lyrics,heard,2.0)))
`;

test('the aligner pairs fuzzy words and keeps repeated lines apart by time',t=>{
  const run=spawnSync('python',['-c',script],{encoding:'utf8'});
  if(run.error||run.status!==0&&/No module|not found|not recognized/i.test(run.stderr||''))return t.skip('python not available');
  assert.equal(run.status,0,run.stderr);
  assert.deepEqual(JSON.parse(run.stdout),{0:0,1:1,2:2,3:3,4:4});
});
