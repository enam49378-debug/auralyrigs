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

  const BratEffects = window.AuraLyricsEffects;
  const getOfficialBratDefaultKeyframes = () => BratEffects.keyframes([]);
  let openTrackGeneration = 0;
  let previewBeatTimer = null;
  let previewLayoutSignature = '';

  function normalizeTrackEffects() {
    if (!state.currentTrack) return;
    const selected = state.currentTrack.effects?.keyframes?.[state.selectedKeyframeIndex];
    state.currentTrack.effects = BratEffects.normalize(state.currentTrack.effects,state.currentTrack.duration);
    if (selected) {
      const index = state.currentTrack.effects.keyframes.findIndex(kf => kf.time === selected.time);
      if (index >= 0) state.selectedKeyframeIndex = index;
    }
    state.selectedKeyframeIndex = Math.min(state.selectedKeyframeIndex, state.currentTrack.effects.keyframes.length-1);
  }

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
    createYouTubePlayer(state.currentTrack?.videoId || 'WJW-VvmRKsE');
  };

  function createYouTubePlayer(videoId) {
    if (state.ytPlayer && typeof state.ytPlayer.destroy === 'function') {
      try { state.ytPlayer.destroy(); } catch (_) {}
    }

    state.isYtReady = false;
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
    if(event.target && event.target!==state.ytPlayer)return;
    state.isYtReady = true;
    try {
      const dur = state.ytPlayer.getDuration();
      if (dur && dur > 0) {
        state.duration = dur;
        updateTotalTimeDisplay(dur);
        if (state.currentTrack) state.currentTrack.duration = dur;
      }
    } catch (_) {}
    console.log('🎬 AuraLyrics: Reproductor YouTube acoplado con éxito');
  }

  function onPlayerStateChange(event) {
    if (event.target && event.target !== state.ytPlayer) return;
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

  function readLocalDrafts() {
    try { const saved=JSON.parse(localStorage.getItem('auralyrics_cloud_tracks') || '[]'); return Array.isArray(saved)?saved:[]; }
    catch (_) { return []; }
  }
  function sameTrack(a,b) {
    return a.videoId && b.videoId ? a.videoId===b.videoId : a.title===b.title && a.artist===b.artist;
  }

  function isCloudMode() {
    return !['localhost','127.0.0.1','[::1]'].includes(window.location.hostname);
  }

  function updateServerStatusBadge() {
    const statusPill = document.getElementById('server-status-pill');
    const statusText = document.getElementById('server-status-text');
    if (!statusText) return;

    if (isCloudMode()) {
      statusText.textContent = 'AuraLyrics Cloud (GitHub Pages)';
      if (statusPill) statusPill.style.borderColor = 'rgba(138, 206, 0, 0.4)';
    } else {
      statusText.textContent = 'Servidor local · '+window.location.host;
    }
  }

  async function loadLibraryTracks() {
    updateServerStatusBadge();
    let loadedTracks = [];

    // GitHub Pages is static; only a local server provides this API.
    try {
      if(isCloudMode())throw new Error('Static hosting');
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

    // Local drafts override the published version; old visual fields never erase a song.
    for (const draft of readLocalDrafts()) {
      if (!draft?.raw?.track) continue;
      const index = loadedTracks.findIndex(track => sameTrack(track,draft));
      if (index >= 0) loadedTracks[index] = draft;
      else loadedTracks.unshift(draft);
    }

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
    const generation = ++openTrackGeneration;
    const draft = readLocalDrafts().find(item => sameTrack(item,trackMeta));
    let fullTrack = draft?.raw?.track || trackMeta.raw?.track || null;

    // Preserve newer local drafts before consulting the published version.
    try {
      if(fullTrack || isCloudMode())throw new Error('Use draft or static catalogue');
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
          effects: trackMeta.effects || { theme: 'brat', bassBeats: [], palette: 'lime', kineticSpeed: 1.15 }
        };
      }
    }

    if (generation !== openTrackGeneration) return;
    pause(); stopSyncLoop(); clearPreviewBeat();
    state.currentTrack = JSON.parse(JSON.stringify(fullTrack));
    state.currentTrack.lines = Array.isArray(state.currentTrack.lines) ? state.currentTrack.lines : [];
    state.duration = Number(state.currentTrack.duration)>0 ? Number(state.currentTrack.duration) : Math.max(10,...state.currentTrack.lines.map(line=>Number(line.time)+4));
    state.currentTime = 0; state.selectedVerseIndex = 0; state.selectedKeyframeIndex = 0;
    state.lastActiveVerseIdx = -1; state.lastActiveWordIdx = -1; state.activeBeatIndex = -1;
    resetBratStage(); lastBeatCheckTime = -1; bratLastRenderTime = -1; previewLayoutSignature = '';
    normalizeTrackEffects(); updateTotalTimeDisplay(state.duration); updateDockProgress(0);

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
      if (window.YT?.Player) createYouTubePlayer(defVid);
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

    // Una ficha sin letra (solo efectos) trae sus versos de LRCLIB al abrirse.
    if (!state.currentTrack.lines.length) autoImportMissingLyrics(generation);
  }

  async function autoImportMissingLyrics(generation) {
    const track = state.currentTrack;
    if (!track?.title) return;
    try {
      const result = await fetchLrclibLyrics(track.title, track.artist, state.duration);
      if (generation !== openTrackGeneration || state.currentTrack !== track || track.lines.length) return;
      if (!result?.lines?.length) return;
      if (track.timing && window.AuraMusic?.PublishedTiming) {
        // Ficha pública: la letra llega de LRCLIB y los tiempos revisados se aplican a las líneas que coinciden.
        const merged = window.AuraMusic.PublishedTiming.merge(result.lines, track.timing);
        track.lines = merged.lines.map(line => line.isPersonalServer && Array.isArray(line.words)
          ? { ...line, type: line.type || 'vocal', words: line.words.map(word => ({ word: word.text, start: word.time, end: word.end, estimated: false })) }
          : line);
      } else {
        track.lines = result.lines;
      }
      track.lines.forEach((line, idx) => {
        if (!Array.isArray(line.words) || !line.words.length) {
          const nextTime = idx < track.lines.length - 1 ? track.lines[idx + 1].time : line.time + 3.5;
          line.words = estimateWordsForLine(line.text, line.time, nextTime, state.syllablePace || 0.35);
        }
      });
      renderStep1Verses();
      renderStep2VerseDropdown();
      renderStep2WordsStage();
      renderStep3Effects();
      resetBratStage();
    } catch (_) {
      // Sin conexión o sin resultados: el usuario aún puede importar o pegar la letra a mano.
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
      ++openTrackGeneration; pause(); stopSyncLoop(); clearPreviewBeat(); setPreviewExpanded(false);
      if (libView) libView.style.display = 'flex';
      if (editView) editView.style.display = 'none';
      loadLibraryTracks(); // refresh list
    }
  }

  function switchStep(stepNum) {
    state.activeStep = stepNum;
    if (stepNum !== 3) setPreviewExpanded(false);

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

  /* =========================================================================
     Paso 2: línea de tiempo de palabras con auto-ajuste
     Arrastra una palabra para moverla, sus bordes para cambiar duración. Según la
     política elegida, las vecinas se empujan solas para no solaparse.
     ========================================================================= */

  const MIN_WORD = 0.05;
  const MIN_GAP = 0.02;
  const step2 = { selected: 0, pps: 150, policy: 'push', undo: [], drag: null, previewTimer: null, lastCurrent: -1, t0: 0 };
  const round2 = value => Math.round(value * 100) / 100;
  const clampNumber = (value, min, max) => Math.min(max, Math.max(min, value));

  function step2Line() {
    return state.currentTrack?.lines?.[state.selectedVerseIndex] || null;
  }

  function ensureLineWords(line, index) {
    if (Array.isArray(line.words) && line.words.length) return;
    const lines = state.currentTrack.lines;
    const nextTime = index < lines.length - 1 ? lines[index + 1].time : line.time + 3.5;
    line.words = estimateWordsForLine(line.text, line.time, nextTime, state.syllablePace || 0.35);
  }

  function step2Bounds(index) {
    const prev = state.currentTrack.lines[index - 1];
    return { min: prev ? prev.time + MIN_WORD : 0 };
  }

  function step2PushUndo() {
    const line = step2Line();
    if (!line) return;
    step2.undo.push({ index: state.selectedVerseIndex, time: line.time, words: JSON.parse(JSON.stringify(line.words)) });
    if (step2.undo.length > 80) step2.undo.shift();
    updateStep2UndoButton();
  }

  function updateStep2UndoButton() {
    const button = document.getElementById('w2-undo');
    if (button) button.disabled = !step2.undo.length;
  }

  function step2Undo() {
    const snapshot = step2.undo.pop();
    if (!snapshot) return;
    const line = state.currentTrack?.lines?.[snapshot.index];
    if (!line) return;
    line.time = snapshot.time;
    line.words = snapshot.words;
    state.selectedVerseIndex = snapshot.index;
    const dropdown = document.getElementById('words-verse-dropdown');
    if (dropdown) dropdown.value = String(snapshot.index);
    renderStep2WordsStage();
  }

  // Calcula la nueva posición de todas las palabras de un verso al editar una (función pura).
  function computeWordEdit(base, index, kind, value, policy, bounds) {
    const words = base.map(item => ({ start: item.start, end: item.end }));
    const target = words[index];
    const duration = target.end - target.start;
    const prevEnd = index > 0 ? words[index - 1].end + MIN_GAP : bounds.min;
    const nextStart = index < words.length - 1 ? words[index + 1].start - MIN_GAP : Infinity;

    if (kind === 'move') {
      let start = target.start + value;
      if (policy === 'solo') start = clampNumber(start, prevEnd, nextStart - duration);
      else start = Math.max(start, bounds.min);
      const delta = start - target.start;
      target.start = start;
      target.end += delta;
      if (policy === 'ripple') for (let k = index + 1; k < words.length; k++) { words[k].start += delta; words[k].end += delta; }
    } else if (kind === 'end') {
      let end = Math.max(target.start + MIN_WORD, value);
      if (policy === 'solo') end = Math.min(end, nextStart);
      const delta = end - target.end;
      target.end = end;
      if (policy === 'ripple') for (let k = index + 1; k < words.length; k++) { words[k].start += delta; words[k].end += delta; }
    } else {
      let start = Math.min(value, target.end - MIN_WORD);
      start = policy === 'solo' ? Math.max(start, prevEnd) : Math.max(start, bounds.min);
      target.start = start;
    }

    if (policy !== 'solo') {
      for (let k = index + 1; k < words.length; k++) {
        const minimum = words[k - 1].end + MIN_GAP;
        if (words[k].start < minimum) { const shift = minimum - words[k].start; words[k].start += shift; words[k].end += shift; }
      }
      for (let k = index - 1; k >= 0; k--) {
        const maximum = words[k + 1].start - MIN_GAP;
        if (words[k].end > maximum) { const shift = words[k].end - maximum; words[k].start -= shift; words[k].end -= shift; }
      }
      if (words[0].start < bounds.min) {
        const shift = bounds.min - words[0].start;
        words.forEach(word => { word.start += shift; word.end += shift; });
      }
    }
    return words;
  }

  function commitWordEdit(line, words) {
    line.words.forEach((word, i) => {
      const start = round2(words[i].start), end = round2(Math.max(words[i].end, words[i].start + MIN_WORD));
      if (Math.abs(start - word.start) > 0.004 || Math.abs(end - word.end) > 0.004) word.estimated = false;
      word.start = start;
      word.end = end;
    });
    line.time = round2(line.words[0].start);
  }

  function editSelectedWord(kind, value) {
    const line = step2Line();
    if (!line) return;
    const base = line.words.map(word => ({ start: word.start, end: word.end }));
    const index = clampNumber(step2.selected, 0, base.length - 1);
    const absolute = kind === 'move' ? value : value;
    commitWordEdit(line, computeWordEdit(base, index, kind, absolute, step2.policy, step2Bounds(state.selectedVerseIndex)));
  }

  function previewStep2Range(start, end) {
    clearTimeout(step2.previewTimer);
    seekTo(Math.max(0, start - 0.15));
    play();
    step2.previewTimer = setTimeout(pause, Math.max(250, (end - start + 0.45) * 1000));
  }

  function selectStep2Verse(index) {
    const lines = state.currentTrack?.lines || [];
    if (index < 0 || index >= lines.length) return;
    state.selectedVerseIndex = index;
    step2.selected = 0;
    const dropdown = document.getElementById('words-verse-dropdown');
    if (dropdown) dropdown.value = String(index);
    renderStep2WordsStage();
    seekTo(Math.max(0, lines[index].time - 0.3));
  }

  function layoutStep2Blocks() {
    const line = step2Line();
    const track = document.getElementById('w2-track');
    if (!line || !track) return;
    const words = line.words;
    const pps = step2.pps;
    track.style.width = Math.max(track.parentElement.clientWidth - 2, (words[words.length - 1].end - step2.t0 + 1.4) * pps) + 'px';
    track.querySelectorAll('.w2-word').forEach(block => {
      const word = words[Number(block.dataset.index)];
      if (!word) return;
      block.style.left = (word.start - step2.t0) * pps + 'px';
      block.style.width = Math.max(10, (word.end - word.start) * pps) + 'px';
      block.classList.toggle('is-estimated', !!word.estimated);
      block.querySelector('.w2-time').textContent = word.start.toFixed(2);
      block.setAttribute('aria-label', `${word.word}, ${word.start.toFixed(2)} a ${word.end.toFixed(2)} segundos`);
    });
    const selected = words[step2.selected];
    const startInput = document.getElementById('w2-start');
    const endInput = document.getElementById('w2-end');
    if (selected && startInput && document.activeElement !== startInput) startInput.value = selected.start.toFixed(2);
    if (selected && endInput && document.activeElement !== endInput) endInput.value = selected.end.toFixed(2);
  }

  function updateStep2Playhead(curT) {
    const playhead = document.getElementById('w2-playhead');
    const line = step2Line();
    if (!playhead || !line?.words?.length) return;
    playhead.style.left = (curT - step2.t0) * step2.pps + 'px';
    let current = -1;
    line.words.forEach((word, i) => { if (curT >= word.start && curT < word.end) current = i; });
    if (current !== step2.lastCurrent) {
      step2.lastCurrent = current;
      document.querySelectorAll('#w2-track .w2-word').forEach(block => block.classList.toggle('is-current', Number(block.dataset.index) === current));
    }
  }

  function selectStep2Word(index, { seek = false } = {}) {
    const line = step2Line();
    if (!line) return;
    step2.selected = clampNumber(index, 0, line.words.length - 1);
    document.querySelectorAll('#w2-track .w2-word').forEach(block => block.classList.toggle('is-selected', Number(block.dataset.index) === step2.selected));
    const word = line.words[step2.selected];
    const label = document.getElementById('w2-selected-label');
    if (label) label.textContent = word.word;
    layoutStep2Blocks();
    if (seek) seekTo(word.start);
  }

  function startStep2Drag(event, block, kind) {
    const line = step2Line();
    if (!line || event.button !== 0) return;
    event.preventDefault();
    const index = Number(block.dataset.index);
    selectStep2Word(index);
    step2PushUndo();
    step2.drag = {
      kind, index, startX: event.clientX, moved: false, pointerId: event.pointerId,
      base: line.words.map(word => ({ start: word.start, end: word.end }))
    };
    block.setPointerCapture?.(event.pointerId);
    block.classList.add('is-dragging');
  }

  function moveStep2Drag(event) {
    const drag = step2.drag;
    const line = step2Line();
    if (!drag || !line || event.pointerId !== drag.pointerId) return;
    const delta = (event.clientX - drag.startX) / step2.pps;
    if (Math.abs(event.clientX - drag.startX) > 2) drag.moved = true;
    const source = drag.base[drag.index];
    const value = drag.kind === 'move' ? delta : drag.kind === 'end' ? source.end + delta : source.start + delta;
    commitWordEdit(line, computeWordEdit(drag.base, drag.index, drag.kind, value, step2.policy, step2Bounds(state.selectedVerseIndex)));
    layoutStep2Blocks();
  }

  function endStep2Drag(event) {
    const drag = step2.drag;
    if (!drag || event.pointerId !== drag.pointerId) return;
    step2.drag = null;
    document.querySelectorAll('#w2-track .w2-word.is-dragging').forEach(block => block.classList.remove('is-dragging'));
    const line = step2Line();
    if (!drag.moved) {
      step2.undo.pop();
      updateStep2UndoButton();
      if (line) seekTo(line.words[drag.index].start);
    } else {
      renderStep2WordsStage();
    }
  }

  function renderStep2WordsStage() {
    const stage = document.getElementById('step2-words-stage');
    if (!stage || !state.currentTrack) return;
    stage.replaceChildren();
    const line = step2Line();
    if (!line) {
      stage.innerHTML = '<div class="w2-empty">Selecciona un verso para editar sus palabras.</div>';
      return;
    }
    ensureLineWords(line, state.selectedVerseIndex);
    if (!line.words.length) {
      stage.innerHTML = '<div class="w2-empty">Este verso no tiene palabras.</div>';
      return;
    }
    step2.selected = clampNumber(step2.selected, 0, line.words.length - 1);
    step2.lastCurrent = -1;
    step2.t0 = Math.max(0, Math.min(line.words[0].start, line.time) - 0.6);

    const total = state.currentTrack.lines.length;
    const wrap = document.createElement('div');
    wrap.className = 'w2-wrap';
    wrap.innerHTML = `
      <div class="w2-toolbar">
        <div class="w2-group">
          <button type="button" class="w2-btn" id="w2-prev" title="Verso anterior" ${state.selectedVerseIndex === 0 ? 'disabled' : ''}>‹</button>
          <span class="w2-verse-count">Verso ${state.selectedVerseIndex + 1} / ${total}</span>
          <button type="button" class="w2-btn" id="w2-next" title="Verso siguiente" ${state.selectedVerseIndex >= total - 1 ? 'disabled' : ''}>›</button>
          <button type="button" class="w2-btn w2-primary" id="w2-play-verse">▶ Escuchar verso</button>
          <button type="button" class="w2-btn" id="w2-undo" title="Deshacer (Ctrl+Z)" disabled>↶ Deshacer</button>
        </div>
        <div class="w2-group" role="radiogroup" aria-label="Qué pasa con las demás palabras">
          <span class="w2-label">Al mover una palabra:</span>
          <button type="button" class="w2-seg" role="radio" data-policy="solo" title="Solo se mueve esta palabra y no puede pisar a las vecinas">Solo esta</button>
          <button type="button" class="w2-seg" role="radio" data-policy="push" title="Las vecinas se apartan solas lo justo para no solaparse">Empujar vecinas</button>
          <button type="button" class="w2-seg" role="radio" data-policy="ripple" title="Todas las palabras siguientes se mueven con ella">Mover siguientes</button>
        </div>
        <div class="w2-group">
          <label class="w2-label" for="w2-zoom">Zoom</label>
          <input type="range" id="w2-zoom" min="60" max="400" step="10" value="${step2.pps}">
        </div>
      </div>
      <div class="w2-scroll" id="w2-scroll">
        <div class="w2-track" id="w2-track">
          <div class="w2-ruler" id="w2-ruler"></div>
          <div class="w2-phrases" id="w2-phrases"></div>
          <div class="w2-words" id="w2-words"></div>
          <div class="w2-playhead" id="w2-playhead"></div>
        </div>
      </div>
      <div class="w2-inspector">
        <div class="w2-selected"><span class="w2-label">Palabra</span><strong id="w2-selected-label"></strong></div>
        <label class="w2-field">Inicio <input type="number" id="w2-start" step="0.01" min="0"></label>
        <label class="w2-field">Fin <input type="number" id="w2-end" step="0.01" min="0"></label>
        <div class="w2-group w2-nudges">
          <button type="button" class="w2-btn" data-nudge="-0.1">−0.1</button>
          <button type="button" class="w2-btn" data-nudge="-0.05">−0.05</button>
          <button type="button" class="w2-btn" data-nudge="-0.01">−0.01</button>
          <button type="button" class="w2-btn" data-nudge="0.01">+0.01</button>
          <button type="button" class="w2-btn" data-nudge="0.05">+0.05</button>
          <button type="button" class="w2-btn" data-nudge="0.1">+0.1</button>
          <button type="button" class="w2-btn w2-primary" id="w2-play-word">▶ Escuchar palabra</button>
        </div>
      </div>
      <p class="w2-hint">Arrastra una palabra para moverla y sus bordes para cambiar su duración. Teclado: ← → mueven 0,05 s (Shift 0,01 · Alt 0,25), Enter la escucha, Ctrl+Z deshace.
        <span class="w2-legend"><i class="w2-swatch"></i> medida del audio o editada</span>
        <span class="w2-legend"><i class="w2-swatch is-estimated"></i> estimada</span></p>`;
    stage.appendChild(wrap);

    // Regla de tiempo cada 0,5 s
    const ruler = wrap.querySelector('#w2-ruler');
    const last = line.words[line.words.length - 1].end + 2.4;
    for (let t = Math.ceil(step2.t0 * 2) / 2; t <= last; t += 0.5) {
      const tick = document.createElement('span');
      tick.className = 'w2-tick' + (Number.isInteger(t) ? ' is-major' : '');
      tick.style.left = (t - step2.t0) * step2.pps + 'px';
      if (Number.isInteger(t)) tick.dataset.label = t.toFixed(0) + 's';
      ruler.appendChild(tick);
    }

    // Frases (misma segmentación que AuraMusic)
    const phrases = splitLinePhrases(tokenize(line.text), line.words);
    const phraseRow = wrap.querySelector('#w2-phrases');
    phrases.forEach((phrase, i) => {
      const bracket = document.createElement('div');
      bracket.className = 'w2-phrase';
      bracket.dataset.start = phrase.startIdx;
      bracket.dataset.end = phrase.endIdx;
      bracket.textContent = 'Frase ' + (i + 1);
      phraseRow.appendChild(bracket);
    });

    const wordsRow = wrap.querySelector('#w2-words');
    line.words.forEach((word, i) => {
      const block = document.createElement('div');
      block.className = 'w2-word';
      block.dataset.index = String(i);
      block.tabIndex = 0;
      block.setAttribute('role', 'button');
      block.innerHTML = `<span class="w2-handle w2-handle-start" data-kind="start"></span><span class="w2-text"></span><span class="w2-time"></span><span class="w2-handle w2-handle-end" data-kind="end"></span>`;
      block.querySelector('.w2-text').textContent = word.word;
      block.addEventListener('pointerdown', event => startStep2Drag(event, block, event.target.dataset.kind || 'move'));
      block.addEventListener('pointermove', moveStep2Drag);
      block.addEventListener('pointerup', endStep2Drag);
      block.addEventListener('pointercancel', endStep2Drag);
      block.addEventListener('dblclick', () => { const w = step2Line().words[i]; previewStep2Range(w.start, w.end); });
      block.addEventListener('focus', () => { if (step2.selected !== i) selectStep2Word(i); });
      block.addEventListener('keydown', event => {
        const stepSize = event.shiftKey ? 0.01 : event.altKey ? 0.25 : 0.05;
        if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
          event.preventDefault(); event.stopPropagation();
          step2PushUndo();
          step2.selected = i;
          editSelectedWord('move', event.key === 'ArrowLeft' ? -stepSize : stepSize);
          layoutStep2Blocks();
        } else if (event.key === 'Enter') {
          event.preventDefault(); event.stopPropagation();
          const w = step2Line().words[i]; previewStep2Range(w.start, w.end);
        }
      });
      wordsRow.appendChild(block);
    });

    // Eventos de la barra y el inspector
    wrap.querySelector('#w2-prev').addEventListener('click', () => selectStep2Verse(state.selectedVerseIndex - 1));
    wrap.querySelector('#w2-next').addEventListener('click', () => selectStep2Verse(state.selectedVerseIndex + 1));
    wrap.querySelector('#w2-undo').addEventListener('click', step2Undo);
    wrap.querySelector('#w2-play-verse').addEventListener('click', () => {
      const first = line.words[0], final = line.words[line.words.length - 1];
      previewStep2Range(first.start, final.end);
    });
    wrap.querySelectorAll('.w2-seg').forEach(button => {
      const active = button.dataset.policy === step2.policy;
      button.classList.toggle('is-active', active);
      button.setAttribute('aria-checked', String(active));
      button.addEventListener('click', () => {
        step2.policy = button.dataset.policy;
        wrap.querySelectorAll('.w2-seg').forEach(other => {
          const on = other === button;
          other.classList.toggle('is-active', on);
          other.setAttribute('aria-checked', String(on));
        });
      });
    });
    wrap.querySelector('#w2-zoom').addEventListener('input', event => {
      step2.pps = Number(event.target.value);
      renderStep2WordsStage();
    });
    wrap.querySelector('#w2-scroll').addEventListener('pointerdown', event => {
      if (event.target.closest('.w2-word')) return;
      const track = document.getElementById('w2-track');
      const x = event.clientX - track.getBoundingClientRect().left;
      seekTo(step2.t0 + x / step2.pps);
    });
    wrap.querySelectorAll('[data-nudge]').forEach(button => button.addEventListener('click', () => {
      step2PushUndo();
      editSelectedWord('move', Number(button.dataset.nudge));
      layoutStep2Blocks();
    }));
    const applyInput = (kind, input) => {
      const value = parseFloat(input.value);
      if (!Number.isFinite(value) || value < 0) { layoutStep2Blocks(); return; }
      step2PushUndo();
      editSelectedWord(kind, value);
      layoutStep2Blocks();
    };
    wrap.querySelector('#w2-start').addEventListener('change', event => applyInput('start', event.target));
    wrap.querySelector('#w2-end').addEventListener('change', event => applyInput('end', event.target));
    wrap.querySelector('#w2-play-word').addEventListener('click', () => {
      const w = line.words[step2.selected]; previewStep2Range(w.start, w.end);
    });

    layoutStep2Blocks();
    selectStep2Word(step2.selected);
    updateStep2UndoButton();
    updateStep2Playhead(state.currentTime);
    stage.querySelector('#w2-scroll').scrollLeft = 0;
  }

  document.addEventListener('keydown', event => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'z' && state.currentView === 'editor' && state.activeStep === 2 &&
        !event.target.closest?.('input,textarea,select')) {
      event.preventDefault();
      step2Undo();
    }
  });

  /* =========================================================================
     6. STEP 3: EDITOR DE VIDEO & KEYFRAMES DE COLOR
     ========================================================================= */

  /* Expresiones (caritas): lista aparte de la letra, { t, face }. */
  let selectedFace = ':3';

  function expressionList() {
    if (!state.currentTrack) return [];
    return window.AuraMusic?.Expressions?.normalize(state.currentTrack.expressions, state.duration) || [];
  }

  function setExpressions(list) {
    state.currentTrack.expressions = window.AuraMusic.Expressions.normalize(list, state.duration);
    resetBratStage();
    renderExpressionsPanel();
    renderStep3Preview();
  }

  function renderStep3Preview() {
    updateLiveCinemaStageFromKeyframes();
    checkAndHighlightLiveVerse(state.currentTime);
  }

  function renderExpressionsPanel() {
    const faces = document.getElementById('expressions-faces');
    const list = document.getElementById('expressions-list');
    const library = window.AuraMusic?.Expressions;
    if (!faces || !list || !library || !state.currentTrack) return;
    faces.replaceChildren();
    library.FACES.forEach(face => {
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'expression-face' + (face === selectedFace ? ' is-selected' : '');
      button.setAttribute('role', 'radio');
      button.setAttribute('aria-checked', String(face === selectedFace));
      button.textContent = face;
      button.addEventListener('click', () => { selectedFace = face; renderExpressionsPanel(); });
      faces.appendChild(button);
    });
    const items = expressionList();
    list.replaceChildren();
    if (!items.length) {
      const empty = document.createElement('li');
      empty.className = 'expressions-empty';
      empty.textContent = 'Aún no hay expresiones: se usan las caritas automáticas de AuraMusic.';
      list.appendChild(empty);
    }
    items.forEach(item => {
      const row = document.createElement('li');
      const seek = document.createElement('button');
      seek.type = 'button';
      seek.className = 'expression-seek';
      seek.textContent = `${formatTime(item.t)}  ${item.face}`;
      seek.title = 'Ir a este momento';
      seek.addEventListener('click', () => seekTo(Math.max(0, item.t - 0.2)));
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.className = 'expression-remove';
      remove.setAttribute('aria-label', `Quitar ${item.face} de ${formatTime(item.t)}`);
      remove.textContent = '✕';
      remove.addEventListener('click', () => setExpressions(expressionList().filter(other => other.t !== item.t)));
      row.append(seek, remove);
      list.appendChild(row);
    });
  }

  function addExpressionAtCurrentTime() {
    if (!state.currentTrack || !window.AuraMusic?.Expressions) return;
    const t = Math.round(state.currentTime * 100) / 100;
    setExpressions([...expressionList().filter(item => item.t !== t), { t, face: selectedFace }]);
  }

  function renderStep3Effects() {
    if (!state.currentTrack) return;
    normalizeTrackEffects();
    renderExpressionsPanel();

    renderVideoEditorTimeline();
    renderKeyframeInspector();
    updateLiveCinemaStageFromKeyframes();
    checkAndHighlightLiveVerse(state.currentTime);
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
        const pal = kf.palette || 'lime';
        const diamond = document.createElement('div');
        diamond.className = `ve-kf-diamond kf-color-${pal}` + (idx === state.selectedKeyframeIndex ? ' selected' : '');
        diamond.style.left = `${pct}%`;
        diamond.title = `Keyframe #${idx + 1} (${formatTime(kf.time)}) — Paleta Brat: ${pal.toUpperCase()}`;

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
    const kfs = state.currentTrack?.effects?.keyframes || [];
    const kf = kfs[state.selectedKeyframeIndex] || kfs[0];
    if (!kf) return;

    const titleEl = document.getElementById('inspector-kf-title');
    const inputTime = document.getElementById('input-kf-time');
    const shakeChk = document.getElementById('step3-chk-shake');

    if (titleEl) titleEl.textContent = `💎 Keyframe #${state.selectedKeyframeIndex + 1} (${formatTime(kf.time)}) — ${kf.palette?.toUpperCase() || 'LIME'}`;
    if (inputTime) { inputTime.value = formatTime(kf.time); inputTime.removeAttribute('aria-invalid'); inputTime.removeAttribute('title'); }
    if (shakeChk) shakeChk.checked = kf.shake !== false;

    // Palette swatches active
    document.querySelectorAll('.ve-color-grid .palette-swatch-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.palette === (kf.palette || 'lime'));
    });

    // Layout buttons active
    document.querySelectorAll('.ve-layout-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.layout === (kf.layout || 'impact'));
    });

    // Variant buttons active
    document.querySelectorAll('.ve-var-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.variant === (kf.variant || 'plain'));
      btn.disabled = kf.layout === 'impact';
    });

    document.getElementById('variant-hint').hidden = kf.layout !== 'impact';
    for (const button of document.querySelectorAll('.ve-color-grid button,.ve-layout-btn,.ve-var-btn,.ve-entry-btn')) button.setAttribute('aria-pressed',String(button.classList.contains('active')));

    // Entry buttons active
    document.querySelectorAll('.ve-entry-btn').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.entry === (kf.entry || 'rise'));
      btn.setAttribute('aria-pressed',String(btn.classList.contains('active')));
    });
  }

  function addKeyframeAtCurrentTime() {
    if (!state.currentTrack) return;
    const curT = Math.round(state.currentTime * 100) / 100;
    if (!state.currentTrack.effects.keyframes) state.currentTrack.effects.keyframes = [];
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
        layout: prevKf.layout || 'impact',
        variant: prevKf.variant || 'plain',
        entry: prevKf.entry || 'rise',
        shake: prevKf.shake !== false
      };
      kfs.push(newKf);
      kfs.sort((a, b) => a.time - b.time);
      state.selectedKeyframeIndex = kfs.indexOf(newKf);
    }

    renderStep3Effects();
  }

  function deleteSelectedKeyframe() {
    const kfs = state.currentTrack?.effects?.keyframes;
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
    const palettes = ['lime', 'white', 'red', 'blue', 'yellow', 'ink'];
    const layouts = ['impact', 'center', 'spread', 'scribble'];
    const variants = ['heavy', 'lean', 'wide', 'plain'];
    const entries = ['rise', 'stamp', 'slide'];

    const newKfs = [];
    const stepLines = Math.max(2, Math.floor(lines.length / 5));

    for (let i = 0; i < lines.length; i += stepLines) {
      const line = lines[i];
      const pIdx = (i / stepLines) % palettes.length;
      newKfs.push({
        time: Math.round(line.time * 100) / 100,
        palette: palettes[pIdx],
        layout: layouts[pIdx % layouts.length],
        variant: variants[pIdx % variants.length],
        entry: entries[pIdx % entries.length],
        shake: true
      });
    }

    state.currentTrack.effects.keyframes = newKfs;
    state.selectedKeyframeIndex = 0;
    renderStep3Effects();
    alert(`✨ Se auto-generaron ${newKfs.length} keyframes de color y escena a lo largo de la canción.`);
  }

  function getActiveKeyframeAtTime(time) {
    return BratEffects.active(state.currentTrack?.effects?.keyframes,time);
  }

  function updateLiveCinemaStageFromKeyframes() {
    const stage = document.getElementById('step3-cinema-stage');
    if (!stage) return;
    const kf = getActiveKeyframeAtTime(state.currentTime);
    const scene = kf || BratEffects.keyframes([])[0];
    stage.dataset.lyricsTheme = 'brat';
    stage.dataset.bratPalette = scene.palette;
    stage.dataset.layout = scene.layout;
    stage.dataset.variant = scene.variant;
    stage.dataset.entry = scene.entry;
    // Remove legacy inline backgrounds, custom gradients and colors on every transition.
    stage.removeAttribute('data-bg-mode');
    for (const property of ['background','background-color','color','--stage-accent-color','--stage-accent-glow']) stage.style.removeProperty(property);
    if (scene.shake === false) clearPreviewBeat();
    const badge = document.getElementById('stage-active-kf-badge');
    if (badge) {
      badge.textContent = (kf ? 'ESCENA '+(state.currentTrack.effects.keyframes.indexOf(kf)+1) : 'BASE')+' · '+scene.palette.toUpperCase();
      badge.style.color = '#cbd5e1'; badge.style.borderColor = '#475569';
    }
    const signature = [scene.layout,scene.variant,stage.clientWidth,stage.clientHeight].join('|');
    if (signature !== previewLayoutSignature) {
      previewLayoutSignature = signature;
      const text = document.getElementById('step3-stage-brat-text');
      if (text?.textContent) fitBratText(text.textContent,text);
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

  function clearPreviewBeat() {
    if (previewBeatTimer !== null) clearTimeout(previewBeatTimer);
    previewBeatTimer = null;
    const stage = document.getElementById('step3-cinema-stage');
    for (const name of ['beat','beat-intensity','flash']) stage?.removeAttribute('data-'+name);
  }

  function triggerStageBeatHit(is808 = true) {
    const stage = document.getElementById('step3-cinema-stage');
    if (!stage || document.hidden || window.matchMedia('(prefers-reduced-motion: reduce)').matches ||
        getActiveKeyframeAtTime(state.currentTime)?.shake === false) return;
    clearPreviewBeat();
    stage.dataset.beat = 'hit';
    if (is808) { stage.dataset.beatIntensity = '808'; stage.dataset.flash = 'contrast'; }
    previewBeatTimer = setTimeout(clearPreviewBeat,180);
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
    if (document.hidden || state.currentView!=='editor') return;

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

      if (state.isPlaying && !document.hidden && state.currentView==='editor') {
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
    if (state.activeStep === 2) updateStep2Playhead(curT);

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
    }
    renderBratStage(curT);
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
    if (!stage || stage.clientWidth<1 || stage.clientHeight<1) return;
    const center = element.parentElement;
    const availableWidth = Math.max(1,element.clientWidth);
    const availableHeight = center.clientHeight*.94;
    const measure = element.cloneNode(true);
    measure.removeAttribute('id'); measure.setAttribute('aria-hidden','true');
    Object.assign(measure.style,{position:'absolute',visibility:'hidden',pointerEvents:'none',
      width:availableWidth+'px',maxHeight:'none',minHeight:'0',height:'auto',overflow:'visible',
      animation:'none',transition:'none'});
    // Measure inside the same scene so layout, font variant and wrapping really match.
    center.appendChild(measure);
    let low=14,high=Math.min(260,stage.clientWidth*(stage.dataset.layout==='impact'?.2:.16));
    for (let pass=0;pass<12;pass++) {
      const size=(low+high)/2; measure.style.fontSize=size+'px';
      if(measure.scrollWidth>availableWidth+1 || measure.scrollHeight>availableHeight+1)high=size;
      else low=size;
    }
    measure.remove(); element.style.fontSize=Math.floor(low)+'px';
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
      } else if (!revealed || !allowAnimation) {
        span.classList.remove('brat-word--new');
      }
      span.classList.toggle('brat-word--active', i === count - 1 || (count > 0 && i < count && i >= count - 2));
      span.classList.toggle('brat-word--past', i < count - 2);
    });
  }

  /* Motor de frases Brat: mismo análisis (LyricsTiming) y agrupación (BratScenes) que AuraMusic. */
  let bratPlanSignature = '';
  let bratPlanCheckedAt = 0;
  let bratPhrases = [];
  let bratSceneByPhrase = [];
  let bratSceneStart = -1;
  let bratTokens = [];
  let bratWordTimes = [];
  let bratScenePhrases = [];
  let bratShownIdle = '';

  function resetBratStage() {
    bratPlanSignature = '';
    bratPlanCheckedAt = 0;
    bratPhrases = [];
    bratSceneByPhrase = [];
    bratSceneStart = -1;
    bratShownIdle = '';
    const text = document.getElementById('step3-stage-brat-text');
    if (text) { text.dataset.bratCount = ''; text.dataset.bratActivePhrase = ''; }
  }

  function getBratContextSymbol(text) {
    const raw = String(text || '');
    const value = raw.toLocaleLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
    if (/[?¿]/u.test(raw)) return /¿/u.test(raw) ? '¿?' : '?';
    if (/\b(llor\w*|trist\w*|cry\w*|sad|tears|dolor|broken|perdi\w*)\b/u.test(value)) return ':(';
    if (/\b(feliz|alegr\w*|happy|smil\w*|sonri\w*|bien|good|reir|laugh)\b/u.test(value)) return ':)';
    if (/\b(enoja\w*|odio|hate|angry|rabia|furia)\b/u.test(value)) return '>:/';
    if (/\b(amor|love|heart|corazon|beso|kiss|te quiero)\b/u.test(value)) return '♡';
    if (/\b(solo|sola|alone|silencio|quiet|vacio)\b/u.test(value)) return ':|';
    if (/[!¡]/u.test(raw)) return /¡/u.test(raw) ? '¡!' : '!';
    if (/\b(noche|night|luna|moon|oscuro|dark)\b/u.test(value)) return '◐';
    if (/\b(musica|ritmo|baila\w*|music|dance|sing\w*)\b/u.test(value)) return '♪';
    if (/\b(vamos|corre\w*|run|fly|vuela\w*|seguir)\b/u.test(value)) return '→';
    return '';
  }

  function bratSourceLines() {
    return (state.currentTrack?.lines || []).map(line => ({
      time: Number(line.time),
      text: line.text,
      words: (Array.isArray(line.words) ? line.words : []).map(word => ({
        text: word.word ?? word.text ?? '',
        time: Number(word.start ?? word.time),
        end: Number(word.end)
      }))
    }));
  }

  function prepareBratPlan() {
    const timing = window.AuraMusic?.LyricsTiming;
    const scenes = window.AuraMusic?.BratScenes;
    if (!timing || !scenes) return;
    const lines = bratSourceLines();
    const compiled = timing.compile(lines, { duration: state.duration });
    const phrases = [];
    const expressionList = window.AuraMusic?.Expressions?.normalize(state.currentTrack.expressions, state.duration) || [];
    const hasExpressions = expressionList.length > 0;
    lines.forEach((line, lineIndex) => {
      const info = compiled[lineIndex];
      if (!info?.words.length) return;
      for (const range of info.phrases) {
        const part = info.tokens.slice(range.start, range.end);
        const text = part.join('').trim();
        const symbol = hasExpressions ? '' : getBratContextSymbol(text);
        if (symbol && !/^[?!¿¡]+$/u.test(symbol)) part[part.length - 1] = part[part.length - 1].trimEnd() + ` ${symbol} `;
        phrases.push({
          tokens: part,
          times: info.words.slice(range.start, range.end).map(word => word.time),
          ends: info.words.slice(range.start, range.end).map(word => word.end),
          time: range.time, end: range.finish, text, lineIndex, symbol, special: false
        });
      }
    });
    if (hasExpressions) {
      window.AuraMusic.Expressions.assign(phrases, expressionList).forEach((face, index) => {
        const phrase = phrases[index];
        if (!phrase || !phrase.tokens.length) return;
        phrase.symbol = face;
        phrase.tokens[phrase.tokens.length - 1] = phrase.tokens[phrase.tokens.length - 1].trimEnd() + ` ${face} `;
      });
    }
    const seed = `${state.currentTrack.videoId || ''}:${state.currentTrack.title || ''}`;
    const plan = scenes.plan(phrases, seed);
    bratPhrases = plan.phrases;
    bratSceneByPhrase = new Array(bratPhrases.length);
    for (const scene of plan.scenes) {
      scene.data = buildBratScene(scene);
      for (let i = scene.start; i <= scene.end; i++) bratSceneByPhrase[i] = scene;
    }
    bratSceneStart = -1;
  }

  function buildBratScene(scene) {
    const tokens = [], times = [], phrases = [];
    for (let i = scene.start; i <= scene.end; i++) {
      const phrase = bratPhrases[i];
      const part = phrase.tokens.slice();
      times.push(...phrase.times);
      const start = tokens.length;
      if (part.length && i < scene.end) part[part.length - 1] += ' ';
      tokens.push(...part);
      phrases.push({ time: phrase.time, start, end: tokens.length, symbol: phrase.symbol, text: phrase.text });
    }
    return { tokens, times, phrases };
  }

  // Detecta cambios de letra/palabras sin recalcular en cada frame.
  function ensureBratPlan() {
    const now = performance.now();
    if (bratPlanSignature && now - bratPlanCheckedAt < 300) return;
    bratPlanCheckedAt = now;
    const signature = JSON.stringify([state.duration, bratSourceLines()]);
    if (signature === bratPlanSignature) return;
    bratPlanSignature = signature;
    prepareBratPlan();
  }

  function setBratIdleText(stageText, message) {
    if (bratShownIdle === message && stageText.dataset.bratCount === 'idle') return;
    bratShownIdle = message;
    bratSceneStart = -1;
    stageText.replaceChildren();
    const span = document.createElement('span');
    span.className = 'brat-word brat-word--active';
    const ink = document.createElement('span');
    ink.className = 'brat-word-ink';
    ink.textContent = message;
    span.appendChild(ink);
    stageText.appendChild(span);
    stageText.dataset.bratCount = 'idle';
    stageText.dataset.bratActivePhrase = '';
    fitBratText(message, stageText);
  }

  function renderBratWords(stageText, count, activePhrase, previousCount, allowAnimation = true) {
    let words = stageText.querySelectorAll('.brat-word');
    if (words.length !== bratTokens.length) {
      stageText.replaceChildren();
      bratTokens.forEach(token => {
        const span = document.createElement('span');
        span.className = 'brat-word is-hidden';
        const ink = document.createElement('span');
        ink.className = 'brat-word-ink';
        ink.textContent = token.trimEnd();
        span.appendChild(ink);
        span.addEventListener('animationend', event => {
          if (event.target === ink) span.classList.remove('brat-word--new');
        });
        const spacing = token.match(/\s+$/u)?.[0];
        if (spacing) span.appendChild(document.createTextNode(spacing));
        stageText.appendChild(span);
      });
      words = stageText.querySelectorAll('.brat-word');
    }
    const animateFew = allowAnimation && count - previousCount > 0 && count - previousCount <= 2 &&
      !window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    words.forEach((span, i) => {
      const revealed = i < count;
      const wasHidden = span.classList.contains('is-hidden');
      span.classList.toggle('is-hidden', !revealed);
      if (revealed && wasHidden && animateFew) span.classList.add('brat-word--new');
      else if (!allowAnimation || !revealed || i < activePhrase.start) span.classList.remove('brat-word--new');
      span.classList.toggle('brat-word--active', i >= activePhrase.start && i < activePhrase.end);
      span.classList.toggle('brat-word--past', i < activePhrase.start);
    });
  }

  let bratLastRenderTime = -1;
  function renderBratStage(curT) {
    const stageText = document.getElementById('step3-stage-brat-text');
    const timing = window.AuraMusic?.LyricsTiming;
    if (!stageText || !state.currentTrack || !timing) return;
    ensureBratPlan();

    const title = `${state.currentTrack.title || 'AuraLyrics'}${state.currentTrack.artist ? ' - ' + state.currentTrack.artist : ''}`;
    if (!bratPhrases.length) { setBratIdleText(stageText, state.currentTrack.title ? title : 'AURALYRICS'); return; }
    const phraseIndex = timing.upperBound(bratPhrases, curT, phrase => phrase.time) - 1;
    if (phraseIndex < 0) { setBratIdleText(stageText, title); return; }

    const continuous = bratLastRenderTime >= 0 && curT >= bratLastRenderTime && curT - bratLastRenderTime < .4;
    bratLastRenderTime = curT;
    const scene = bratSceneByPhrase[phraseIndex];
    if (scene.start !== bratSceneStart) {
      bratSceneStart = scene.start;
      bratShownIdle = '';
      bratTokens = scene.data.tokens;
      bratWordTimes = scene.data.times;
      bratScenePhrases = scene.data.phrases;
      stageText.dataset.bratCount = '';
      stageText.dataset.bratActivePhrase = '';
      stageText.replaceChildren();
      renderBratWords(stageText, 0, bratScenePhrases[0], 0, false);
      fitBratText(bratTokens.join('').trimEnd(), stageText);
    }

    const currentPhrase = bratScenePhrases[phraseIndex - scene.start];
    const count = timing.upperBound(bratWordTimes, curT);
    const previousCount = Number(stageText.dataset.bratCount) || 0;
    if (count !== previousCount || stageText.dataset.bratActivePhrase !== String(phraseIndex)) {
      stageText.dataset.bratCount = String(count);
      stageText.dataset.bratActivePhrase = String(phraseIndex);
      renderBratWords(stageText, count, currentPhrase, previousCount, continuous && state.isPlaying);
    }
  }

  let lastBeatCheckTime = -1;
  function checkAndTriggerBeats(curT) {
    const previous = lastBeatCheckTime;
    lastBeatCheckTime = curT;
    if (!state.currentTrack || getActiveKeyframeAtTime(curT)?.shake === false) return;
    const beats = state.currentTrack.effects.bassBeats || [];
    // Un golpe cuenta si el reloj lo cruzó desde el último chequeo (avance normal) o cae a ±80 ms.
    const forward = previous >= 0 && curT > previous && curT - previous < .6;
    for (let i = 0; i < beats.length; i++) {
      const crossed = forward ? beats[i] > previous - .02 && beats[i] <= curT + .02 : Math.abs(curT - beats[i]) < .08;
      if (crossed && i !== state.activeBeatIndex) { state.activeBeatIndex = i; triggerStageBeatHit(); break; }
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

    const payload = getCleanTrackPayload();

    // GitHub Pages keeps drafts in this browser; it cannot write to the repository.
    try {
      if(isCloudMode())throw new Error('Static hosting');
      const res = await fetch('/api/lyrics/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      if (res.ok) {
        const data = await res.json();
        if(!data.success)throw new Error('Save was not confirmed');
        alert(`✨ Canción guardada con éxito en el servidor local: ${data.fileName}`);
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

      const localSaved = readLocalDrafts();
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

  function getCleanTrackPayload() {
    if (!state.currentTrack) return null;
    const cleanTrack = JSON.parse(JSON.stringify(state.currentTrack));
    cleanTrack.effects = BratEffects.normalize(cleanTrack.effects,cleanTrack.duration);
    const faces = window.AuraMusic?.Expressions?.normalize(cleanTrack.expressions, cleanTrack.duration) || [];
    if (faces.length) cleanTrack.expressions = faces; else delete cleanTrack.expressions;
    return {
      found: true,
      track: cleanTrack
    };
  }

  function openExportModal() {
    const modal = document.getElementById('modal-export');
    const preview = document.getElementById('export-json-code-preview');
    if (!modal || !state.currentTrack) return;

    const payload = getCleanTrackPayload();

    if (preview && payload) {
      preview.textContent = JSON.stringify(payload, null, 2);
    }

    modal.style.display = 'flex';
  }

  function downloadJsonFile() {
    if (!state.currentTrack) return;
    const payload = getCleanTrackPayload();
    if (!payload) return;
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
    if (!Number.isFinite(Number(seconds))) return;
    const target = Math.min(Math.max(0,Number(seconds)),state.duration || Infinity);
    clearPreviewBeat(); state.activeBeatIndex = -1;
    state.currentTime = target;
    try { state.ytPlayer?.seekTo?.(target,true); } catch (_) {}
    updateDockProgress(target); updateLiveCinemaStageFromKeyframes(); checkAndHighlightLiveVerse(target);
    const playhead = document.getElementById('ve-playhead-needle');
    if (playhead) playhead.style.left = (state.duration>0 ? 100*target/state.duration : 0)+'%';
    const display = document.getElementById('ve-tc-display'); if (display) display.textContent = formatTime(target);
  }

  function editSelectedKeyframeTime(seconds) {
    const kfs = state.currentTrack?.effects?.keyframes;
    const selected = kfs?.[state.selectedKeyframeIndex];
    if (!selected || !Number.isFinite(seconds) || seconds<0 || seconds>state.duration) {
      const input = document.getElementById('input-kf-time');
      if (input) { input.setAttribute('aria-invalid','true'); input.title='Usa un tiempo entre 00:00 y '+formatTime(state.duration); }
      return;
    }
    selected.time = Math.round(seconds*100)/100;
    kfs.sort((a,b)=>a.time-b.time); state.selectedKeyframeIndex = kfs.indexOf(selected);
    const input = document.getElementById('input-kf-time'); input?.removeAttribute('aria-invalid');
    renderStep3Effects(); seekTo(selected.time);
  }

  let previewPreviousFocus = null;
  function setPreviewExpanded(expanded) {
    const card = document.querySelector('.step3-preview-card');
    const button = document.getElementById('btn-expand-preview');
    if (!card || !button || card.classList.contains('is-expanded')===expanded) return;
    if (expanded) previewPreviousFocus=document.activeElement;
    card.classList.toggle('is-expanded',expanded); document.body.classList.toggle('preview-expanded',expanded);
    button.setAttribute('aria-pressed',String(expanded)); button.textContent=expanded?'Volver al editor · Esc':'Ampliar vista previa ↗';
    if (expanded) button.focus({preventScroll:true});
    else previewPreviousFocus?.focus?.({preventScroll:true});
    requestAnimationFrame(()=>{ previewLayoutSignature=''; updateLiveCinemaStageFromKeyframes(); });
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
    if (!Number.isFinite(Number(secs)) || secs < 0) return '00:00.00';
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
    const modalExport = document.getElementById('modal-export');
    document.getElementById('btn-export-track-modal')?.addEventListener('click', openExportModal);
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
        navigator.clipboard.writeText(JSON.stringify(getCleanTrackPayload(), null, 2))
          .then(()=>alert('Copiado al portapapeles'))
          .catch(()=>alert('No se pudo copiar. Puedes descargar el JSON.'));
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
        effects: BratEffects.normalize({})
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

    document.getElementById('btn-expand-preview')?.addEventListener('click',()=>setPreviewExpanded(!document.body.classList.contains('preview-expanded')));
    const resizePreview = new ResizeObserver(()=>{
      if (state.currentView==='editor' && state.activeStep===3) { previewLayoutSignature=''; updateLiveCinemaStageFromKeyframes(); }
    });
    resizePreview.observe(document.getElementById('step3-cinema-stage'));
    document.addEventListener('visibilitychange',()=>{
      clearPreviewBeat(); stopSyncLoop();
      if (!document.hidden && state.isPlaying) startSyncLoop();
    });
    window.addEventListener('pagehide',()=>{ clearPreviewBeat(); stopSyncLoop(); });

    // Global Keyboard Shortcuts (Space for Verse Stamp, B for Beat, K for Keyframe, Left/Right for Seek)
    window.addEventListener('keydown', (e) => {
      if (e.key==='Escape') {
        setPreviewExpanded(false);
        document.getElementById('modal-export').style.display='none';
        return;
      }
      if (state.currentView!=='editor' || !state.currentTrack || e.repeat || e.ctrlKey || e.altKey || e.metaKey ||
          document.querySelector('.modal-backdrop:not([style*="display: none"])') ||
          e.target.closest('input,textarea,select,button,a,[contenteditable="true"]')) return;

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
    document.getElementById('btn-add-expression')?.addEventListener('click', addExpressionAtCurrentTime);
    document.getElementById('btn-clear-expressions')?.addEventListener('click', () => { if (state.currentTrack) setExpressions([]); });
    document.getElementById('btn-delete-selected-kf')?.addEventListener('click', deleteSelectedKeyframe);
    document.getElementById('btn-auto-section-keyframes')?.addEventListener('click', autoGenerateSectionKeyframes);

    document.getElementById('btn-kf-nudge-back')?.addEventListener('click',()=> {
      const kf=state.currentTrack?.effects?.keyframes[state.selectedKeyframeIndex];
      if(kf)editSelectedKeyframeTime(Math.max(0,kf.time-.2));
    });
    document.getElementById('btn-kf-nudge-fwd')?.addEventListener('click',()=> {
      const kf=state.currentTrack?.effects?.keyframes[state.selectedKeyframeIndex];
      if(kf)editSelectedKeyframeTime(Math.min(state.duration,kf.time+.2));
    });
    document.getElementById('input-kf-time')?.addEventListener('change',event=> {
      const value=event.target.value.trim();
      const valid=/^(?:\d+:)?\d+(?:\.\d+)?$/.test(value);
      const parts=value.split(':').map(Number);
      const seconds=valid && (parts.length===1 || parts[1]<60) ? parts.length===2?parts[0]*60+parts[1]:parts[0] : NaN;
      editSelectedKeyframeTime(seconds);
    });

    // Video Editor Official Brat Color Swatches
    document.querySelectorAll('.ve-color-grid .palette-swatch-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
        if (kf) {
          kf.palette = btn.dataset.palette;
          renderStep3Effects();
        }
      });
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

    // Entry Buttons
    document.querySelectorAll('.ve-entry-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
        if (kf) {
          kf.entry = btn.dataset.entry;
          renderStep3Effects();
        }
      });
    });

    document.getElementById('step3-chk-shake')?.addEventListener('change', (e) => {
      const kf = state.currentTrack?.effects?.keyframes?.[state.selectedKeyframeIndex];
      if (kf) kf.shake = e.target.checked;
      if (!e.target.checked) clearPreviewBeat();
    });

    document.getElementById('btn-step3-clear-beats')?.addEventListener('click', () => {
      if (state.currentTrack) {
        state.currentTrack.effects.bassBeats = [];
        renderStep3Effects();
      }
    });
  }
})();
