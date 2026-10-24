const test=require('node:test');
const assert=require('node:assert/strict');
const effects=require('../brat-effects.js');

test('new songs start with one neutral scene instead of an invented color sequence',()=>{
  const result=effects.normalize({});
  assert.equal(result.keyframes.length,1);
  assert.equal(result.keyframes[0].time,0);
  assert.equal(result.keyframes[0].palette,'lime');
});
test('legacy gradients and unlisted effects are removed without losing supported choices',()=>{
  const source={palette:'purple',blur:50,bgMode:'radial-glow',scale:2,keyframes:[
    {time:3,palette:'cyan',color:'#00f5d4',bgMode:'radial-glow',layout:'center',variant:'lean',entry:'slide',shake:false}
  ]};
  const normalized=effects.normalize(source);
  assert.deepEqual(normalized.keyframes[0],{time:3,palette:'lime',layout:'center',variant:'lean',entry:'slide',shake:false});
  assert.equal(source.keyframes[0].palette,'cyan','normalizing does not mutate a draft');
  assert.equal(normalized.blur,undefined);
});
test('invalid and duplicate timestamps never create NaN timeline markers',()=>{
  const normalized=effects.normalize({bassBeats:[3,'3',-1,null,'',Infinity,12],keyframes:[
    null,{time:-1},{time:NaN},{time:8,palette:'red'},{time:2,palette:'blue'},
    {time:8,palette:'white'}, {time:999,palette:'ink'}
  ]},10);
  assert.deepEqual(normalized.keyframes.map(item=>item.time),[2,8,10]);
  assert.equal(normalized.keyframes[1].palette,'white');
  assert.deepEqual(normalized.bassBeats,[3]);
});
test('Impact has its own font; other layouts retain every listed variant',()=>{
  assert.equal(effects.keyframes([{time:0,layout:'impact',variant:'lean'}])[0].variant,'plain');
  for(const variant of effects.variants)assert.equal(effects.keyframes([{time:0,layout:'center',variant}])[0].variant,variant);
});
test('scene lookup changes exactly at its timestamp and has a neutral gap before the first scene',()=>{
  const frames=effects.keyframes([{time:5,palette:'red'},{time:10,palette:'white'}]);
  assert.equal(effects.active(frames,0),null);
  assert.equal(effects.active(frames,9.99).palette,'red');
  assert.equal(effects.active(frames,10).palette,'white');
});

test('crossedBeat catches a beat between two coarse clock readings and never repeats it',()=>{
  const beats=[1,2.5,4];
  assert.equal(effects.crossedBeat(beats,.7,1.2),0,'beat inside the step');
  assert.equal(effects.crossedBeat(beats,.7,1.2,0),-1,'same beat is not repeated');
  assert.equal(effects.crossedBeat(beats,1.2,2.4),-1,'no beat in the step');
  assert.equal(effects.crossedBeat(beats,-1,4.05),2,'after a seek only a nearby beat counts');
  assert.equal(effects.crossedBeat(beats,-1,3),-1);
  assert.equal(effects.crossedBeat([],0,1),-1);
});
