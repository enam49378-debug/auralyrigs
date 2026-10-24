const test=require('node:test');
const assert=require('node:assert/strict');
const {detectOnsets,detectBassBeats,snapWords}=require('../tools/analyze-audio.cjs');

const RATE=22050;
function synth(seconds,bursts){
  const samples=new Float32Array(seconds*RATE);
  for(const {time,freq,length=.12} of bursts){
    const start=Math.round(time*RATE);
    for(let i=0;i<length*RATE&&start+i<samples.length;i++){
      const t=i/RATE;samples[start+i]+=Math.sin(2*Math.PI*freq*t)*Math.exp(-t*18)*.8;
    }
  }
  return samples;
}

test('bass hits are located within 30 ms and weak noise is ignored',()=>{
  const times=[1,2.1,3.4,4.6];
  const beats=detectBassBeats(synth(6,times.map(time=>({time,freq:60}))));
  assert.equal(beats.length,times.length);
  beats.forEach((beat,i)=>assert.ok(Math.abs(beat-times[i])<.03,`beat ${i}: ${beat}`));
});

test('estimated words snap to the real attack and stay in order',()=>{
  const onsets=detectOnsets(synth(5,[{time:1.0,freq:900},{time:1.6,freq:1100},{time:2.4,freq:900}]));
  const lines=[{time:1.05,words:[{word:'a',start:1.07,end:1.4},{word:'b',start:1.55,end:1.9},{word:'c',start:2.47,end:2.9}]}];
  const stats=snapWords(lines,onsets,{window:.15});
  assert.equal(stats.moved,3);
  const starts=lines[0].words.map(word=>word.start);
  starts.forEach((start,i)=>assert.ok(Math.abs(start-[1,1.6,2.4][i])<.03,String(start)));
  assert.ok(starts[0]<starts[1]&&starts[1]<starts[2]);
  assert.ok(lines[0].words.every((word,i,list)=>word.end>word.start&&(i===list.length-1||word.end<=list[i+1].start)));
});

test('words far from any attack are left where they were',()=>{
  const onsets=detectOnsets(synth(5,[{time:4,freq:900}]));
  const lines=[{time:1,words:[{word:'a',start:1,end:1.4}]}];
  assert.equal(snapWords(lines,onsets,{window:.12}).moved,0);
  assert.equal(lines[0].words[0].start,1);
});
