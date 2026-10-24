/* Visual composition only. Word timestamps remain owned by LyricsTiming. */
window.AuraMusic = window.AuraMusic || {};
(() => {
  'use strict';
  const attached = new Set(['me', 'te', 'se', 'la', 'el', 'los', 'las', 'de', 'del', 'a', 'al', 'con', 'que', 'mi', 'tu', 'su', 'y', 'the', 'of', 'to', 'and', 'my', 'your']);
  const clean = token => String(token || '').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  function hash(text) {
    let value = 2166136261;
    for (const character of String(text)) value = Math.imul(value ^ character.codePointAt(0), 16777619);
    return value >>> 0;
  }

  function split(phrase, seed) {
    const count = phrase.tokens.length;
    if (phrase.special || count < 6 || hash(`${seed}:split:${phrase.text}`) % 100 >= 65) return [phrase];
    const parts = [];
    let start = 0;
    while (start < count) {
      let end = count;
      if (count - start > 5) {
        const target = start + 3 + hash(`${seed}:${phrase.text}:${start}`) % 2;
        let best = -Infinity;
        for (let candidate = Math.max(start + 2, target - 1); candidate <= Math.min(count - 2, target + 1); candidate++) {
          const score = -Math.abs(candidate - target) - (attached.has(clean(phrase.tokens[candidate - 1])) ? 5 : 0);
          if (score > best) { best = score; end = candidate; }
        }
      }
      const tokens = phrase.tokens.slice(start, end);
      parts.push({ ...phrase, tokens, times: phrase.times.slice(start, end), ends: phrase.ends?.slice(start, end),
        text: tokens.join('').trim(), time: phrase.times[start],
        end: phrase.ends?.[end - 1] ?? (end < count ? phrase.times[end] : phrase.end),
        visualPart: parts.length });
      start = end;
    }
    return parts;
  }

  function plan(input, seed = '') {
    const phrases = input.flatMap(phrase => split(phrase, seed));
    const scenes = [];
    const roll = (phrase, label) => hash(`${seed}:${label}:${phrase.time}:${phrase.text}`);
    const focus = phrase => !phrase.special && (/[!¡]/u.test(phrase.text) ||
      (phrase.tokens.length <= 2 && phrase.text.length <= 15 && roll(phrase, 'focus') % 100 < 40));
    const upper = phrase => /\p{L}/u.test(phrase.text) && phrase.text === phrase.text.toLocaleUpperCase();
    for (let start = 0; start < phrases.length;) {
      const first = phrases[start];
      let end = start;
      const next = phrases[start + 1];
      // Small pauses inside a short line can accumulate together. Other pairings are varied,
      // independent of the verse index, and never cross a long instrumental break.
      const compactPause = next && first.lineIndex === next.lineIndex &&
        first.tokens.length <= 2 && next.tokens.length <= 2 && next.time - first.end <= 2.5;
      if (next && !first.special && !next.special && !upper(first) && !upper(next) &&
          first.tokens.length + next.tokens.length <= 12 && first.text.length + next.text.length <= 92 &&
          next.time - first.end <= 2.5 && next.time - first.time <= 10 &&
          (compactPause || (!focus(first) && !focus(next) && roll(first, 'pair') % 100 < 60))) end++;
      const count = phrases.slice(start, end + 1).reduce((sum, phrase) => sum + phrase.tokens.length, 0);
      const chars = phrases.slice(start, end + 1).reduce((sum, phrase) => sum + phrase.text.length, 0);
      const featured = end === start && !first.special && count <= 5 && chars <= 38;
      const layout = featured ? 'impact' : first.special ? 'center' :
        ['center', 'spread', 'center', 'scribble'][roll(first, 'layout') % 4];
      const variant = layout === 'impact' ? 'plain' : ['plain', 'lean', 'heavy', 'wide'][roll(first, 'variant') % 4];
      scenes.push({ start, end, layout, variant,
        palette: ['lime', 'white', 'red', 'blue', 'yellow', 'ink'][roll(first, 'palette') % 6],
        entry: ['rise', 'stamp', 'slide'][roll(first, 'entry') % 3] });
      start = end + 1;
    }
    return { phrases, scenes };
  }

  window.AuraMusic.BratScenes = { plan };
})();
