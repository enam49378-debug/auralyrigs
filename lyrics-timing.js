/* Shared lyric timing and phrase analysis. Pure functions: no DOM or audio clock. */
window.AuraMusic = window.AuraMusic || {};
(() => {
  'use strict';
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const number = value => value == null || value === '' ? NaN : Number(value);
  const normalized = value => String(value || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
  const median = values => {
    const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
    return sorted.length ? sorted[Math.floor(sorted.length / 2)] : 0;
  };
  const attached = new Set(['a', 'al', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'en', 'con', 'que', 'mi', 'tu', 'su', 'me', 'te', 'se', 'nos', 'y', 'o', 'the', 'a', 'an', 'of', 'to', 'and', 'or', 'my', 'your']);
  const clauseStart = /^(pero|aunque|porque|cuando|mientras|entonces|but|although|because|when|while|then)$/u;

  function tokenize(text) {
    const value = String(text || '').trim();
    if (!value) return [];
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(value)) return value.match(/\S+\s*/gu) || [];
    try {
      const result = [];
      let pending = '';
      for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(value)) {
        if (part.isWordLike) { result.push(pending + part.segment); pending = ''; }
        else if (/^[¿¡(“「『]$/u.test(part.segment) || !result.length) pending += part.segment;
        else result[result.length - 1] += part.segment;
      }
      if (pending) result.length ? result[result.length - 1] += pending : result.push(pending);
      return result;
    } catch (_) { return value.match(/\S+\s*/gu) || []; }
  }

  function weight(token) {
    const clean = normalized(token);
    if (!clean) return .6;
    if (/[^\p{Script=Latin}]/u.test(clean)) return Math.max(1, Array.from(clean).length);
    const vowels = clean.normalize('NFD').replace(/\p{M}/gu, '').match(/[aeiouy]+/g);
    let syllables = Math.max(1, vowels?.length || clean.length / 3);
    if (/[aeoáéó][íú]|[íú][aeoáéó]/iu.test(token)) syllables++;
    return Math.max(.5, syllables * (attached.has(clean) ? .65 : 1));
  }

  function profile(lines) {
    return lines.map((line, index) => {
      let span = number(lines[index + 1]?.time) - number(line.time);
      let occupied = .88;
      const precise = Array.isArray(line.words) ? line.words.filter(word => !word.estimated && Number.isFinite(number(word.time))) : [];
      if (precise.length > 1 || precise.length === 1 && Number.isFinite(number(precise[0].end))) {
        const first = number(precise[0].time), last = precise.at(-1);
        const intervals = precise.slice(1).map((word, i) => number(word.time) - number(precise[i].time)).filter(value => value > 0);
        const end = number(last.end);
        const vocalSpan = (end > number(last.time) ? end : number(last.time) + median(intervals)) - first;
        if (vocalSpan > .1) { span = vocalSpan; occupied = 1; }
      }
      const units = tokenize(line.originalText || line.text).reduce((sum, token) => sum + weight(token), 0);
      return !line.isIntro && !line.isInstrumental && !line.isOutro && units > 1 && span > .2 && span < 12
        ? clamp(span * occupied / units, .1, .7) : NaN;
    });
  }

  function estimate(text, start, boundary, pace = .35) {
    const tokens = tokenize(text);
    if (!tokens.length) return [];
    start = Number.isFinite(number(start)) ? Math.max(0, number(start)) : 0;
    const weights = tokens.map(weight);
    const units = weights.reduce((sum, value) => sum + value, 0);
    const available = Number.isFinite(number(boundary)) && boundary > start ? boundary - start : units * pace + .4;
    const duration = Math.min(available * .94, Math.max(.1, units * pace));
    const pauses = tokens.map((token, index) => index < tokens.length - 1 && /[,;:.!?…][”"'’)]*\s*$/u.test(token) ? .35 : 0);
    const total = units + pauses.reduce((sum, value) => sum + value, 0);
    let time = start;
    return tokens.map((token, index) => {
      const wordStart = time;
      const end = wordStart + duration * weights[index] / total;
      time = end + duration * pauses[index] / total;
      return { text: token.trimEnd(), time: wordStart, end, estimated: true };
    });
  }

  // Match available anchors to display tokens, including an untagged prefix and grouped words.
  // An unrelated/malformed word stream falls back as a whole instead of shifting later words.
  function anchored(text, line, boundary, pace = .35) {
    if (!Array.isArray(line.words) || !line.words.length) return null;
    const tokens = tokenize(text);
    if (line.words.length === 1 && tokens.length > 1 && !Number.isFinite(number(line.words[0].end))) return null;
    const anchors = new Array(tokens.length);
    let cursor = 0, previous = -Infinity;
    for (let wordIndex = 0; wordIndex < line.words.length; wordIndex++) {
      const word = line.words[wordIndex];
      const target = normalized(word.text);
      const rawStart = number(word.time);
      const start = Math.max(number(line.time), rawStart);
      if (!target) continue;
      if (!Number.isFinite(start) || rawStart < number(line.time) - .05 || start < previous || start >= boundary) return null;
      let first = cursor, last = cursor, found = false;
      for (; first < tokens.length; first++) {
        let joined = '';
        for (last = first; last < tokens.length && joined.length <= target.length; last++) {
          joined += normalized(tokens[last]);
          if (joined === target) { found = true; break; }
        }
        if (found) break;
      }
      if (!found) return null;
      const end = number(word.end);
      const next = number(line.words[wordIndex + 1]?.time);
      const groupEnd = Math.min(boundary, Number.isFinite(end) && end > start ? end :
        Number.isFinite(next) && next > start ? next : start + Math.max(.35, (last - first + 1) * .35));
      for (let i = first; i <= last; i++) {
        anchors[i] = { text: tokens[i].trimEnd(), time: start + (groupEnd - start) * (i - first) / (last - first + 1),
          ...(i === last && Number.isFinite(end) && end > start ? { end: Math.min(end, boundary) } : {}),
          estimated: !!word.estimated || last > first };
      }
      cursor = last + 1;
      previous = start;
    }
    if (!anchors.some(Boolean)) return null;
    // Fill untagged fragments without changing supplied anchors or stretching an instrumental tail.
    for (let i = 0; i < anchors.length;) {
      if (anchors[i]) { i++; continue; }
      const first = i;
      while (i < anchors.length && !anchors[i]) i++;
      const preceding = anchors[first - 1];
      const start = first === 0 ? number(line.time) : preceding.end ??
        preceding.time + Math.min(.35, Math.max(0, boundary - preceding.time) * .35);
      const end = i < anchors.length ? anchors[i].time : boundary;
      const generated = estimate(tokens.slice(first, i).join(''), start, end, pace);
      generated.forEach((word, j) => { anchors[first + j] = word; });
    }
    return anchors.map((word, index) => {
      const next = anchors[index + 1]?.time ?? boundary;
      const end = Number.isFinite(word.end) ? Math.min(word.end, next) : next;
      return { ...word, end: Math.max(word.time, end) };
    });
  }

  function splitPhrases(tokens, words) {
    const ranges = [];
    const rests = words.slice(0, -1).map((word, index) => Math.max(0, words[index + 1].time - word.end));
    const pauseThreshold = clamp(median(rests.filter(rest => rest > .03)) * .6, .3, .6);
    let start = 0;
    while (start < tokens.length) {
      let limit = Math.min(tokens.length, start + 7);
      while (limit > start + 1 && tokens.slice(start, limit).join('').length > 54) limit--;
      let best = limit, score = -Infinity;
      for (let end = start + 1; end <= limit; end++) {
        const token = tokens[end - 1].trimEnd();
        const next = normalized(tokens[end]);
        const sentence = /[.!?…][”"'’)]*$/u.test(token);
        const clause = /[,;:—–][”"'’)]*$/u.test(token);
        const rest = rests[end - 1] || 0;
        // Explicit punctuation or an actual silent interval wins, even on a short verse.
        if (end < tokens.length && (sentence || rest >= pauseThreshold)) { best = end; break; }
        if (end < tokens.length && clause && end - start >= 2) { best = end; break; }
        if (limit === tokens.length && end === limit) { best = end; break; }
        const candidate = (clause ? 5 : 0) + (rest >= pauseThreshold ? 5 : 0) + (clauseStart.test(next) ? 3 : 0)
          - (attached.has(normalized(token)) ? 5 : 0) - Math.abs(end - start - 5) * .4
          - (tokens.length - end === 1 ? 3 : 0) - (end - start === 1 ? 4 : 0);
        if (candidate > score) { best = end; score = candidate; }
      }
      ranges.push({ start, end: best, time: words[start].time, finish: words[best - 1].end });
      start = best;
    }
    return ranges;
  }

  function compile(lines, { translated = false, duration = 0 } = {}) {
    lines = Array.isArray(lines) ? lines.map(line => line || {}) : [];
    const paceByLine = profile(lines);
    const globalPace = median(paceByLine) || .35;
    return lines.map((line, index) => {
      const text = String(translated && line.translatedText ? line.translatedText : line.originalText || line.text || '').trim();
      const tokens = tokenize(text);
      const start = Number.isFinite(number(line.time)) ? Math.max(0, number(line.time)) : 0;
      let next = number(lines[index + 1]?.time);
      if (!(next > start)) next = duration > start ? duration : start + Math.max(2, tokens.length * .6);
      const local = median(paceByLine.slice(Math.max(0, index - 3), index + 4)) || globalPace;
      const special = !!(line.isIntro || line.isOutro || line.isInstrumental);
      let words = !special && (!translated || !line.translatedText) ? anchored(text, line, next, local) : null;
      if (!words) {
        let vocalStart = start, vocalEnd = next;
        if (translated && line.translatedText) {
          const original = anchored(line.originalText || line.text, line, next, local);
          if (original?.length) { vocalStart = original[0].time; vocalEnd = original.at(-1).end; }
        }
        words = special ? [{ text, time: start, end: next, estimated: true }] : estimate(text, vocalStart, vocalEnd, local);
      }
      const outputTokens = special ? [text] : tokens;
      const source = special ? 'section' : words.every(word => !word.estimated) ? 'word' : translated && line.translatedText ? 'translation' : 'estimated';
      return { text, tokens: outputTokens, words, start, end: next, source,
        phrases: words.length ? special ? [{ start: 0, end: words.length, time: start, finish: next }] : splitPhrases(outputTokens, words) : [] };
    });
  }

  function upperBound(items, time, read = value => value) {
    let low = 0, high = items.length;
    while (low < high) {
      const middle = (low + high) >>> 1;
      if (read(items[middle]) <= time) low = middle + 1;
      else high = middle;
    }
    return low;
  }

  window.AuraMusic.LyricsTiming = { tokenize, estimate, compile, splitPhrases, upperBound };
})();
