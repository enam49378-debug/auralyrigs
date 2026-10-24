#!/usr/bin/env python3
"""AuraLyrics: alinea la letra de una ficha con el audio usando Whisper (faster-whisper), todo local.

Whisper escucha la voz y entrega cuándo se pronuncia cada palabra. Esas palabras se comparan con la
letra conocida (aunque Whisper se equivoque en algunas) y los tiempos se copian a la letra. Las
palabras que Whisper no reconoce se reparten entre sus vecinas ya alineadas.

  python tools/align_voice.py cancion.mp3 database/artista_cancion.json            (vista previa)
  python tools/align_voice.py cancion.mp3 database/artista_cancion.json --write    (guarda)

Opciones: --model medium|small|large-v3  --language es  --window 2.0  --min-match 0.55  --force
No guarda nada si coincide muy poca letra (el audio es demasiado denso o la letra no corresponde).
"""
import argparse
import difflib
import json
import re
import statistics
import sys
import unicodedata


def norm(text):
    text = unicodedata.normalize('NFKD', str(text).lower())
    text = ''.join(ch for ch in text if not unicodedata.combining(ch))
    return re.sub(r'[^a-z0-9ñ]', '', text)


def similar(a, b):
    if not a or not b:
        return 0.0
    if a == b:
        return 1.0
    return difflib.SequenceMatcher(None, a, b).ratio()


def transcribe(audio, model_name, language):
    from faster_whisper import WhisperModel

    attempts = [('cuda', 'float16'), ('cpu', 'int8')]
    last_error = None
    for device, compute in attempts:
        try:
            print(f'   Cargando modelo {model_name} en {device}…', flush=True)
            model = WhisperModel(model_name, device=device, compute_type=compute)
            segments, info = model.transcribe(
                audio, language=language, word_timestamps=True, beam_size=5,
                condition_on_previous_text=False, vad_filter=False,
            )
            words = []
            for segment in segments:
                for word in segment.words or []:
                    words.append({'text': word.word, 'start': word.start, 'end': word.end, 'p': word.probability})
            print(f'   Whisper reconoció {len(words)} palabras ({device}).', flush=True)
            return words
        except Exception as error:  # cuDNN/CUDA ausentes u otro fallo: se reintenta en CPU
            last_error = error
            print(f'   {device} no disponible ({str(error)[:90]}), probando alternativa…', flush=True)
    raise SystemExit(f'No se pudo transcribir: {last_error}')


def align(lyrics, heard, window, floor=.72):
    """Alineación por programación dinámica. `lyrics` = [{key, t}] con t = tiempo estimado de la palabra.
    Solo se permiten parejas cuya diferencia de tiempo sea < window: así el estribillo repetido no se confunde."""
    n, m = len(lyrics), len(heard)
    gap = -.35
    score = [[0.0] * (m + 1) for _ in range(n + 1)]
    back = [[0] * (m + 1) for _ in range(n + 1)]
    for i in range(1, n + 1):
        score[i][0] = i * gap; back[i][0] = 1
    for j in range(1, m + 1):
        score[0][j] = j * gap; back[0][j] = 2
    for i in range(1, n + 1):
        for j in range(1, m + 1):
            best, move = score[i - 1][j] + gap, 1
            if score[i][j - 1] + gap > best:
                best, move = score[i][j - 1] + gap, 2
            if abs(heard[j - 1]['start'] - lyrics[i - 1]['t']) < window:
                sim = similar(lyrics[i - 1]['key'], heard[j - 1]['key'])
                if sim >= floor:
                    pair = score[i - 1][j - 1] + sim * 2 - .2
                    if pair > best:
                        best, move = pair, 3
            score[i][j], back[i][j] = best, move
    pairs, i, j = {}, n, m
    while i > 0 or j > 0:
        move = back[i][j]
        if i > 0 and j > 0 and move == 3:
            pairs[i - 1] = j - 1; i -= 1; j -= 1
        elif i > 0 and (move == 1 or j == 0):
            i -= 1
        else:
            j -= 1
    return pairs


def main():
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument('audio')
    parser.add_argument('json')
    parser.add_argument('--model', default='medium')
    parser.add_argument('--language', default='es')
    parser.add_argument('--window', type=float, default=2.0)
    parser.add_argument('--min-match', type=float, default=.55)
    parser.add_argument('--write', action='store_true')
    parser.add_argument('--force', action='store_true')
    args = parser.parse_args()
    sys.stdout.reconfigure(encoding='utf-8')

    with open(args.json, encoding='utf-8') as handle:
        data = json.load(handle)
    track = data.get('track', data)
    lines = track.get('lines') or []
    if not lines or not any(line.get('words') for line in lines):
        raise SystemExit('La ficha no tiene letra con palabras. Impórtala en el Studio y guárdala primero.')

    flat = []  # (line index, word index)
    lyrics = []
    for li, line in enumerate(lines):
        for wi, word in enumerate(line.get('words', [])):
            flat.append((li, wi))
            lyrics.append({'key': norm(word.get('word', word.get('text', ''))), 't': float(word.get('start', word.get('time', line['time'])))})

    print('🎙️  Alineando con Whisper…')
    heard = transcribe(args.audio, args.model, args.language)
    for item in heard:
        item['key'] = norm(item['text'])
    heard = [item for item in heard if item['key']]

    pairs = align(lyrics, heard, args.window)
    matched = len(pairs)
    ratio = matched / max(1, len(lyrics))
    shifts = [abs(heard[j]['start'] - lyrics[i]['t']) for i, j in pairs.items()]
    print(f'   Palabras de la letra reconocidas: {matched} de {len(lyrics)} ({ratio:.0%})')
    if shifts:
        print(f'   Diferencia mediana contra los tiempos actuales: {statistics.median(shifts):.2f} s (máx {max(shifts):.2f} s)')

    if ratio < args.min_match and not args.force:
        print(f'   ⚠️  Solo se reconoció el {ratio:.0%} (mínimo {args.min_match:.0%}). No se cambia nada: el audio es demasiado denso o la letra no coincide.')
        print('       Usa --force para aplicar igual lo reconocido (no recomendado).')
        return

    # Aplicar: tiempos de Whisper en las palabras reconocidas; las demás se reparten entre vecinas.
    by_line = {}
    for flat_index, (li, wi) in enumerate(flat):
        by_line.setdefault(li, []).append((wi, flat_index))
    for li, items in by_line.items():
        words = lines[li]['words']
        limit = float(lines[li + 1]['time']) if li + 1 < len(lines) else float(lines[li]['time']) + 4
        starts = [None] * len(words)
        ends = [None] * len(words)
        for wi, flat_index in items:
            if flat_index in pairs:
                hit = heard[pairs[flat_index]]
                starts[wi], ends[wi] = hit['start'], hit['end']
        anchors = [k for k, value in enumerate(starts) if value is not None]
        for k in range(len(words)):
            if starts[k] is not None:
                continue
            left = max((a for a in anchors if a < k), default=None)
            right = min((a for a in anchors if a > k), default=None)
            lo = ends[left] if left is not None else float(words[0].get('start', lines[li]['time']))
            hi = starts[right] if right is not None else max(limit, lo + .3)
            hole = [q for q in range(len(words)) if starts[q] is None and (left is None or q > left) and (right is None or q < right)]
            step = (hi - lo) / (len(hole) + (0 if right is not None else 1)) if hole else 0
            starts[k] = lo + step * hole.index(k)
            ends[k] = starts[k] + max(.08, step * .9)
        previous = -1
        for k, word in enumerate(words):
            start = max(starts[k], previous + .02)
            end = max(start + .08, ends[k])
            if k + 1 < len(words):
                end = min(end, max(start + .08, starts[k + 1] - .02))
            key = 'start' if 'start' in word else 'time'
            word[key] = round(start, 2)
            word['end'] = round(end, 2)
            word['estimated'] = not any(flat_index in pairs for wi, flat_index in items if wi == k)
            previous = start

    if args.write:
        with open(args.json, 'w', encoding='utf-8') as handle:
            json.dump(data, handle, ensure_ascii=False, indent=2)
        print(f'✅ Guardado en {args.json}')
    else:
        print('ℹ️  Vista previa: agrega --write para guardar los cambios.')


if __name__ == '__main__':
    main()
