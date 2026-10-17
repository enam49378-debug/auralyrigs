// AuraLyrics Studio 2.0 — Engine & Application Logic
// Compatible con AuraMusic, YouTube Music Cinema Lyrics & LRCLIB

(() => {
  'use strict';

  // State Management
  const state = {
    currentView: 'library', // 'library' | 'editor'
    activeStep: 1, // 1: Versos, 2: Frases, 3: Efectos
    libraryTracks: [],
    currentTrack: null,
    selectedVerseIndex: 0,
    ytPlayer: null,
    isYtReady: false,
    isPlaying: false,
    currentTime: 0,
    duration: 133,
    playbackRate: 1.0,
    syncLoopId: null,
    lastActiveVerseIdx: -1,
    lastActiveWordIdx: -1,
    activeBeatIndex: -1,
    tapTempoTimes: [],
    selectedKeyframeIndex: 0,
    syllablePace: 0.35,
    pendingAutoLyrics: null,
    debounceDetectTimer: null
  };

  // Sample default tracks if server database is empty
  const DEFAULT_DEMO_TRACKS = [
    {
      fileName: 'milo_j_te_fui_a_seguir.json',
      title: 'TE FUI A SEGUIR',
      artist: 'Milo J',
      videoId: 'R1Zuqo7XjAs',
      duration: 153,
      linesCount: 28,
      hasBratEffects: true,
      humanReviewed: true
    },
    {
      fileName: 'charli_xcx_360.json',
      title: '360',
      artist: 'Charli xcx',
      videoId: 'WJW-VvmRKsE',
      duration: 133,
      linesCount: 8,
      hasBratEffects: true,
      humanReviewed: true
    },
    {
      fileName: 'milo_j_m_a_i.json',
      title: 'M.A.I',
      artist: 'Milo J',
      videoId: '8Z_Vz9lLDK0',
      duration: 184,
      linesCount: 4,
      hasBratEffects: false,
      humanReviewed: false
    }
  ];

  /* =========================================================================
     1. INITIALIZATION & ROUTING
     ========================================================================= */

  document.addEventListener('DOMContentLoaded', () => {
    initEventListeners();
    loadLibraryTracks();
  });

  // YouTube IFrame API Callback
  window.onYouTubeIframeAPIReady = () => {
    console.log('🎬 AuraLyrics: YouTube IFrame API Listo');
    createYouTubePlayer('WJW-VvmRKsE');
  };

  function createYouTubePlayer(videoId) {
    if (state.ytPlayer && typeof state.ytPlayer.destroy === 'function') {
      try { state.ytPlayer.destroy(); } catch (_) {}
    }

    const cleanVideoId = videoId || 'WJW-VvmRKsE';

    // Actualizar botón para abrir SIEMPRE en YouTube Music (nunca en YouTube estándar)
    const ytmBtn = document.getElementById('btn-open-ytmusic-live');
    if (ytmBtn) {
      ytmBtn.href = `https://music.youtube.com/watch?v=${cleanVideoId}`;
    }

    state.ytPlayer = new YT.Player('yt-player', {
      height: '100%',
      width: '100%',
      videoId: cleanVideoId,
      playerVars: {
        autoplay: 0,
        controls: 0, // Desactiva la barra nativa para que nunca abra YouTube video estándar al hacer clic
        rel: 0,
        modestbranding: 1,
        playsinline: 1,
        disablekb: 1,
        fs: 0
      },
      events: {
        onReady: onPlayerReady,
        onStateChange: onPlayerStateChange
      }
    });
  }

  function onPlayerReady(event) {
    state.isYtReady = true;
    try {
      const dur = state.ytPlayer.getDuration();
      if (dur && dur > 0) {
        state.duration = dur;
        updateTotalTimeDisplay(dur);
      }
    } catch (_) {}
    console.log('🎬 AuraLyrics: Reproductor YouTube acoplado con éxito');
  }

  function onPlayerStateChange(event) {
    if (event.data === YT.PlayerState.PLAYING) {
      state.isPlaying = true;
      updatePlayPauseIcons(true);
      startSyncLoop();
    } else {
      state.isPlaying = false;
      updatePlayPauseIcons(false);
      stopSyncLoop();
    }
  }

  /* =========================================================================
     2. LIBRARY (CARDS MENU) VIEW LOGIC
     ========================================================================= */

  function isCloudMode() {
    return window.location.hostname.includes('github.io') || window.location.protocol === 'file:' || window.location.port !== '3000';
  }

  function updateServerStatusBadge() {
    const statusPill = document.getElementById('server-status-pill');
    const statusText = document.getElementById('server-status-text');
    if (!statusText) return;

    if (isCloudMode()) {
      statusText.textContent = 'AuraLyrics Cloud (GitHub Pages)';
      if (statusPill) statusPill.style.borderColor = 'rgba(138, 206, 0, 0.4)';
    } else {
      statusText.textContent = 'Servidor Local: Conectado (3000)';
    }
  }

  async function loadLibraryTracks() {
    updateServerStatusBadge();
    let loadedTracks = [];

    // 1. Intentar servidor local (si está corriendo en localhost:3000)
    try {
      const res = await fetch('/api/lyrics/list');
      if (res.ok) {
        const data = await res.json();
        if (data && Array.isArray(data.tracks) && data.tracks.length > 0) {
          loadedTracks = data.tracks;
        }
      }
    } catch (_) {}

    // 2. Si es GitHub Pages o falló el servidor local, cargar desde catalog.json estático
    if (loadedTracks.length === 0) {
      try {
        const catRes = await fetch('./database/catalog.json');
        if (catRes.ok) {
          const catData = await catRes.json();
          if (catData && Array.isArray(catData.tracks)) {
            loadedTracks = catData.tracks;
          }
        }
      } catch (_) {}
    }

    // 3. Mezclar con canciones guardadas en localStorage del navegador
    try {
      const localSaved = JSON.parse(localStorage.getItem('auralyrics_cloud_tracks') || '[]');
      if (Array.isArray(localSaved) && localSaved.length > 0) {
        localSaved.forEach(s => {
          if (!loadedTracks.some(t => t.title === s.title && t.artist === s.artist)) {
            loadedTracks.unshift(s);
          }
        });
      }
    } catch (_) {}

    // 4. Si aún estuviera vacío, usar las demos iniciales
    if (loadedTracks.length === 0) {
      loadedTracks = [...DEFAULT_DEMO_TRACKS];
    }

    state.libraryTracks = loadedTracks;
    renderLibraryCards();
    updateHeaderStats();
  }

  function renderLibraryCards() {
    const grid = document.getElementById('library-cards-grid');
    if (!grid) return;

    // Remove existing song cards (preserve the + Add card)
    const existingCards = grid.querySelectorAll('.library-card.song-card');
    existingCards.forEach(c => c.remove());

    state.libraryTracks.forEach((track, index) => {
      const card = document.createElement('div');
      card.className = 'library-card song-card';
      const videoId = track.videoId || 'W22T_5YqH94';
      const thumbUrl = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;
      const isBrat = !!track.hasBratEffects;

      card.innerHTML = `
        <div class="song-card-thumb-box">
          <img src="${thumbUrl}" alt="${escapeHtml(track.title)}" onerror="this.src='https://images.unsplash.com/photo-1511671782779-c97d3d27a1d4?w=600&auto=format&fit=crop&q=60'" />
          <div class="song-card-badges-row">
            ${isBrat ? '<span class="badge-brat-kinetic">BRAT 808</span>' : '<span class="badge-brat-kinetic" style="background:#9d4edd;color:#fff;">CINEMA</span>'}
            ${track.humanReviewed ? '<span class="badge-human-verified">VERIFICADO ✨</span>' : ''}
            <span class="badge-lines-count">${track.linesCount || 0} versos</span>
          </div>
        </div>
        <div class="song-card-body">
          <h3 class="song-card-title">${escapeHtml(track.title)}</h3>
          <span class="song-card-artist">${escapeHtml(track.artist || 'Artista')}</span>
          <div class="song-card-actions">
            <button class="btn-edit" data-index="${index}">Editar Versos</button>
            <a class="btn-icon-action btn-icon-ytmusic" href="https://music.youtube.com/watch?v=${videoId}" target="_blank" rel="noopener noreferrer" title="Escuchar en YouTube Music">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <circle cx="12" cy="12" r="10" stroke="currentColor" stroke-width="2" fill="none"></circle>
                <polygon points="10 8 16 12 10 16 10 8"></polygon>
              </svg>
            </a>
            <button class="btn-icon-action btn-cinema-preview" data-index="${index}" title="Vista Previa Cinema">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
            </button>
            <button class="btn-icon-action btn-export-quick" data-index="${index}" title="Exportar JSON">
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
                <polyline points="7 10 12 15 17 10"></polyline>
                <line x1="12" y1="15" x2="12" y2="3"></line>
              </svg>
            </button>
          </div>
        </div>
      `;

      // Event listeners on card buttons
      card.querySelector('.btn-edit').addEventListener('click', () => openTrackInEditor(track, 1));
      card.querySelector('.btn-cinema-preview').addEventListener('click', () => openTrackInEditor(track, 3));
      card.querySelector('.btn-export-quick').addEventListener('click', () => {
        openTrackInEditor(track, 1, false);
        openExportModal();
      });

      grid.appendChild(card);
    });
  }

  function updateHeaderStats() {
    const totalEl = document.getElementById('stats-total-songs');
    const bratEl = document.getElementById('stats-brat-songs');
    if (totalEl) totalEl.textContent = state.libraryTracks.length;
    if (bratEl) bratEl.textContent = state.libraryTracks.filter(t => t.hasBratEffects).length;
  }

  /* =========================================================================
     3. OPEN & LOAD TRACK INTO STUDIO
     ========================================================================= */

  async function openTrackInEditor(trackMeta, initialStep = 1, switchView = true) {
    let fullTrack = null;

    // Fetch full track details from API or local file
    try {
      const getUrl = `/api/lyrics/get?title=${encodeURIComponent(trackMeta.title)}&artist=${encodeURIComponent(trackMeta.artist || '')}&videoId=${encodeURIComponent(trackMeta.videoId || '')}`;
      const res = await fetch(getUrl);
      if (res.ok) {
        const data = await res.json();
        if (data && data.found && data.track) {
          fullTrack = data.track;
        }
      }
    } catch (_) {}

    // Fallback if not on server yet (e.g. GitHub Pages)
    if (!fullTrack && trackMeta.fileName) {
      try {
        const fileRes = await fetch(`./database/${trackMeta.fileName}`);
        if (fileRes.ok) {
          const fileData = await fileRes.json();
          if (fileData && fileData.track) {
            fullTrack = fileData.track;
          }
        }
      } catch (_) {}
    }

    if (!fullTrack) {
      // Check localStorage
      try {
        const localSaved = JSON.parse(localStorage.getItem('auralyrics_cloud_tracks') || '[]');
        const foundLocal = localSaved.find(s => s.title === trackMeta.title && s.artist === trackMeta.artist);
        if (foundLocal && foundLocal.raw && foundLocal.raw.track) {
          fullTrack = foundLocal.raw.track;
        }
      } catch (_) {}
    }

    if (!fullTrack) {
      if (trackMeta.raw && trackMeta.raw.track) {
        fullTrack = trackMeta.raw.track;
      } else {
        fullTrack = {
          title: trackMeta.title,
          artist: trackMeta.artist || '',
          videoId: trackMeta.videoId || 'W22T_5YqH94',
          duration: trackMeta.duration || 133,
          lines: trackMeta.lines || [],
          effects: trackMeta.effects || { theme: 'brat', bassBeats: [], palette: 'lime', blur: 6, scale: 1.5, shake: true }
        };
      }
    }

    state.currentTrack = fullTrack;
    if (!state.currentTrack.effects) {
      state.currentTrack.effects = { theme: 'brat', bassBeats: [], palette: 'lime', blur: 6, scale: 1.5, shake: true, keyframes: [] };
    }
    if (!Array.isArray(state.currentTrack.effects.bassBeats)) {
      state.currentTrack.effects.bassBeats = [];
    }
    if (!Array.isArray(state.currentTrack.effects.keyframes) || state.currentTrack.effects.keyframes.length === 0) {
      state.currentTrack.effects.keyframes = [
        { time: 0, palette: 'lime', color: '#8acf00', bgMode: 'solid', layout: 'impact', variant: 'heavy', blur: 6, scale: 1.5, shake: true },
        { time: 24.0, palette: 'purple', color: '#9d4edd', bgMode: 'radial-glow', layout: 'spread', variant: 'lean', blur: 8, scale: 1.4, shake: true },
        { time: 55.0, palette: 'cyan', color: '#00f5d4', bgMode: 'brat-matrix', layout: 'scribble', variant: 'wide', blur: 10, scale: 1.8, shake: true }
      ];
    }

    // Auto-populate words if missing using AuraMusic syllable timing
    if (Array.isArray(state.currentTrack.lines)) {
      state.currentTrack.lines.forEach((l, idx) => {
        if (!Array.isArray(l.words) || l.words.length === 0) {
          const nextTime = (idx < state.currentTrack.lines.length - 1) ? state.currentTrack.lines[idx + 1].time : (l.time + 3.5);
          l.words = estimateWordsForLine(l.text, l.time, nextTime, state.syllablePace || 0.35);
        }
      });
    }

    // Update Header and Editor summaries
    const titleEl = document.getElementById('editor-track-title');
    const artistEl = document.getElementById('editor-track-artist');
    const thumbEl = document.getElementById('editor-track-thumb');
    if (titleEl) titleEl.textContent = state.currentTrack.title;
    if (artistEl) artistEl.textContent = state.currentTrack.artist || 'Desconocido';
    if (thumbEl && state.currentTrack.videoId) {
      thumbEl.src = `https://img.youtube.com/vi/${state.currentTrack.videoId}/hqdefault.jpg`;
    }

    // Update Human Review button in Step 2
    const hrBtn = document.getElementById('btn-toggle-human-review');
    const hrText = document.getElementById('lbl-human-review-text');
    if (hrBtn && hrText) {
      const isRev = !!state.currentTrack.humanReviewed;
      hrBtn.classList.toggle('verified', isRev);
      hrText.textContent = isRev ? 'Verificado por Humano ✨' : 'Marcar como Verificado por Humano';
    }

    // Actualizar enlace directo a YouTube Music
    const ytmBtn = document.getElementById('btn-open-ytmusic-live');
    if (ytmBtn && state.currentTrack.videoId) {
      ytmBtn.href = `https://music.youtube.com/watch?v=${state.currentTrack.videoId}`;
    }

    // Load video in YouTube player
    const defVid = state.currentTrack.videoId || 'WJW-VvmRKsE';
    if (state.ytPlayer && typeof state.ytPlayer.loadVideoById === 'function') {
      try {
        state.ytPlayer.cueVideoById(defVid);
      } catch (_) {}
    } else {
      createYouTubePlayer(defVid);
    }

    // Populate UI steps
    renderStep1Verses();
    renderStep2VerseDropdown();
    renderStep2WordsStage();
    renderStep3Effects();

    if (switchView) {
      switchViewMode('editor');
      switchStep(initialStep);
    }
  }

  function switchViewMode(viewName) {
    state.currentView = viewName;
    const libView = document.getElementById('view-library');
    const editView = document.getElementById('view-editor');

    if (viewName === 'editor') {
      if (libView) libView.style.display = 'none';
      if (editView) editView.style.display = 'flex';
    } else {
      if (libView) libView.style.display = 'flex';
      if (editView) editView.style.display = 'none';
      loadLibraryTracks(); // refresh list
    }
  }

  function switchStep(stepNum) {
    state.activeStep = stepNum;

    // Stepper header pills
    document.querySelectorAll('.pipeline-steps .step-btn').forEach(btn => {
      const s = parseInt(btn.dataset.step, 10);
      btn.classList.toggle('active', s === stepNum);
    });

    // Content containers
    const stepViews = [
      document.getElementById('step-view-1'),
      document.getElementById('step-view-2'),
      document.getElementById('step-view-3')
    ];

    stepViews.forEach((v, idx) => {
      if (v) v.style.display = (idx + 1 === stepNum) ? 'flex' : 'none';
    });

    // Refresh content for active step
    if (stepNum === 1) renderStep1Verses();
    if (stepNum === 2) {
      renderStep2VerseDropdown();
      renderStep2WordsStage();
    }
    if (stepNum === 3) renderStep3Effects();
  }

  /* =========================================================================
     4. STEP 1: VERSOS SYNCHRONIZATION
     ========================================================================= */

  function renderStep1Verses() {
    const list = document.getElementById('step1-verses-list');
    if (!list || !state.currentTrack) return;

    list.innerHTML = '';
    const lines = state.currentTrack.lines || [];

    if (lines.length === 0) {
      list.innerHTML = `
        <div style="padding: 30px; text-align: center; color: #64748b;">
          <p style="font-size: 1rem; margin-bottom: 8px;">No hay versos cargados aún.</p>
          <p style="font-size: 0.8rem;">Haz clic en <strong>✨ Buscar en LRCLIB</strong> o en <strong>Pegar Letra Raw</strong> arriba para importar.</p>
        </div>
      `;
      return;
    }

    lines.forEach((line, index) => {
      const row = document.createElement('div');
      row.className = 'verse-row-item' + (index === state.lastActiveVerseIdx ? ' active-verse' : '');
      row.dataset.index = index;

      row.innerHTML = `
        <span class="verse-timestamp-badge" title="Clic para saltar a este segundo">${formatTime(line.time)}</span>
        <div class="verse-text-box">${escapeHtml(line.text)}</div>
        <div class="verse-actions-box">
          <button class="btn-secondary-micro btn-stamp-this" title="Marcar inicio de este verso con el tiempo actual">📍 Marcar</button>
        </div>
      `;

      // Click row to seek to time
      row.addEventListener('click', (e) => {
        if (e.target.classList.contains('btn-stamp-this')) return;
        seekTo(line.time);
      });

      // Stamp this specific verse button
      row.querySelector('.btn-stamp-this').addEventListener('click', (e) => {
        e.stopPropagation();
        stampVerseAt(index);
      });

      list.appendChild(row);
    });
  }

  function stampVerseAt(index) {
    if (!state.currentTrack || !state.currentTrack.lines[index]) return;
    const curT = state.currentTime;
    state.currentTrack.lines[index].time = Math.round(curT * 100) / 100;

    // Recalculate word timing for this line
    const nextT = (index < state.currentTrack.lines.length - 1)
      ? state.currentTrack.lines[index + 1].time
      : (curT + 3.5);
    state.currentTrack.lines[index].words = distributeWordsForLine(state.currentTrack.lines[index].text, curT, nextT);

    renderStep1Verses();
    highlightActiveVerseInStep1();
  }

  function stampCurrentLiveVerse() {
    if (!state.currentTrack || !state.currentTrack.lines || state.currentTrack.lines.length === 0) return;
    const curT = state.currentTime;

    // Find the next verse to stamp (the first one whose time is after curT, or active + 1)
    let targetIdx = state.lastActiveVerseIdx + 1;
    if (targetIdx >= state.currentTrack.lines.length) targetIdx = 0;

    stampVerseAt(targetIdx);

    // Visual pulse on the stamp button
    const btn = document.getElementById('btn-tap-verse-stamp');
    if (btn) {
      btn.style.transform = 'scale(0.94)';
      setTimeout(() => { btn.style.transform = ''; }, 120);
    }
  }

  /* =========================================================================
     5. STEP 2: FRASES Y PALABRAS (MOTOR AURAMUSIC & REVISIÓN HUMANA)
     ========================================================================= */

  function toggleHumanReview() {
    if (!state.currentTrack) return;
    state.currentTrack.humanReviewed = !state.currentTrack.humanReviewed;
    const hrBtn = document.getElementById('btn-toggle-human-review');
    const hrText = document.getElementById('lbl-human-review-text');
    if (hrBtn && hrText) {
      const isRev = state.currentTrack.humanReviewed;
      hrBtn.classList.toggle('verified', isRev);
      hrText.textContent = isRev ? 'Verificado por Humano ✨' : 'Marcar como Verificado por Humano';
    }
  }

  function reanalyzeWithAuraMusicEngine() {
    if (!state.currentTrack || !Array.isArray(state.currentTrack.lines)) return;
    const lines = state.currentTrack.lines;
    const pacingProfiles = profilePacing(lines);
    const pace = state.syllablePace || 0.35;

    lines.forEach((l, idx) => {
      const nextTime = (idx < lines.length - 1) ? lines[idx + 1].time : (l.time + 3.5);
      const localPace = pacingProfiles[idx] || pace;
      l.words = estimateWordsForLine(l.text, l.time, nextTime, localPace);
    });

    renderStep2WordsStage();
    alert(`✨ Se re-analizaron ${lines.length} versos con el motor fonético de AuraMusic (${pace.toFixed(2)}s/sílaba).`);
  }

  function renderStep2VerseDropdown() {
    const dd = document.getElementById('words-verse-dropdown');
    if (!dd || !state.currentTrack) return;

    dd.innerHTML = '';
    const lines = state.currentTrack.lines || [];

    lines.forEach((l, idx) => {
      const opt = document.createElement('option');
      opt.value = idx;
      opt.textContent = `${formatTime(l.time)} — ${l.text.substring(0, 40)}`;
      if (idx === state.selectedVerseIndex) opt.selected = true;
      dd.appendChild(opt);
    });

    const vocalSelect = document.getElementById('verse-vocal-type');
    if (vocalSelect && lines[state.selectedVerseIndex]) {
      vocalSelect.value = lines[state.selectedVerseIndex].type || 'vocal';
    }

    const paceSlider = document.getElementById('slider-syllable-pace');
    const paceLbl = document.getElementById('lbl-pace-val');
    if (paceSlider && paceLbl) {
      paceSlider.value = state.syllablePace || 0.35;
      paceLbl.textContent = `${(state.syllablePace || 0.35).toFixed(2)}s`;
    }
  }

  function renderStep2WordsStage() {
    const stage = document.getElementById('step2-words-stage');
    if (!stage || !state.currentTrack) return;

    stage.innerHTML = '';
    const line = state.currentTrack.lines[state.selectedVerseIndex];

    if (!line) {
      stage.innerHTML = `<div style="padding: 20px; color: #64748b;">Selecciona un verso para editar sus frases y palabras.</div>`;
      return;
    }

    // Asegurar palabras estimadas si no existen
    if (!Array.isArray(line.words) || line.words.length === 0) {
      const nextTime = (state.selectedVerseIndex < state.currentTrack.lines.length - 1)
        ? state.currentTrack.lines[state.selectedVerseIndex + 1].time
        : (line.time + 3.5);
      line.words = estimateWordsForLine(line.text, line.time, nextTime, state.syllablePace || 0.35);
    }

    // Segmentación de frases de AuraMusic
    const tokens = tokenize(line.text);
    const phrases = splitLinePhrases(tokens, line.words);

    const container = document.createElement('div');
    container.className = 'phrase-blocks-flow';

    phrases.forEach((phrase, pIdx) => {
      const pCard = document.createElement('div');
      pCard.className = 'phrase-block-card';

      const pStart = phrase.startTime.toFixed(2);
      const pEnd = phrase.endTime.toFixed(2);
      const dur = Math.max(0.1, phrase.endTime - phrase.startTime).toFixed(2);

      pCard.innerHTML = `
        <div class="phrase-block-header">
          <div class="phrase-meta-info">
            <span class="phrase-index-tag">Frase #${pIdx + 1}</span>
            <span>Inicio: <strong>${pStart}s</strong></span>
            <span>Fin: <strong>${pEnd}s</strong></span>
            <span style="color:var(--accent-lime)">(${dur}s)</span>
          </div>
          <div class="phrase-actions">
            <button class="btn-split-phrase" data-pidx="${pIdx}">✂️ Dividir Frase</button>
            ${pIdx < phrases.length - 1 ? `<button class="btn-merge-phrase" data-pidx="${pIdx}">🔗 Unir con Siguiente</button>` : ''}
          </div>
        </div>
        <div class="phrase-words-row" id="phrase-words-${pIdx}"></div>
      `;

      const wordsRow = pCard.querySelector(`#phrase-words-${pIdx}`);

      phrase.words.forEach((w) => {
        const wChip = document.createElement('div');
        wChip.className = 'word-chip-box';

        const isCurrent = state.currentTime >= w.start && state.currentTime < w.end;
        if (isCurrent) wChip.classList.add('current-word');

        wChip.innerHTML = `
          <div class="word-text-line">
            <span>${escapeHtml(w.word)}</span>
            <span class="word-time-badge">${w.start.toFixed(2)}s</span>
          </div>
          <div class="word-nudge-row">
            <button class="btn-word-nudge btn-nudge-minus" title="Adelantar -0.1s">-0.1s</button>
            <button class="btn-word-nudge btn-play-single-word" title="Escuchar">▶</button>
            <button class="btn-word-nudge btn-nudge-plus" title="Atrasar +0.1s">+0.1s</button>
          </div>
        `;

        wChip.querySelector('.btn-nudge-minus').addEventListener('click', (e) => {
          e.stopPropagation();
          w.start = Math.max(0, Math.round((w.start - 0.1) * 100) / 100);
          w.end = Math.max(w.start + 0.05, Math.round((w.end - 0.1) * 100) / 100);
          renderStep2WordsStage();
        });

        wChip.querySelector('.btn-nudge-plus').addEventListener('click', (e) => {
          e.stopPropagation();
          w.start = Math.round((w.start + 0.1) * 100) / 100;
          w.end = Math.round((w.end + 0.1) * 100) / 100;
          renderStep2WordsStage();
        });

        wChip.querySelector('.btn-play-single-word').addEventListener('click', (e) => {
          e.stopPropagation();
          seekTo(w.start);
          play();
        });

        wordsRow.appendChild(wChip);
      });

      // Split button listener
      pCard.querySelector('.btn-split-phrase')?.addEventListener('click', () => {
        if (phrase.words.length <= 1) {
          alert('Esta frase tiene solo 1 palabra, no se puede dividir más.');
          return;
        }
        const mid = Math.floor(phrase.words.length / 2);
        const secondHalfStart = phrase.words[mid].start;
        phrase.words[mid - 1].end = secondHalfStart;
        renderStep2WordsStage();
      });

      // Merge button listener
      pCard.querySelector('.btn-merge-phrase')?.addEventListener('click', () => {
        if (pIdx < phrases.length - 1) {
          const nextP = phrases[pIdx + 1];
          phrase.endTime = nextP.endTime;
          if (phrase.words.length && nextP.words.length) {
            phrase.words[phrase.words.length - 1].end = nextP.words[0].start;
          }
          renderStep2WordsStage();
        }
      });

      container.appendChild(pCard);
    });

    stage.appendChild(container);
  }

  /* =========================================================================
     6. STEP 3: EDITOR DE VIDEO & KEYFRAMES DE COLOR
     ========================================================================= */

  function renderStep3Effects() {
    if (!state.currentTrack) return;
    if (!state.currentTrack.effects) {
      state.currentTrack.effects = {
        theme: 'brat',
        bassBeats: [],
        palette: 'lime',
        blur: 6,
        scale: 1.5,
        shake: true,
        keyframes: []
      };
    }
    if (!Array.isArray(state.currentTrack.effects.keyframes) || state.currentTrack.effects.keyframes.length === 0) {
      state.currentTrack.effects.keyframes = [
        { time: 0, palette: 'lime', color: '#8acf00', bgMode: 'solid', layout: 'impact', variant: 'heavy', blur: 6, scale: 1.5, shake: true },
        { time: 24.0, palette: 'purple', color: '#9d4edd', bgMode: 'radial-glow', layout: 'spread', variant: 'lean', blur: 8, scale: 1.4, shake: true },
        { time: 55.0, palette: 'cyan', color: '#00f5d4', bgMode: 'brat-matrix', layout: 'scribble', variant: 'wide', blur: 10, scale: 1.8, shake: true }
      ];
    }

    renderVideoEditorTimeline();
    renderKeyframeInspector();
    updateLiveCinemaStageFromKeyframes();
  }

  function renderVideoEditorTimeline() {
    const dur = Math.max(10, state.duration || 133);
    const ruler = document.getElementById('ve-ruler-track');
    const lanesArea = document.getElementById('ve-timeline-lanes-area');
    const laneColors = document.getElementById('ve-lane-colors');
    const laneLayout = document.getElementById('ve-lane-layout');
    const laneBeats = document.getElementById('ve-lane-beats');
    const playhead = document.getElementById('ve-playhead-needle');
    const tcDigits = document.getElementById('ve-tc-display');

    if (tcDigits) tcDigits.textContent = formatTime(state.currentTime);
    if (playhead) {
      const pct = (state.currentTime / dur) * 100;
      playhead.style.left = `${Math.min(100, Math.max(0, pct))}%`;
    }

    // Ruler notches across full width of lanes
    if (ruler) {
      ruler.innerHTML = '';
      const step = dur > 120 ? 15 : 10;
      for (let sec = 0; sec <= dur; sec += step) {
        const pct = (sec / dur) * 100;
        const notch = document.createElement('div');
        notch.className = 've-ruler-notch';
        notch.style.left = `${pct}%`;
        notch.textContent = formatTime(sec).split('.')[0];
        ruler.appendChild(notch);
      }
    }

    // Click anywhere on timeline tracks area to scrub and seek
    if (lanesArea && !lanesArea.dataset.clickSeekAttached) {
      lanesArea.dataset.clickSeekAttached = '1';
      lanesArea.addEventListener('click', (e) => {
        // If clicking a diamond, diamond handler stops propagation
        if (e.target.closest('.ve-kf-diamond')) return;
        const rect = lanesArea.getBoundingClientRect();
        if (rect.width <= 0) return;
        const clickX = Math.max(0, Math.min(rect.width, e.clientX - rect.left));
        const pct = clickX / rect.width;
        const targetTime = pct * (state.duration || 133);
        seekTo(targetTime);
        if (playhead) playhead.style.left = `${pct * 100}%`;
        if (tcDigits) tcDigits.textContent = formatTime(targetTime);
      });
    }

    // Color Lane Keyframes
    if (laneColors) {
      laneColors.innerHTML = '';
      const keyframes = state.currentTrack?.effects?.keyframes || [];

      keyframes.forEach((kf, idx) => {
        const pct = (kf.time / dur) * 100;
        const diamond = document.createElement('div');
        diamond.className = `ve-kf-diamond kf-color-${kf.palette || 'lime'}` + (idx === state.selectedKeyframeIndex ? ' selected' : '');
        diamond.style.left = `${pct}%`;
        diamond.style.backgroundColor = kf.color || '#8acf00';
        diamond.title = `Keyframe #${idx + 1} (${formatTime(kf.time)}) — Color: ${kf.color || kf.palette}`;

        diamond.addEventListener('click', (e) => {
          e.stopPropagation();
          state.selectedKeyframeIndex = idx;
          seekTo(kf.time);
          renderStep3Effects();
        });

        laneColors.appendChild(diamond);
      });
    }

    // Layout Lane Keyframes
    if (laneLayout) {
      laneLayout.innerHTML = '';
      const keyframes = state.currentTrack?.effects?.keyframes || [];

      keyframes.forEach((kf, idx) => {
        const pct = (kf.time / dur) * 100;
        const diamond = document.createElement('div');
        diamond.className = 've-kf-diamond kf-layout-diamond' + (idx === state.selectedKeyframeIndex ? ' selected' : '');
        diamond.style.left = `${pct}%`;
        diamond.title = `Layout: ${kf.layout || 'impact'} (${formatTime(kf.time)})`;

        diamond.addEventListener('click', (e) => {
          e.stopPropagation();
          state.selectedKeyframeIndex = idx;
          seekTo(kf.time);
          renderStep3Effects();
        });

        laneLayout.appendChild(diamond);
      });
    }

    // 808 Beats Lane
    if (laneBeats) {
      laneBeats.innerHTML = '';
      const beats = state.currentTrack?.effects?.bassBeats || [];

      beats.forEach(b => {
        const pct = (b / dur) * 100;
        const marker = document.createElement('div');
        marker.className = 've-beat-marker';
        marker.style.left = `${pct}%`;
        marker.title = `Golpe 808 en ${formatTime(b)}`;
        laneBeats.appendChild(marker);
      });
    }
  }

  function renderKeyframeInspector() {
    const kfs = state.currentTrack.effects.keyframes || [];
    const kf = kfs[state.selectedKeyframeIndex] || kfs[0];
    if (!kf) return;

    const titleEl = document.getElementById('inspector-kf-title');
    const inputTime = document.getElementById('input-kf-time');
    const customColor = document.getElementById('input-kf-custom-color');
    const colorHexLbl = document.getElementById('lbl-kf-color-hex');
    const bgSelect = document.getElementById('select-kf-bg-mode');
    const blurSlider = document.getElementById('step3-slider-blur');
    const scaleSlider = document.getElementById('step3-slider-scale');
    const blurLbl = document.getElementById('lbl-blur-val');
    const scaleLbl = document.getElementById('lbl-scale-val');
    const shakeChk = document.getElementById('step3-chk-shake');

    if (titleEl) titleEl.textContent = `💎 Keyframe #${state.selectedKeyframeIndex + 1} (${formatTime(kf.time)})`;
    if (inputTime) inputTime.value = formatTime(kf.time);
    if (customColor) customColor.value = kf.color || '#8acf00';
    if (colorHexLbl) colorHexLbl.textContent = kf.color || '#8acf00';
    if (bgSelect) bgSelect.value = kf.bgMode || 'solid';
    if (blurSlider) blurSlider.value = kf.blur || 6;
    if (scaleSlider) scaleSlider.value = kf.scale || 1.5;
    if (blurLbl) blurLbl.textContent = `${kf.blur || 6}px`;
    if (scaleLbl) scaleLbl.textContent = `${kf.scale || 1.5}x`;
    if (shakeChk) shakeChk.checked = kf.shake !== false;

    // Palette swatches active
    document.querySelectorAll('.ve-color-grid .palette-swatch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.palette === kf.palette);
    });

    // Layout buttons active
    document.querySelectorAll('.ve-layout-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === (kf.layout || 'impact'));
    });

    // Variant buttons active
    document.querySelectorAll('.ve-var-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.variant === (kf.variant || 'heavy'));
    });
  }

  function addKeyframeAtCurrentTime() {
    if (!state.currentTrack) return;
    const curT = Math.round(state.currentTime * 100) / 100;
    const kfs = state.currentTrack.effects.keyframes;

    // Check if keyframe already exists nearby
    const existing = kfs.findIndex(k => Math.abs(k.time - curT) < 0.2);
    if (existing >= 0) {
      state.selectedKeyframeIndex = existing;
    } else {
      const prevKf = getActiveKeyframeAtTime(curT) || {};
      const newKf = {
        time: curT,
        palette: prevKf.palette || 'lime',
        color: prevKf.color || '#8acf00',
        bgMode: prevKf.bgMode || 'radial-glow',
        layout: prevKf.layout || 'impact',
        variant: prevKf.variant || 'heavy',
        blur: prevKf.blur || 6,
        scale: prevKf.scale || 1.5,
        shake: prevKf.shake !== false
      };
      kfs.push(newKf);
      kfs.sort((a, b) => a.time - b.time);
      state.selectedKeyframeIndex = kfs.indexOf(newKf);
    }

    renderStep3Effects();
  }

  function deleteSelectedKeyframe() {
    const kfs = state.currentTrack.effects.keyframes;
    if (!kfs || kfs.length <= 1) {
      alert('Debe haber al menos 1 keyframe para la estética de la canción.');
      return;
    }
    kfs.splice(state.selectedKeyframeIndex, 1);
    state.selectedKeyframeIndex = Math.max(0, state.selectedKeyframeIndex - 1);
    renderStep3Effects();
  }

  function autoGenerateSectionKeyframes() {
    if (!state.currentTrack || !Array.isArray(state.currentTrack.lines) || !state.currentTrack.lines.length) return;
    const lines = state.currentTrack.lines;
    const dur = state.duration || 133;
    const palettes = ['lime', 'purple', 'cyan', 'red', 'yellow', 'ink'];
    const colors = ['#8acf00', '#9d4edd', '#00f5d4', '#ff0055', '#ffbe0b', '#0a0a0a'];
    const layouts = ['impact', 'center', 'spread', 'scribble'];
    const variants = ['heavy', 'lean', 'wide', 'plain'];
    const bgModes = ['solid', 'radial-glow', 'brat-matrix', 'crt-scanlines'];

    const newKfs = [];
    const stepLines = Math.max(2, Math.floor(lines.length / 5));

    for (let i = 0; i < lines.length; i += stepLines) {
      const line = lines[i];
      const pIdx = (i / stepLines) % palettes.length;
      newKfs.push({
        time: Math.round(line.time * 100) / 100,
        palette: palettes[pIdx],
        color: colors[pIdx],
        bgMode: bgModes[pIdx % bgModes.length],
        layout: layouts[pIdx % layouts.length],
        variant: variants[pIdx % variants.length],
        blur: 6 + (pIdx % 4) * 2,
        scale: 1.4 + (pIdx % 3) * 0.2,
        shake: true
      });
    }

    state.currentTrack.effects.keyframes = newKfs;
    state.selectedKeyframeIndex = 0;
    renderStep3Effects();
    alert(`✨ Se auto-generaron ${newKfs.length} keyframes de color y escena a lo largo de la canción.`);
  }

  function getActiveKeyframeAtTime(time) {
    if (!state.currentTrack || !state.currentTrack.effects) return null;
    const kfs = state.currentTrack.effects.keyframes || [];
    if (!kfs.length) return null;

    let active = kfs[0];
    for (let i = 0; i < kfs.length; i++) {
      if (time >= kfs[i].time) {
        active = kfs[i];
      } else {
        break;
      }
    }
    return active;
  }

  function updateLiveCinemaStageFromKeyframes() {
    const stage = document.getElementById('step3-cinema-stage');
    const badge = document.getElementById('stage-active-kf-badge');
    if (!stage) return;

    const kf = getActiveKeyframeAtTime(state.currentTime);
    if (!kf) return;

    stage.setAttribute('data-lyrics-theme', 'brat');
    stage.setAttribute('data-brat-palette', kf.palette || 'lime');
    stage.setAttribute('data-bg-mode', kf.bgMode || 'solid');
    stage.setAttribute('data-layout', kf.layout || 'impact');
    stage.setAttribute('data-variant', kf.variant || 'heavy');

    if (kf.color) {
      stage.style.setProperty('--stage-accent-color', kf.color);
      const hex = kf.color.replace('#', '');
      if (hex.length === 6) {
        const r = parseInt(hex.substring(0, 2), 16);
        const g = parseInt(hex.substring(2, 4), 16);
        const b = parseInt(hex.substring(4, 6), 16);
        stage.style.setProperty('--stage-accent-glow', `rgba(${r}, ${g}, ${b}, 0.5)`);

        if (kf.bgMode === 'solid' && kf.palette === 'custom') {
          stage.style.backgroundColor = kf.color;
          const yiq = ((r * 299) + (g * 587) + (b * 114)) / 1000;
          stage.style.color = (yiq >= 128) ? '#000000' : '#ffffff';
        } else {
          stage.style.backgroundColor = '';
          stage.style.color = '';
        }
      }
    } else {
      stage.style.backgroundColor = '';
      stage.style.color = '';
    }

    if (badge) {
      badge.textContent = `KF: ${(kf.palette || 'custom').toUpperCase()} ${kf.color || ''}`;
      badge.style.borderColor = kf.color || '#8acf00';
      badge.style.color = kf.color || '#8acf00';
    }
  }

  function addBassBeatStamp() {
    if (!state.currentTrack) return;
    const curT = Math.round(state.currentTime * 100) / 100;
    if (!state.currentTrack.effects.bassBeats.includes(curT)) {
      state.currentTrack.effects.bassBeats.push(curT);
      state.currentTrack.effects.bassBeats.sort((a, b) => a - b);
    }

    // Trigger visual hit immediately
    triggerStageBeatHit();
    renderStep3Effects();

    // Pulse button
    const btn = document.getElementById('btn-tap-beat-stamp');
    if (btn) {
      btn.style.transform = 'scale(0.94)';
      setTimeout(() => { btn.style.transform = ''; }, 120);
    }
  }

  function triggerStageBeatHit(is808 = true) {
    const stage = document.getElementById('step3-cinema-stage');
    if (!stage) return;

    stage.setAttribute('data-beat', 'hit');
    if (is808) {
      stage.setAttribute('data-beat-intensity', '808');
      stage.setAttribute('data-flash', 'contrast');
    }

    setTimeout(() => {
      stage.removeAttribute('data-beat');
      stage.removeAttribute('data-beat-intensity');
      stage.removeAttribute('data-flash');
    }, 180);
  }

  function renderBeatMarkersTrack() {
    const trackEl = document.getElementById('dock-beat-markers');
    if (!trackEl || !state.currentTrack) return;

    trackEl.innerHTML = '';
    const beats = state.currentTrack.effects.bassBeats || [];
    const dur = state.duration || 133;

    beats.forEach(b => {
      const pct = (b / dur) * 100;
      const tick = document.createElement('div');
      tick.className = 'beat-tick';
      tick.style.left = `${pct}%`;
      trackEl.appendChild(tick);
    });
  }

  /* =========================================================================
     7. SYNCHRONIZATION LOOP & CINEMA PREVIEW RENDERER
     ========================================================================= */

  function startSyncLoop() {
    if (state.syncLoopId) cancelAnimationFrame(state.syncLoopId);

    const sync = () => {
      if (state.isYtReady && state.ytPlayer && typeof state.ytPlayer.getCurrentTime === 'function') {
        try {
          const curT = state.ytPlayer.getCurrentTime();
          if (typeof curT === 'number' && !isNaN(curT)) {
            state.currentTime = curT;
            updateDockProgress(curT);
            checkAndHighlightLiveVerse(curT);
            checkAndTriggerBeats(curT);

            // Actualización fluida de la línea de tiempo del editor de video en el Paso 3
            if (state.activeStep === 3) {
              const dur = Math.max(10, state.duration || 133);
              const playhead = document.getElementById('ve-playhead-needle');
              const tcDigits = document.getElementById('ve-tc-display');
              if (playhead) {
                const pct = (curT / dur) * 100;
                playhead.style.left = `${Math.min(100, Math.max(0, pct))}%`;
              }
              if (tcDigits) tcDigits.textContent = formatTime(curT);
              updateLiveCinemaStageFromKeyframes();
            }
          }
        } catch (_) {}
      }

      if (state.isPlaying) {
        state.syncLoopId = requestAnimationFrame(sync);
      }
    };

    state.syncLoopId = requestAnimationFrame(sync);
  }

  function stopSyncLoop() {
    if (state.syncLoopId) {
      cancelAnimationFrame(state.syncLoopId);
      state.syncLoopId = null;
    }
  }

  function updateDockProgress(curT) {
    const timeCurEl = document.getElementById('dock-time-current');
    const slider = document.getElementById('dock-seeker-slider');
    if (timeCurEl) timeCurEl.textContent = formatTime(curT);

    if (slider && state.duration > 0) {
      const pct = (curT / state.duration) * 100;
      slider.value = pct;
    }
  }

  function checkAndHighlightLiveVerse(curT) {
    if (!state.currentTrack || !state.currentTrack.lines) return;
    const lines = state.currentTrack.lines;

    let activeIdx = -1;
    for (let i = 0; i < lines.length; i++) {
      const lineTime = lines[i].time;
      const nextTime = (i < lines.length - 1) ? lines[i + 1].time : (lineTime + 4.0);
      if (curT >= lineTime && curT < nextTime) {
        activeIdx = i;
        break;
      }
    }

    if (activeIdx !== state.lastActiveVerseIdx) {
      state.lastActiveVerseIdx = activeIdx;
      highlightActiveVerseInStep1();
      renderCinemaStageActiveLine(activeIdx, curT);
    } else if (activeIdx >= 0) {
      updateCinemaStageWordHighlight(activeIdx, curT);
    }
  }

  function highlightActiveVerseInStep1() {
    const items = document.querySelectorAll('.verse-row-item');
    items.forEach((row, idx) => {
      const isPast = idx < state.lastActiveVerseIdx;
      const isActive = idx === state.lastActiveVerseIdx;
      row.classList.toggle('active-verse', isActive);
      row.classList.toggle('sung-verse', isPast);

      if (isActive && state.activeStep === 1) {
        row.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    });
  }

  function fitBratText(fullText, element) {
    if (!element || !fullText) return;
    const stage = element.closest('.cinema-brat-stage');
    const impact = stage?.dataset.layout === 'impact';
    const maxSize = impact ? Math.max(65, Math.min(220, Math.round((stage?.clientWidth || 800) * 0.16)))
                           : Math.max(50, Math.min(160, Math.round((stage?.clientWidth || 800) * 0.11)));
    const minSize = 34;
    const availableWidth = Math.max(220, (stage?.clientWidth || 800) * 0.92);
    const availableHeight = Math.max(160, (stage?.clientHeight || 420) * 0.82);

    const measure = element.cloneNode(true);
    measure.removeAttribute('id');
    measure.setAttribute('aria-hidden', 'true');
    measure.style.cssText = `position:absolute;visibility:hidden;pointer-events:none;width:${availableWidth}px;max-height:none;min-height:0;height:auto;overflow:visible;animation:none;transition:none;font-size:${maxSize}px`;
    document.body.appendChild(measure);

    let size = maxSize;
    while (size > minSize && (measure.scrollWidth > availableWidth + 4 || measure.scrollHeight > availableHeight + 4)) {
      size = Math.max(minSize, size - (size > 110 ? 6 : 3));
      measure.style.fontSize = `${size}px`;
    }
    measure.remove();
    element.style.fontSize = `${size}px`;
  }

  function renderBratWords(stageText, count, previousCount, allowAnimation = true) {
    if (!stageText) return;
    const words = stageText.querySelectorAll('.brat-word');
    words.forEach((span, i) => {
      const revealed = i < count;
      const wasHidden = span.classList.contains('is-hidden');
      span.classList.toggle('is-hidden', !revealed);
      if (revealed && wasHidden && allowAnimation && (count - previousCount <= 2)) {
        span.classList.add('brat-word--new');
      } else if (!revealed) {
        span.classList.remove('brat-word--new');
      }
      span.classList.toggle('brat-word--active', i === count - 1 || (count > 0 && i < count && i >= count - 2));
      span.classList.toggle('brat-word--past', i < count - 2);
    });
  }

  let lastBratVerseIdx = -1;

  function renderCinemaStageActiveLine(activeIdx, curT) {
    const stageText = document.getElementById('step3-stage-brat-text') || document.getElementById('step3-stage-active-line');
    if (!stageText || !state.currentTrack) return;

    if (activeIdx < 0 || activeIdx >= state.currentTrack.lines.length) {
      stageText.innerHTML = `<span class="brat-word brat-word--active"><span class="brat-word-ink">AURALYRICS</span></span>`;
      lastBratVerseIdx = -1;
      return;
    }

    const line = state.currentTrack.lines[activeIdx];
    const words = line.words || distributeWordsForLine(line.text, line.time, line.time + 3.5);

    if (activeIdx !== lastBratVerseIdx) {
      lastBratVerseIdx = activeIdx;
      stageText.replaceChildren();

      words.forEach(w => {
        const span = document.createElement('span');
        span.className = 'brat-word is-hidden';
        const ink = document.createElement('span');
        ink.className = 'brat-word-ink';
        ink.textContent = w.word;
        span.appendChild(ink);
        span.appendChild(document.createTextNode(' '));
        span.addEventListener('animationend', (e) => {
          if (e.target === ink) span.classList.remove('brat-word--new');
        });
        stageText.appendChild(span);
      });

      fitBratText(line.text, stageText);
      stageText.dataset.bratCount = '0';
    }

    updateCinemaStageWordHighlight(activeIdx, curT);
  }

  function updateCinemaStageWordHighlight(activeIdx, curT) {
    const stageText = document.getElementById('step3-stage-brat-text') || document.getElementById('step3-stage-active-line');
    if (!stageText || !state.currentTrack || activeIdx < 0) return;

    const line = state.currentTrack.lines[activeIdx];
    const words = line.words || [];

    let count = 0;
    for (let i = 0; i < words.length; i++) {
      if (curT >= words[i].start) {
        count = i + 1;
      } else {
        break;
      }
    }

    const prevCount = parseInt(stageText.dataset.bratCount || '0', 10);
    if (count !== prevCount) {
      stageText.dataset.bratCount = String(count);
      renderBratWords(stageText, count, prevCount, state.isPlaying);
    }
  }

  function checkAndTriggerBeats(curT) {
    if (!state.currentTrack || !state.currentTrack.effects.shake) return;
    const beats = state.currentTrack.effects.bassBeats || [];

    for (let i = 0; i < beats.length; i++) {
      const bTime = beats[i];
      if (Math.abs(curT - bTime) < 0.08 && i !== state.activeBeatIndex) {
        state.activeBeatIndex = i;
        triggerStageBeatHit();
        break;
      }
    }
  }

  /* =========================================================================
     8. LRCLIB AUTO-SYNC & PARSING ENGINE
     ========================================================================= */

  async function fetchLrclibLyrics(title, artist, duration = 180) {
    // 1. Limpieza exhaustiva de título: remover coletillas de YouTube (Official Video, Audio, Visualizer, etc.)
    let cleanTitle = String(title || '')
      .replace(/\s*[\(\[](?:official\s*(?:music\s*)?video|video\s*oficial|visualizer|lyric\s*video|audio\s*(?:oficial)?|lyrics?|remix|hd|4k|videoclip|letra|en\s*vivo|live)[\)\]]/gi, '')
      .replace(/\s*-\s*(?:video\s*oficial|official\s*(?:music\s*)?video|visualizer|audio\s*oficial|audio|videoclip|letra)/gi, '')
      .replace(/["'“”«»]/g, '')
      .replace(/\s+/g, ' ')
      .trim();

    // 2. Si el título incluye "Artista - Canción" y el campo artista está vacío o genérico, separarlo automáticamente
    let detectedArtist = String(artist || '').trim();
    if ((!detectedArtist || detectedArtist.toLowerCase() === 'artista' || detectedArtist.toLowerCase() === 'desconocido') && cleanTitle.includes(' - ')) {
      const parts = cleanTitle.split(' - ');
      detectedArtist = parts[0].trim();
      cleanTitle = parts.slice(1).join(' - ').trim();
    }

    if (detectedArtist.toLowerCase() === 'artista' || detectedArtist.toLowerCase() === 'desconocido') {
      detectedArtist = '';
    }

    const cleanArtist = detectedArtist.split(/[•·,\/]/)[0].replace(/["'“”«»]/g, '').trim();
    console.log(`✨ Buscando en LRCLIB: Título="${cleanTitle}", Artista="${cleanArtist}"`);

    // 3. Cascada de consultas optimizada (búsqueda difusa primero por máxima tolerancia)
    const queries = [];
    if (cleanTitle && cleanArtist) {
      queries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanArtist + ' ' + cleanTitle)}`);
      queries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle + ' ' + cleanArtist)}`);
      queries.push(`https://lrclib.net/api/search?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`);
    }
    if (cleanTitle) {
      queries.push(`https://lrclib.net/api/search?q=${encodeURIComponent(cleanTitle)}`);
    }

    for (const url of queries) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 4500);
        const res = await fetch(url, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const list = await res.json();
          if (Array.isArray(list) && list.length > 0) {
            // Prioridad 1: Canción con letra sincronizada
            const withSynced = list.find(item => item.syncedLyrics && item.syncedLyrics.trim().length > 0);
            if (withSynced) {
              console.log('✅ LRCLIB: Letra sincronizada encontrada en', withSynced.trackName, 'de', withSynced.artistName);
              return {
                lines: parseLrcLyrics(withSynced.syncedLyrics, duration || withSynced.duration || 180),
                foundTrackName: withSynced.trackName,
                foundArtistName: withSynced.artistName,
                isSynced: true
              };
            }

            // Prioridad 2: Canción con letra en texto plano
            const withPlain = list.find(item => item.plainLyrics && item.plainLyrics.trim().length > 0);
            if (withPlain) {
              console.log('ℹ️ LRCLIB: Letra en texto plano encontrada en', withPlain.trackName);
              return {
                lines: parsePlainLyrics(withPlain.plainLyrics, duration || withPlain.duration || 180),
                foundTrackName: withPlain.trackName,
                foundArtistName: withPlain.artistName,
                isSynced: false
              };
            }
          }
        }
      } catch (e) {
        console.warn('LRCLIB advertencia en consulta:', url, e);
      }
    }

    // 4. Intento directo con /api/get (coincidencia estricta)
    if (cleanTitle && cleanArtist) {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 3500);
        const getUrl = `https://lrclib.net/api/get?track_name=${encodeURIComponent(cleanTitle)}&artist_name=${encodeURIComponent(cleanArtist)}`;
        const res = await fetch(getUrl, { signal: controller.signal });
        clearTimeout(timeoutId);

        if (res.ok) {
          const d = await res.json();
          if (d.syncedLyrics) {
            return {
              lines: parseLrcLyrics(d.syncedLyrics, duration || d.duration || 180),
              foundTrackName: d.trackName,
              foundArtistName: d.artistName,
              isSynced: true
            };
          }
          if (d.plainLyrics) {
            return {
              lines: parsePlainLyrics(d.plainLyrics, duration || d.duration || 180),
              foundTrackName: d.trackName,
              foundArtistName: d.artistName,
              isSynced: false
            };
          }
        }
      } catch (_) {}
    }

    return null;
  }

  function parsePlainLyrics(plainText, totalDuration = 180) {
    if (!plainText) return [];
    const rawLines = plainText.split('\n').map(l => l.trim()).filter(l => l && !l.startsWith('[') && !l.endsWith(']'));
    if (rawLines.length === 0) return [];

    const step = Math.max(2.5, (totalDuration - 5) / rawLines.length);
    return rawLines.map((line, idx) => {
      const time = Math.round((idx * step) * 100) / 100;
      const nextTime = Math.round(((idx + 1) * step) * 100) / 100;
      return {
        time,
        text: line,
        type: 'vocal',
        words: distributeWordsForLine(line, time, nextTime)
      };
    });
  }

  function parseLrcLyrics(lrcText, totalDuration = 180) {
    if (!lrcText) return [];
    const rawLines = lrcText.split('\n');
    const result = [];

    rawLines.forEach(lineStr => {
      // Soporte para múltiples marcas de tiempo por línea [00:12.34][01:05.10]
      const tagRegex = /\[(\d{1,2}):(\d{2}(?:[\.:]\d+)?)\]/g;
      let match;
      const timestamps = [];
      while ((match = tagRegex.exec(lineStr)) !== null) {
        const m = parseInt(match[1], 10);
        const s = parseFloat(match[2].replace(':', '.'));
        timestamps.push(Math.round((m * 60 + s) * 100) / 100);
      }

      const cleanText = lineStr.replace(/\[\d{1,2}:\d{2}(?:[\.:]\d+)?\]/g, '').replace(/<[^>]+>/g, '').trim();
      if (cleanText && timestamps.length > 0) {
        timestamps.forEach(time => {
          result.push({
            time,
            text: cleanText,
            type: 'vocal',
            words: []
          });
        });
      }
    });

    result.sort((a, b) => a.time - b.time);

    // Auto-distribuir palabras para cada verso
    result.forEach((l, idx) => {
      const nextTime = (idx < result.length - 1) ? result[idx + 1].time : (l.time + 3.5);
      l.words = distributeWordsForLine(l.text, l.time, nextTime);
    });

    return result;
  }

  /* =========================================================================
     8.5. MOTOR FONÉTICO Y DE FRASES DE AURAMUSIC (PORT COMPLETO)
     ========================================================================= */

  const attachedWords = new Set([
    'a', 'al', 'de', 'del', 'el', 'la', 'los', 'las', 'un', 'una', 'en', 'con', 'que',
    'mi', 'tu', 'su', 'me', 'te', 'se', 'nos', 'y', 'o', 'the', 'a', 'an', 'of', 'to',
    'and', 'or', 'my', 'your', 'in', 'on', 'at'
  ]);
  const clauseStarters = /^(pero|aunque|porque|cuando|mientras|entonces|but|although|because|when|while|then|and|y)$/iu;

  function tokenize(text) {
    const value = String(text || '').trim();
    if (!value) return [];
    if (!/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Thai}]/u.test(value)) {
      return value.match(/\S+\s*/gu) || [];
    }
    try {
      const result = [];
      let pending = '';
      for (const part of new Intl.Segmenter(undefined, { granularity: 'word' }).segment(value)) {
        if (part.isWordLike) {
          result.push(pending + part.segment);
          pending = '';
        } else if (!result.length) {
          pending += part.segment;
        } else {
          result[result.length - 1] += part.segment;
        }
      }
      if (pending) result.push(pending);
      return result;
    } catch (_) {
      return value.match(/\S+\s*/gu) || [];
    }
  }

  function calculateSyllableWeight(token) {
    const clean = String(token || '').normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}]/gu, '');
    if (!clean) return 0.6;
    if (/[^\p{Script=Latin}]/u.test(clean)) return Math.max(1, Array.from(clean).length);
    const vowels = clean.normalize('NFD').replace(/\p{M}/gu, '').match(/[aeiouyáéíóú]+/gi);
    let syllables = Math.max(1, vowels ? vowels.length : clean.length / 3);
    if (/[aeoáéíóú][íú]|[íú][aeoáéíóú]/iu.test(token)) syllables++;
    return Math.max(0.5, syllables * (attachedWords.has(clean) ? 0.65 : 1.0));
  }

  function profilePacing(lines) {
    return (lines || []).map((line, idx) => {
      let span = (lines[idx + 1] ? lines[idx + 1].time : (line.time + 3.5)) - line.time;
      let occupied = 0.88;
      const precise = Array.isArray(line.words) ? line.words.filter(w => !w.estimated && Number.isFinite(w.start)) : [];
      if (precise.length > 1) {
        const first = precise[0].start;
        const last = precise[precise.length - 1];
        const vocalSpan = (last.end > last.start ? last.end : last.start + 0.4) - first;
        if (vocalSpan > 0.1) { span = vocalSpan; occupied = 1.0; }
      }
      const units = tokenize(line.text).reduce((sum, tok) => sum + calculateSyllableWeight(tok), 0);
      return (units > 1 && span > 0.2 && span < 12) ? Math.max(0.1, Math.min(0.7, (span * occupied) / units)) : NaN;
    });
  }

  function estimateWordsForLine(text, startTime, endTime, pace = 0.35) {
    const tokens = tokenize(text);
    if (!tokens.length) return [];
    const weights = tokens.map(calculateSyllableWeight);
    const units = weights.reduce((s, w) => s + w, 0);
    const available = (endTime > startTime) ? (endTime - startTime) : (units * pace + 0.4);
    const duration = Math.min(available * 0.94, Math.max(0.1, units * pace));
    const pauses = tokens.map((token, idx) => (idx < tokens.length - 1 && /[,;:.!?¿¡][»”"'）)]*\s*$/u.test(token) ? 0.35 : 0));
    const totalUnits = units + pauses.reduce((s, p) => s + p, 0);

    let time = startTime;
    return tokens.map((tok, idx) => {
      const wStart = Math.round(time * 100) / 100;
      const wEnd = Math.round((wStart + (duration * weights[idx]) / totalUnits) * 100) / 100;
      time = wEnd + (duration * pauses[idx]) / totalUnits;
      return {
        word: tok.trim(),
        start: wStart,
        end: Math.max(wStart + 0.08, wEnd),
        estimated: true
      };
    });
  }

  function splitLinePhrases(tokens, words) {
    if (!words || !words.length) return [];
    if (words.length <= 4) {
      return [{
        startIdx: 0,
        endIdx: words.length,
        startTime: words[0].start,
        endTime: words[words.length - 1].end,
        words: words
      }];
    }
    const rests = words.slice(0, -1).map((w, idx) => Math.max(0, words[idx + 1].start - w.end));
    const pauseThreshold = 0.3;
    const phrases = [];
    let start = 0;
    while (start < tokens.length) {
      let limit = Math.min(tokens.length, start + 7);
      let best = limit;
      for (let end = start + 1; end <= limit; end++) {
        const tok = tokens[end - 1].trim();
        const next = (tokens[end] || '').trim().toLowerCase();
        const isSentence = /[.!?¿¡]/.test(tok);
        const isClause = /[,;:]/.test(tok);
        const rest = rests[end - 1] || 0;
        if (end < tokens.length && (isSentence || rest >= pauseThreshold)) { best = end; break; }
        if (end < tokens.length && isClause && end - start >= 2) { best = end; break; }
        if (clauseStarters.test(next) && end - start >= 3) { best = end; break; }
      }
      const sliceWords = words.slice(start, best);
      if (sliceWords.length) {
        phrases.push({
          startIdx: start,
          endIdx: best,
          startTime: sliceWords[0].start,
          endTime: sliceWords[sliceWords.length - 1].end,
          words: sliceWords
        });
      }
      start = best;
    }
    return phrases;
  }

  function distributeWordsForLine(text, startTime, endTime) {
    return estimateWordsForLine(text, startTime, endTime, state.syllablePace || 0.35);
  }

  /* =========================================================================
     9. PERSISTENCE & EXPORT TO GITHUB
     ========================================================================= */

  async function saveCurrentTrackToDatabase() {
    if (!state.currentTrack) return;

    const payload = {
      found: true,
      track: state.currentTrack
    };

    let savedLocally = false;

    // 1. Intentar guardar en servidor Node.js si está disponible
    try {
      const res = await fetch('/api/lyrics/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        alert(`✨ Canción guardada con éxito en el servidor local: ${data.fileName}`);
        savedLocally = true;
        loadLibraryTracks();
        return;
      }
    } catch (_) {}

    // 2. Si es GitHub Pages o no hay servidor local, guardar en localStorage del navegador
    try {
      const cleanA = sanitize(state.currentTrack.artist || 'unknown');
      const cleanT = sanitize(state.currentTrack.title || 'untitled');
      const filename = `${cleanA}_${cleanT}.json`;

      const trackMeta = {
        fileName: filename,
        title: state.currentTrack.title,
        artist: state.currentTrack.artist,
        videoId: state.currentTrack.videoId,
        linesCount: state.currentTrack.lines ? state.currentTrack.lines.length : 0,
        hasBratEffects: !!(state.currentTrack.effects && state.currentTrack.effects.theme === 'brat'),
        raw: payload
      };

      const localSaved = JSON.parse(localStorage.getItem('auralyrics_cloud_tracks') || '[]');
      const existingIdx = localSaved.findIndex(s => s.title === trackMeta.title && s.artist === trackMeta.artist);
      if (existingIdx >= 0) {
        localSaved[existingIdx] = trackMeta;
      } else {
        localSaved.unshift(trackMeta);
      }
      localStorage.setItem('auralyrics_cloud_tracks', JSON.stringify(localSaved));

      alert(`✨ Guardado en tu biblioteca Cloud (Navegador). Para publicarla en GitHub, haz clic en "Exportar" y descarga el archivo JSON.`);
      loadLibraryTracks();
    } catch (err) {
      alert('Error al guardar en el navegador: ' + err.message);
    }
  }

  function openExportModal() {
    const modal = document.getElementById('modal-export');
    const preview = document.getElementById('export-json-code-preview');
    if (!modal || !state.currentTrack) return;

    const payload = {
      found: true,
      track: state.currentTrack
    };

    if (preview) {
      preview.textContent = JSON.stringify(payload, null, 2);
    }

    modal.style.display = 'flex';
  }

  function downloadJsonFile() {
    if (!state.currentTrack) return;
    const payload = { found: true, track: state.currentTrack };
    const jsonStr = JSON.stringify(payload, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    const cleanA = sanitize(state.currentTrack.artist || 'artist');
    const cleanT = sanitize(state.currentTrack.title || 'song');
    a.href = url;
    a.download = `${cleanA}_${cleanT}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }

  function downloadLrcFile() {
    if (!state.currentTrack || !state.currentTrack.lines) return;
    let lrc = `[ti:${state.currentTrack.title}]\n[ar:${state.currentTrack.artist}]\n`;
    state.currentTrack.lines.forEach(l => {
      lrc += `[${formatTime(l.time)}]${l.text}\n`;
    });
    const blob = new Blob([lrc], { type: 'text/plain' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${sanitize(state.currentTrack.title)}.lrc`;
    a.click();
    URL.revokeObjectURL(url);
  }

  /* =========================================================================
     10. AUDIO TRANSPORT & HELPER UTILITIES
     ========================================================================= */

  function play() {
    if (state.ytPlayer && typeof state.ytPlayer.playVideo === 'function') {
      state.ytPlayer.playVideo();
    }
  }

  function pause() {
    if (state.ytPlayer && typeof state.ytPlayer.pauseVideo === 'function') {
      state.ytPlayer.pauseVideo();
    }
  }

  function togglePlayPause() {
    if (state.isPlaying) {
      pause();
    } else {
      play();
    }
  }

  function seekTo(seconds) {
    if (state.ytPlayer && typeof state.ytPlayer.seekTo === 'function') {
      state.ytPlayer.seekTo(seconds, true);
    }
  }

  function updatePlayPauseIcons(isPlaying) {
    const playIcon = document.getElementById('dock-icon-play');
    const pauseIcon = document.getElementById('dock-icon-pause');
    if (playIcon && pauseIcon) {
      playIcon.style.display = isPlaying ? 'none' : 'block';
      pauseIcon.style.display = isPlaying ? 'block' : 'none';
    }
  }

  function updateTotalTimeDisplay(seconds) {
    const el = document.getElementById('dock-time-total');
    if (el) el.textContent = formatTime(seconds);
  }

  function formatTime(secs) {
    if (isNaN(secs) || secs < 0) return '00:00.00';
    const m = Math.floor(secs / 60);
    const s = Math.floor(secs % 60);
    const ms = Math.floor((secs % 1) * 100);
    const mStr = m < 10 ? '0' + m : m;
    const sStr = s < 10 ? '0' + s : s;
    const msStr = ms < 10 ? '0' + ms : ms;
    return `${mStr}:${sStr}.${msStr}`;
  }

  function sanitize(str) {
    return String(str || '').toLowerCase().replace(/[^a-z0-9]/g, '_').replace(/_+/g, '_');
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text || '';
    return div.innerHTML;
  }

  /* =========================================================================
     9.5. INSTANT YOUTUBE OEMBED RESOLVER & AUTO-LRCLIB
     ========================================================================= */

  async function resolveYouTubeMetadata(val) {
    if (!val) return null;
    let videoId = val.trim();
    const match = val.match(/(?:v=|v\/|embed\/|youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
    if (match) videoId = match[1];

    if (!videoId || videoId.length !== 11) return null;

    const banner = document.getElementById('yt-auto-meta-banner');
    const bannerText = document.getElementById('meta-detect-text');
    const titleInput = document.getElementById('input-add-title');
    const artistInput = document.getElementById('input-add-artist');
    const previewImg = document.getElementById('add-cover-preview-img');
    const previewTitle = document.getElementById('add-preview-title');
    const previewArtist = document.getElementById('add-preview-artist');
    const ytInput = document.getElementById('input-add-yt');

    if (ytInput && val.includes('youtube.com') && !val.includes('music.youtube.com')) {
      ytInput.value = `https://music.youtube.com/watch?v=${videoId}`;
    }

    if (banner) {
      banner.style.display = 'flex';
      if (bannerText) bannerText.textContent = `⚡ Detectando canción desde YouTube... (ID: ${videoId})`;
    }
    if (previewImg) previewImg.src = `https://img.youtube.com/vi/${videoId}/hqdefault.jpg`;

    let meta = null;
    try {
      const res = await fetch(`https://noembed.com/embed?url=https://www.youtube.com/watch?v=${videoId}`);
      if (res.ok) {
        const d = await res.json();
        if (d && d.title && !d.error) meta = d;
      }
    } catch (_) {}

    if (!meta) {
      try {
        const res2 = await fetch(`https://www.youtube.com/oembed?url=https://www.youtube.com/watch?v=${videoId}&format=json`);
        if (res2.ok) {
          const d2 = await res2.json();
          if (d2 && d2.title) meta = d2;
        }
      } catch (_) {}
    }

    let detectedTitle = '';
    let detectedArtist = '';

    if (meta) {
      let rawTitle = meta.title || '';
      let rawAuthor = meta.author_name || '';

      rawAuthor = rawAuthor
        .replace(/\s*-\s*Topic/i, '')
        .replace(/VEVO$/i, '')
        .trim();

      let cleanTitle = rawTitle
        .replace(/\s*[\(\[](?:official\s*(?:music\s*)?video|video\s*oficial|visualizer|lyric\s*video|audio\s*(?:oficial)?|lyrics?|remix|hd|4k|videoclip|letra|en\s*vivo|live)[\)\]]/gi, '')
        .replace(/\s*-\s*(?:video\s*oficial|official\s*(?:music\s*)?video|visualizer|audio\s*oficial|audio|videoclip|letra)/gi, '')
        .replace(/["'“”«»]/g, '')
        .trim();

      if (cleanTitle.includes(' - ')) {
        const parts = cleanTitle.split(' - ');
        detectedArtist = parts[0].trim();
        detectedTitle = parts.slice(1).join(' - ').trim();
      } else {
        detectedTitle = cleanTitle;
        detectedArtist = rawAuthor;
      }
    } else {
      detectedTitle = titleInput?.value || 'Nueva Canción';
      detectedArtist = artistInput?.value || '';
    }

    if (titleInput && detectedTitle) titleInput.value = detectedTitle;
    if (artistInput && detectedArtist) artistInput.value = detectedArtist;
    if (previewTitle && detectedTitle) previewTitle.textContent = detectedTitle;
    if (previewArtist && detectedArtist) previewArtist.textContent = detectedArtist || 'YouTube Music';

    // Auto-buscar letra en LRCLIB al instante
    if (bannerText) {
      bannerText.textContent = `✨ "${detectedTitle}" (${detectedArtist || 'Artista'}) detectada. ⏳ Buscando letra en LRCLIB...`;
    }

    const lrclibRes = await fetchLrclibLyrics(detectedTitle, detectedArtist, 180);
    if (lrclibRes && lrclibRes.lines && lrclibRes.lines.length > 0) {
      state.pendingAutoLyrics = lrclibRes.lines;
      if (bannerText) {
        bannerText.innerHTML = `✅ <strong>¡Letra ${lrclibRes.isSynced ? 'sincronizada' : 'texto plano'} lista!</strong> (${lrclibRes.lines.length} versos encontrados)`;
      }
      const feedback = document.getElementById('modal-lrclib-feedback');
      if (feedback) {
        feedback.style.display = 'block';
        feedback.style.color = '#aaff00';
        feedback.innerHTML = `✅ Letra cargada automáticamente (${lrclibRes.lines.length} versos) desde LRCLIB.`;
      }
    } else {
      if (bannerText) {
        bannerText.textContent = `⚠️ Canción detectada: "${detectedTitle}". No se halló letra en LRCLIB (puedes pegarla raw).`;
      }
    }

    return { videoId, title: detectedTitle, artist: detectedArtist, lyrics: state.pendingAutoLyrics };
  }

  /* =========================================================================
     10. EVENT LISTENERS
     ========================================================================= */

  function initEventListeners() {
    // Brand header returns to Library
    document.getElementById('btn-brand-home')?.addEventListener('click', () => switchViewMode('library'));
    document.getElementById('btn-back-to-library')?.addEventListener('click', () => switchViewMode('library'));

    // Header "+ Nueva Canción"
    const modalAdd = document.getElementById('modal-add-song');
    document.getElementById('btn-header-new-song')?.addEventListener('click', () => {
      if (modalAdd) modalAdd.style.display = 'flex';
    });
    document.getElementById('btn-close-modal-add')?.addEventListener('click', () => {
      if (modalAdd) modalAdd.style.display = 'none';
    });
    document.getElementById('btn-cancel-add-song')?.addEventListener('click', () => {
      if (modalAdd) modalAdd.style.display = 'none';
    });

    // Stepper header navigation buttons
    document.querySelectorAll('.pipeline-steps .step-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const stepNum = parseInt(btn.dataset.step, 10);
        switchStep(stepNum);
      });
    });

    // Step footer navigation buttons
    document.getElementById('btn-goto-step-2')?.addEventListener('click', () => switchStep(2));
    document.getElementById('btn-back-to-step-1')?.addEventListener('click', () => switchStep(1));
    document.getElementById('btn-goto-step-3')?.addEventListener('click', () => switchStep(3));
    document.getElementById('btn-back-to-step-2')?.addEventListener('click', () => switchStep(2));

    // Export Modal open/close
    const modalExport = document.getElementById('modal-export-data');
    document.getElementById('btn-header-export')?.addEventListener('click', openExportModal);
    document.getElementById('btn-step3-export')?.addEventListener('click', openExportModal);
    document.getElementById('btn-close-modal-export')?.addEventListener('click', () => {
      if (modalExport) modalExport.style.display = 'none';
    });
    document.getElementById('btn-modal-export-close-btn')?.addEventListener('click', () => {
      if (modalExport) modalExport.style.display = 'none';
    });

    // Export Modal buttons
    document.getElementById('btn-export-save-db')?.addEventListener('click', saveCurrentTrackToDatabase);
    document.getElementById('btn-export-download-json')?.addEventListener('click', downloadJsonFile);
    document.getElementById('btn-export-download-lrc')?.addEventListener('click', downloadLrcFile);
    document.getElementById('btn-export-copy-clipboard')?.addEventListener('click', () => {
      if (state.currentTrack) {
        navigator.clipboard.writeText(JSON.stringify({ found: true, track: state.currentTrack }, null, 2));
        alert('Copiado al portapapeles');
      }
    });

    // Instant YouTube URL Detection in Modal
    const ytInput = document.getElementById('input-add-yt');
    const titleInput = document.getElementById('input-add-title');
    const artistInput = document.getElementById('input-add-artist');

    const handleYtInput = () => {
      const val = (ytInput?.value || '').trim();
      if (state.debounceDetectTimer) clearTimeout(state.debounceDetectTimer);

      state.debounceDetectTimer = setTimeout(() => {
        resolveYouTubeMetadata(val);
      }, 350);
    };

    ytInput?.addEventListener('input', handleYtInput);
    ytInput?.addEventListener('paste', () => setTimeout(handleYtInput, 50));
    document.getElementById('btn-detect-yt')?.addEventListener('click', () => {
      resolveYouTubeMetadata(ytInput?.value || '');
    });

    // Modal: Probar búsqueda en LRCLIB al instante
    document.getElementById('btn-modal-test-lrclib')?.addEventListener('click', async () => {
      const title = (titleInput?.value || '').trim();
      const artist = (artistInput?.value || '').trim();
      const feedback = document.getElementById('modal-lrclib-feedback');
      if (!feedback) return;

      if (!title) {
        feedback.style.display = 'block';
        feedback.style.color = '#ff4d4d';
        feedback.textContent = '⚠️ Ingresa al menos el título de la canción para buscar en LRCLIB.';
        return;
      }

      feedback.style.display = 'block';
      feedback.style.color = '#cbd5e1';
      feedback.textContent = '⏳ Buscando letra en LRCLIB...';

      const res = await fetchLrclibLyrics(title, artist, 180);
      if (res && res.lines && res.lines.length > 0) {
        state.pendingAutoLyrics = res.lines;
        feedback.style.color = '#aaff00';
        feedback.innerHTML = `✅ ¡Letra ${res.isSynced ? 'sincronizada' : 'en texto plano'} encontrada! (<strong>${res.lines.length} versos</strong>) — <em>${escapeHtml(res.foundTrackName)}</em> de <em>${escapeHtml(res.foundArtistName || 'Artista')}</em>`;
        if (res.foundTrackName && (!titleInput.value || titleInput.value.toLowerCase() === 'nueva canción')) {
          titleInput.value = res.foundTrackName;
        }
        if (res.foundArtistName && (!artistInput.value || artistInput.value.toLowerCase() === 'artista')) {
          artistInput.value = res.foundArtistName;
        }
      } else {
        feedback.style.color = '#ffbe0b';
        feedback.textContent = '⚠️ No se encontró en LRCLIB. Prueba ajustando el nombre o artista exactos.';
      }
    });

    // Create Song from Modal
    document.getElementById('btn-submit-create-song')?.addEventListener('click', async () => {
      const btn = document.getElementById('btn-submit-create-song');
      const val = (ytInput?.value || '').trim();
      let videoId = 'WJW-VvmRKsE';
      const match = val.match(/(?:v=|v\/|embed\/|youtu\.be\/|watch\?v=)([a-zA-Z0-9_-]{11})/);
      if (match) videoId = match[1];
      else if (val.length === 11) videoId = val;

      let title = (titleInput?.value || '').trim() || 'Nueva Canción';
      let artist = (artistInput?.value || '').trim() || '';
      const useLrclib = document.getElementById('chk-auto-lrclib')?.checked;

      let fetchedLines = [];
      if (useLrclib) {
        if (state.pendingAutoLyrics && state.pendingAutoLyrics.length > 0) {
          fetchedLines = state.pendingAutoLyrics;
        } else {
          if (btn) {
            btn.disabled = true;
            btn.innerHTML = `<span>⏳ Consultando LRCLIB...</span>`;
          }
          const lrclibRes = await fetchLrclibLyrics(title, artist, 180);
          if (lrclibRes && lrclibRes.lines && lrclibRes.lines.length > 0) {
            fetchedLines = lrclibRes.lines;
            if (lrclibRes.foundTrackName && (!titleInput.value || titleInput.value.toLowerCase() === 'nueva canción')) {
              title = lrclibRes.foundTrackName;
            }
            if (lrclibRes.foundArtistName && (!artistInput.value || artistInput.value.toLowerCase() === 'artista')) {
              artist = lrclibRes.foundArtistName;
            }
          }
          if (btn) {
            btn.disabled = false;
            btn.innerHTML = `<span>Crear y Abrir en Editor</span>`;
          }
        }
      }

      const newTrack = {
        title,
        artist,
        videoId,
        duration: 180,
        lines: fetchedLines,
        humanReviewed: false,
        effects: {
          theme: 'brat',
          bassBeats: [],
          palette: 'lime',
          blur: 6,
          scale: 1.5,
          shake: true,
          keyframes: [
            { time: 0, palette: 'lime', color: '#8acf00', bgMode: 'solid', layout: 'impact', variant: 'heavy', blur: 6, scale: 1.5, shake: true },
            { time: 24.0, palette: 'purple', color: '#9d4edd', bgMode: 'radial-glow', layout: 'spread', variant: 'lean', blur: 8, scale: 1.4, shake: true },
            { time: 55.0, palette: 'cyan', color: '#00f5d4', bgMode: 'brat-matrix', layout: 'scribble', variant: 'wide', blur: 10, scale: 1.8, shake: true }
          ]
        }
      };

      if (modalAdd) modalAdd.style.display = 'none';
      state.pendingAutoLyrics = null;
      state.libraryTracks.unshift(newTrack);
      openTrackInEditor(newTrack, 1);
    });

    // YouTube Player Overlay (intercepta clics para reproducir/pausar localmente, NUNCA abre YouTube estándar)
    document.getElementById('yt-player-overlay')?.addEventListener('click', (e) => {
      e.stopPropagation();
      e.preventDefault();
      togglePlayPause();
    });

    // Transport buttons
    document.getElementById('dock-btn-play-pause')?.addEventListener('click', togglePlayPause);
    document.getElementById('dock-btn-rewind-3')?.addEventListener('click', () => seekTo(state.currentTime - 3));
    document.getElementById('dock-btn-forward-3')?.addEventListener('click', () => seekTo(state.currentTime + 3));

    // Playback rate select
    document.getElementById('dock-playback-rate')?.addEventListener('change', (e) => {
      const rate = parseFloat(e.target.value) || 1.0;
      state.playbackRate = rate;
      if (state.ytPlayer && typeof state.ytPlayer.setPlaybackRate === 'function') {
        state.ytPlayer.setPlaybackRate(rate);
      }
    });

    // Seeker slider scrub
    document.getElementById('dock-seeker-slider')?.addEventListener('input', (e) => {
      const pct = parseFloat(e.target.value) || 0;
      const targetTime = (pct / 100) * state.duration;
      seekTo(targetTime);
    });

    // Big Stamp Action Buttons
    document.getElementById('btn-tap-verse-stamp')?.addEventListener('click', stampCurrentLiveVerse);
    document.getElementById('btn-tap-beat-stamp')?.addEventListener('click', addBassBeatStamp);

    // Global Keyboard Shortcuts (Space for Verse Stamp, B for Beat, K for Keyframe, Left/Right for Seek)
    window.addEventListener('keydown', (e) => {
      if (e.target.tagName === 'INPUT' || e.target.tagName === 'TEXTAREA') return;

      if (e.code === 'Space') {
        e.preventDefault();
        if (state.currentView === 'editor' && state.activeStep === 1) {
          stampCurrentLiveVerse();
        } else {
          togglePlayPause();
        }
      } else if (e.code === 'KeyB') {
        e.preventDefault();
        addBassBeatStamp();
      } else if (e.code === 'KeyK') {
        e.preventDefault();
        if (state.activeStep === 3) {
          addKeyframeAtCurrentTime();
        }
      } else if (e.code === 'ArrowLeft') {
        e.preventDefault();
        seekTo(state.currentTime - 3);
      } else if (e.code === 'ArrowRight') {
        e.preventDefault();
        seekTo(state.currentTime + 3);
      }
    });

    // Step 1 LRCLIB fetch button
    document.getElementById('btn-step1-fetch-lrclib')?.addEventListener('click', async () => {
      if (!state.currentTrack) return;
      const btn = document.getElementById('btn-step1-fetch-lrclib');
      if (btn) btn.innerHTML = `<span>Buscando en LRCLIB...</span>`;

      const lrclibRes = await fetchLrclibLyrics(state.currentTrack.title, state.currentTrack.artist, state.duration);
      if (lrclibRes && lrclibRes.lines && lrclibRes.lines.length > 0) {
        state.currentTrack.lines = lrclibRes.lines;
        renderStep1Verses();
        alert(`✨ Se importaron ${lrclibRes.lines.length} versos (${lrclibRes.isSynced ? 'sincronizados' : 'texto plano'}) desde LRCLIB!`);
      } else {
        alert('No se encontraron letras en LRCLIB para esta canción. Puedes pegarlas manualmente en "Pegar Letra Raw".');
      }

      if (btn) btn.innerHTML = `<span class="lrclib-sparkle">✨</span><span>Buscar en LRCLIB</span>`;
    });

    // Step 1 Raw Paste Toggle
    const rawDrawer = document.getElementById('raw-paste-drawer');
    document.getElementById('btn-step1-edit-raw')?.addEventListener('click', () => {
      if (rawDrawer) rawDrawer.style.display = rawDrawer.style.display === 'none' ? 'flex' : 'none';
    });
    document.getElementById('btn-cancel-raw')?.addEventListener('click', () => {
      if (rawDrawer) rawDrawer.style.display = 'none';
    });
    document.getElementById('btn-apply-raw-verses')?.addEventListener('click', () => {
      const text = document.getElementById('raw-paste-textarea')?.value || '';
      if (text.includes('[') && text.includes(']')) {
        state.currentTrack.lines = parseLrcLyrics(text, state.duration);
      } else {
        const rawLines = text.split('\n').map(l => l.trim()).filter(Boolean);
        state.currentTrack.lines = rawLines.map((lineStr, idx) => ({
          time: idx * 3.5,
          text: lineStr,
          type: 'vocal',
          words: distributeWordsForLine(lineStr, idx * 3.5, (idx + 1) * 3.5)
        }));
      }
      renderStep1Verses();
      if (rawDrawer) rawDrawer.style.display = 'none';
    });

    // Step 2 Listeners: Human Review, AuraMusic Engine & Pace Slider
    document.getElementById('btn-toggle-human-review')?.addEventListener('click', toggleHumanReview);
    document.getElementById('btn-reanalyze-auramusic')?.addEventListener('click', reanalyzeWithAuraMusicEngine);

    document.getElementById('slider-syllable-pace')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value) || 0.35;
      state.syllablePace = val;
      const lbl = document.getElementById('lbl-pace-val');
      if (lbl) lbl.textContent = `${val.toFixed(2)}s`;

      if (state.currentTrack && state.currentTrack.lines[state.selectedVerseIndex]) {
        const l = state.currentTrack.lines[state.selectedVerseIndex];
        const nextTime = (state.selectedVerseIndex < state.currentTrack.lines.length - 1)
          ? state.currentTrack.lines[state.selectedVerseIndex + 1].time
          : (l.time + 3.5);
        l.words = estimateWordsForLine(l.text, l.time, nextTime, val);
        renderStep2WordsStage();
      }
    });

    document.getElementById('words-verse-dropdown')?.addEventListener('change', (e) => {
      state.selectedVerseIndex = parseInt(e.target.value, 10);
      renderStep2WordsStage();
    });

    document.getElementById('verse-vocal-type')?.addEventListener('change', (e) => {
      if (state.currentTrack && state.currentTrack.lines[state.selectedVerseIndex]) {
        state.currentTrack.lines[state.selectedVerseIndex].type = e.target.value;
      }
    });

    // Step 3 Video Editor Keyframe Studio Listeners
    document.getElementById('btn-add-keyframe-now')?.addEventListener('click', addKeyframeAtCurrentTime);
    document.getElementById('btn-delete-selected-kf')?.addEventListener('click', deleteSelectedKeyframe);
    document.getElementById('btn-auto-section-keyframes')?.addEventListener('click', autoGenerateSectionKeyframes);

    document.getElementById('btn-kf-nudge-back')?.addEventListener('click', () => {
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) {
        kf.time = Math.max(0, Math.round((kf.time - 0.2) * 100) / 100);
        state.currentTrack.effects.keyframes.sort((a, b) => a.time - b.time);
        renderStep3Effects();
      }
    });

    document.getElementById('btn-kf-nudge-fwd')?.addEventListener('click', () => {
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) {
        kf.time = Math.round((kf.time + 0.2) * 100) / 100;
        state.currentTrack.effects.keyframes.sort((a, b) => a.time - b.time);
        renderStep3Effects();
      }
    });

    document.getElementById('input-kf-time')?.addEventListener('change', (e) => {
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) {
        const parts = e.target.value.split(':');
        let sec = parseFloat(e.target.value);
        if (parts.length === 2) {
          sec = parseInt(parts[0], 10) * 60 + parseFloat(parts[1]);
        }
        if (!isNaN(sec) && sec >= 0) {
          kf.time = Math.round(sec * 100) / 100;
          state.currentTrack.effects.keyframes.sort((a, b) => a.time - b.time);
          renderStep3Effects();
        }
      }
    });

    // Video Editor Color Swatches
    document.querySelectorAll('.ve-color-grid .palette-swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
        if (kf) {
          kf.palette = btn.dataset.palette;
          kf.color = btn.dataset.hex;
          renderStep3Effects();
        }
      });
    });

    // Custom Color Input
    document.getElementById('input-kf-custom-color')?.addEventListener('input', (e) => {
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) {
        kf.color = e.target.value;
        kf.palette = 'custom';
        const hexLbl = document.getElementById('lbl-kf-color-hex');
        if (hexLbl) hexLbl.textContent = e.target.value;
        updateLiveCinemaStageFromKeyframes();
      }
    });

    // Background Mode
    document.getElementById('select-kf-bg-mode')?.addEventListener('change', (e) => {
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) {
        kf.bgMode = e.target.value;
        updateLiveCinemaStageFromKeyframes();
      }
    });

    // Layout Buttons
    document.querySelectorAll('.ve-layout-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
        if (kf) {
          kf.layout = btn.dataset.layout;
          renderStep3Effects();
        }
      });
    });

    // Variant Buttons
    document.querySelectorAll('.ve-var-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
        if (kf) {
          kf.variant = btn.dataset.variant;
          renderStep3Effects();
        }
      });
    });

    // Interactive Timeline Viewport Click to Seek
    const tlViewport = document.getElementById('ve-timeline-viewport');
    tlViewport?.addEventListener('click', (e) => {
      const rect = tlViewport.getBoundingClientRect();
      const clickX = e.clientX - rect.left - 85; // 85px is track label width
      const laneWidth = rect.width - 85;
      if (clickX >= 0 && laneWidth > 0) {
        const pct = clickX / laneWidth;
        const targetTime = pct * (state.duration || 133);
        seekTo(targetTime);
      }
    });

    // Step 3 Sliders
    document.getElementById('step3-slider-blur')?.addEventListener('input', (e) => {
      const val = parseInt(e.target.value, 10);
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) kf.blur = val;
      const lbl = document.getElementById('lbl-blur-val');
      if (lbl) lbl.textContent = `${val}px`;
      updateLiveCinemaStageFromKeyframes();
    });

    document.getElementById('step3-slider-scale')?.addEventListener('input', (e) => {
      const val = parseFloat(e.target.value);
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) kf.scale = val;
      const lbl = document.getElementById('lbl-scale-val');
      if (lbl) lbl.textContent = `${val}x`;
      updateLiveCinemaStageFromKeyframes();
    });

    document.getElementById('step3-chk-shake')?.addEventListener('change', (e) => {
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) kf.shake = e.target.checked;
      if (state.currentTrack) state.currentTrack.effects.shake = e.target.checked;
    });

    document.getElementById('btn-step3-clear-beats')?.addEventListener('click', () => {
      if (state.currentTrack) {
        state.currentTrack.effects.bassBeats = [];
        renderStep3Effects();
      }
    });
  }
})();
