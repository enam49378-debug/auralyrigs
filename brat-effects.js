// Shared contract for the inspector, preview, saved drafts and JSON export.
// Unknown effects are discarded without touching lyrics or word timestamps.
(function (root) {
  'use strict';
  const palettes = Object.freeze({
    lime: {background:'#8acf00',foreground:'#000000'},
    white: {background:'#fafaf7',foreground:'#111111'},
    red: {background:'#ed1208',foreground:'#1500ce'},
    blue: {background:'#1500a8',foreground:'#f02b17'},
    yellow: {background:'#f4ef3b',foreground:'#111111'},
    ink: {background:'#181818',foreground:'#e9e9e4'}
  });
  const layouts = Object.freeze(['impact','center','spread','scribble']);
  const variants = Object.freeze(['plain','lean','heavy','wide']);
  const entries = Object.freeze(['rise','stamp','slide']);
  const pick = (list, value, fallback) => list.includes(value) ? value : fallback;
  const time = value => {
    if (value === null || value === '' || typeof value === 'boolean') return null;
    const number = Number(value);
    return Number.isFinite(number) && number >= 0 ? Math.round(number*100)/100 : null;
  };
  function keyframes(source, duration = Infinity, palette = 'lime') {
    const limit = Number.isFinite(Number(duration)) && Number(duration)>0 ? Number(duration) : Infinity;
    const result = new Map();
    for (const item of Array.isArray(source) ? source : []) {
      if (!item || typeof item !== 'object') continue;
      const seconds = time(item.time);
      if (seconds === null) continue;
      const layout = pick(layouts,item.layout,'center');
      const position = Math.min(seconds,limit);
      result.set(position, {time:position,
        palette:pick(Object.keys(palettes),item.palette,palette), layout,
        variant:layout==='impact' ? 'plain' : pick(variants,item.variant,'plain'),
        entry:pick(entries,item.entry,'rise'), shake:item.shake!==false});
    }
    // No automatic sequence of unrelated palettes or invented song sections.
    return result.size ? [...result.values()].sort((a,b)=>a.time-b.time) : [
      {time:0,palette,layout:'center',variant:'plain',entry:'rise',shake:true}
    ];
  }
  function normalize(source, duration = Infinity) {
    const input = source && typeof source==='object' ? source : {};
    const palette = pick(Object.keys(palettes),input.palette,'lime');
    const frames = keyframes(input.keyframes,duration,palette);
    const limit = Number.isFinite(Number(duration)) && Number(duration)>0 ? Number(duration) : Infinity;
    const bassBeats = [...new Set((Array.isArray(input.bassBeats)?input.bassBeats:[])
      .map(time).filter(value=>value!==null && value<=limit))].sort((a,b)=>a-b);
    const speed = Number(input.kineticSpeed);
    return {theme:'brat',palette,bassBeats,
      kineticSpeed:Number.isFinite(speed)&&speed>0 ? Math.min(3,Math.max(.25,speed)) : 1.15,
      keyframes:frames};
  }
  function active(frames, position) {
    let selected=null;
    for (const frame of frames || []) { if (frame.time>position) break; selected=frame; }
    return selected;
  }
  // Índice del golpe 808 que el reloj acaba de cruzar (o -1). Con avance normal cuenta cualquier golpe entre
  // la lectura anterior y la actual, así un reloj que avanza a saltos nunca se salta uno.
  function crossedBeat(beats, previous, position, lastIndex = -1) {
    const forward = previous >= 0 && position > previous && position - previous < .6;
    for (let i = 0; i < (beats || []).length; i++) {
      const hit = forward ? beats[i] > previous - .02 && beats[i] <= position + .02 : Math.abs(position - beats[i]) < .08;
      if (hit && i !== lastIndex) return i;
    }
    return -1;
  }
  const api=Object.freeze({palettes,layouts,variants,entries,keyframes,normalize,active,crossedBeat});
  if (typeof module==='object' && module.exports) module.exports=api;
  else root.AuraLyricsEffects=api;
})(typeof window==='undefined'?globalThis:window);
