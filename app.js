// ============================================
// PPL-8 TRAINING TRACKER - APPLICATION LOGIC
// ============================================

(function () {
  'use strict';

  // --- Constants ---
  const DEFAULT_REST_SECONDS = 90;

  // --- State ---
  // Persisted fields are defined in buildSavePayload().
  // Fields prefixed with _ (e.g. _chartMetric, _nutritionReminderShown) are
  // transient in-memory flags that are NOT persisted to localStorage.
  const STATE_VERSION = 11;
  let state = {
    stateVersion: STATE_VERSION,
    currentView: 'viewDashboard',
    currentCycle: 'A',
    activeSession: null,
    workoutStartTime: null,
    timerInterval: null,
    znsBaseline: null,
    athlete: { height: 200, weight: 94, bodyFat: 13 },
    sessions: [],
    customPlan: null,
    lastBackup: null
  };

  // --- Storage ---
  const STORAGE_KEY = 'ppl8_tracker_data';
  let _saveDebounceTimer = null;
  let _wakeLock = null;

  // Migration pipeline: transforms legacy state to current schema
  function migrateState(parsed) {
    const version = parsed.stateVersion || 10;
    if (version < 11) {
      // Migrate unilateral exercises: ensure feedback field exists
      if (parsed.sessions) {
        parsed.sessions.forEach(session => {
          session.exercises && session.exercises.forEach(ex => {
            if (ex.unilateral && ex.sets) {
              ex.sets = ex.sets.map(s => ({ feedback: '', ...s }));
            }
          });
        });
      }
      // Migrate znsBaseline: plain number → {value, date} object
      if (typeof parsed.znsBaseline === 'number') {
        parsed.znsBaseline = { value: parsed.znsBaseline, date: null };
      }
      parsed.stateVersion = 11;
    }
    return parsed;
  }

  function loadState() {
    try {
      const saved = localStorage.getItem(STORAGE_KEY);
      if (saved) {
        let parsed = JSON.parse(saved);
        parsed = migrateState(parsed);
        state = { ...state, ...parsed };
        // Ensure znsBaseline is always object or null (guard against bad data)
        if (state.znsBaseline !== null && typeof state.znsBaseline !== 'object') {
          state.znsBaseline = null;
        }
      }
    } catch (e) { console.warn('Load failed:', e); }
  }

  // Non-blocking async save with requestIdleCallback
  // Single source of truth for persisted state shape — add new fields here only
  function buildSavePayload() {
    return {
      stateVersion: STATE_VERSION,
      currentCycle: state.currentCycle,
      znsBaseline: state.znsBaseline,
      athlete: state.athlete,
      sessions: state.sessions,
      customPlan: state.customPlan,
      lastBackup: state.lastBackup,
      activeSession: state.activeSession,
      workoutStartTime: state.workoutStartTime
    };
  }

  function saveState() {
    const doSave = () => {
      try {
        localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSavePayload()));
      } catch (e) {
        if (e.name === 'QuotaExceededError') {
          toast('⚠️ Speicher voll! Bitte Backup erstellen und alte Daten löschen.');
        } else {
          console.warn('Save failed:', e);
        }
      }
    };
    if (typeof requestIdleCallback !== 'undefined') {
      requestIdleCallback(doSave, { timeout: 1000 });
    } else {
      setTimeout(doSave, 0);
    }
  }

  // Debounced save for input events (500ms)
  function debouncedSave() {
    if (_saveDebounceTimer) clearTimeout(_saveDebounceTimer);
    _saveDebounceTimer = setTimeout(() => {
      _saveDebounceTimer = null;
      saveState();
    }, 500);
  }

  // Synchronous flush (used on visibilitychange to background)
  function flushSave() {
    if (_saveDebounceTimer) {
      clearTimeout(_saveDebounceTimer);
      _saveDebounceTimer = null;
    }
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(buildSavePayload()));
    } catch (e) { console.warn('Flush save failed:', e); }
  }

  // Modal focus management: move focus into modal for accessibility
  function focusFirstIn(el) {
    const sel = 'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';
    const first = el.querySelector(sel);
    if (first) setTimeout(() => first.focus(), 60);
  }

  // --- Gist Cloud Sync ---
  const GIST_TOKEN_KEY = 'ppl8_gist_token';
  const GIST_ID_KEY    = 'ppl8_gist_id';
  let _syncStatus = 'idle'; // idle | syncing | ok | error

  function gistGetToken() { return localStorage.getItem(GIST_TOKEN_KEY) || ''; }
  function gistGetId()    { return localStorage.getItem(GIST_ID_KEY) || ''; }

  function gistSetSyncStatus(status, msg) {
    _syncStatus = status;
    const el = document.getElementById('syncStatus');
    if (!el) return;
    const icons = { idle: '☁️', syncing: '🔄', ok: '✅', error: '❌' };
    el.textContent = (icons[status] || '☁️') + ' ' + (msg || '');
    el.dataset.status = status;
  }

  // Build the payload we store in the Gist file
  function gistBuildPayload() {
    return JSON.stringify({
      stateVersion: STATE_VERSION,
      syncedAt: new Date().toISOString(),
      znsBaseline: state.znsBaseline,
      athlete: state.athlete,
      sessions: state.sessions,
      customPlan: state.customPlan,
      lastBackup: state.lastBackup
    }, null, 2);
  }

  // Push local state → Gist (creates Gist if no ID stored yet)
  async function gistPush() {
    const token = gistGetToken();
    if (!token) { toast('⚙️ Bitte zuerst GitHub Token in Einstellungen hinterlegen.'); return; }
    gistSetSyncStatus('syncing', 'Wird gespeichert…');
    try {
      const payload = gistBuildPayload();
      const existingId = gistGetId();
      let url = 'https://api.github.com/gists';
      let method = 'POST';
      let body = {
        description: 'PPL-8 Training Tracker Sync',
        public: false,
        files: { 'ppl8_data.json': { content: payload } }
      };
      if (existingId) {
        url = `https://api.github.com/gists/${existingId}`;
        method = 'PATCH';
        body = { files: { 'ppl8_data.json': { content: payload } } };
      }
      const res = await fetch(url, {
        method,
        headers: {
          'Authorization': `Bearer ${token}`,
          'Content-Type': 'application/json',
          'X-GitHub-Api-Version': '2022-11-28'
        },
        body: JSON.stringify(body)
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.message || '';
        const hint = res.status === 401 ? ' (Token ungültig oder abgelaufen)' :
                     res.status === 403 ? ' (Token hat keine Gist-Berechtigung)' :
                     res.status === 404 ? ' (Gist nicht gefunden – bitte neue Gist-ID)' : '';
        throw new Error(`HTTP ${res.status}${hint}${detail ? ': ' + detail : ''}`);
      }
      const data = await res.json();
      if (!existingId) {
        localStorage.setItem(GIST_ID_KEY, data.id);
        // Show the Gist ID so user can copy it to other devices
        const idEl = document.getElementById('gistIdDisplay');
        if (idEl) { idEl.value = data.id; idEl.closest('.gist-id-row') && (idEl.closest('.gist-id-row').style.display = ''); }
      }
      state.lastBackup = new Date().toISOString();
      saveState();
      gistSetSyncStatus('ok', 'Gespeichert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      toast('☁️ Cloud Sync erfolgreich!');
    } catch (e) {
      console.error('Gist push failed:', e);
      gistSetSyncStatus('error', e.message);
      toast('❌ Sync fehlgeschlagen: ' + e.message);
    }
  }

  // Pull Gist → merge into local state (newer wins by syncedAt timestamp)
  async function gistPull() {
    const token = gistGetToken();
    const gistId = gistGetId();
    if (!token) { toast('⚙️ Bitte zuerst GitHub Token hinterlegen.'); return; }
    if (!gistId) { toast('⚙️ Keine Gist-ID gespeichert. Erst Push durchführen oder ID eintragen.'); return; }
    gistSetSyncStatus('syncing', 'Wird geladen…');
    try {
      const res = await fetch(`https://api.github.com/gists/${gistId}`, {
        headers: {
          'Authorization': `Bearer ${token}`,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        const detail = err.message || '';
        const hint = res.status === 401 ? ' (Token ungültig oder abgelaufen)' :
                     res.status === 403 ? ' (Token hat keine Gist-Berechtigung)' :
                     res.status === 404 ? ' (Gist-ID nicht gefunden)' : '';
        throw new Error(`HTTP ${res.status}${hint}${detail ? ': ' + detail : ''}`);
      }
      const gist = await res.json();
      const fileContent = gist.files['ppl8_data.json'] && gist.files['ppl8_data.json'].content;
      if (!fileContent) throw new Error('Datei nicht im Gist gefunden');
      const remote = JSON.parse(fileContent);

      // Conflict resolution: merge sessions (union by id), remote wins for athlete/baseline if newer
      const localTime  = state.lastBackup ? new Date(state.lastBackup).getTime() : 0;
      const remoteTime = remote.syncedAt   ? new Date(remote.syncedAt).getTime()  : 0;

      // Always merge sessions: combine both, deduplicate by session id (local wins)
      const localIds = new Set((state.sessions || []).map(s => s.id));
      const allSessions = [...(state.sessions || []), ...(remote.sessions || [])];
      const seen = new Set();
      const mergedSessions = allSessions.filter(s => {
        if (seen.has(s.id)) return false;
        seen.add(s.id);
        return true;
      });
      mergedSessions.sort((a, b) => new Date(a.date) - new Date(b.date));
      const remoteOnlySessions = (remote.sessions || []).filter(s => !localIds.has(s.id));
      if ((remote.sessions || []).some(s => localIds.has(s.id))) {
        console.info('Gist-Merge: Lokale Änderungen an vorhandenen Sessions behalten.');
      }
      state.sessions = mergedSessions;

      // For scalar fields: remote wins only if it is newer
      if (remoteTime > localTime) {
        if (remote.athlete)     state.athlete     = remote.athlete;
        if (remote.znsBaseline) state.znsBaseline = remote.znsBaseline;
        if (remote.customPlan)  state.customPlan  = remote.customPlan;
      }

      state.lastBackup = new Date().toISOString();
      saveState();
      renderDashboard();
      if (state.currentView === 'viewHistory') renderHistory();
      populateSettingsForm();
      gistSetSyncStatus('ok', 'Synchronisiert ' + new Date().toLocaleTimeString('de-DE', { hour: '2-digit', minute: '2-digit' }));
      toast('☁️ Daten synchronisiert! ' + mergedSessions.length + ' Sessions geladen.');
    } catch (e) {
      console.error('Gist pull failed:', e);
      gistSetSyncStatus('error', e.message);
      toast('❌ Pull fehlgeschlagen: ' + e.message);
    }
  }

  // Save token + optional gist ID from settings UI
  function saveGistSettings() {
    const token = (document.getElementById('gistTokenInput') || {}).value || '';
    const gistId = (document.getElementById('gistIdDisplay') || {}).value || '';
    if (!token) { toast('⚠️ Bitte Token in das Textfeld eingeben'); return; }
    const trimmed = token.trim();
    localStorage.setItem(GIST_TOKEN_KEY, trimmed);
    if (gistId.trim()) localStorage.setItem(GIST_ID_KEY, gistId.trim());
    const preview = trimmed.slice(0, 12) + '…';
    toast('✅ Token gespeichert: ' + preview);
    gistSetSyncStatus('idle', 'Bereit – Token: ' + preview);
  }

  // Auto-pull on app start if token + gist id exist
  async function gistAutoSync() {
    if (gistGetToken() && gistGetId()) {
      await gistPull();
    }
  }

    // --- Wake Lock ---
  async function requestWakeLock() {
    if (!('wakeLock' in navigator)) return;
    try {
      _wakeLock = await navigator.wakeLock.request('screen');
    } catch (e) { /* silently fail */ }
  }

  function releaseWakeLock() {
    if (_wakeLock) { _wakeLock.release(); _wakeLock = null; }
  }

  // --- Helpers ---
  function $(id) { return document.getElementById(id); }
  function show(el) { el.classList.remove('hidden'); }
  function hide(el) { el.classList.add('hidden'); }

  // XSS-safe HTML escaping for user-controlled strings
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  function toast(msg, onClick) {
    const t = $('toast');
    $('toastMsg').textContent = msg;
    t.style.cursor = onClick ? 'pointer' : '';
    t.onclick = onClick || null;
    show(t);
    if (!onClick) setTimeout(() => hide(t), 2500);
  }

  function formatDate(d) {
    const date = new Date(d);
    return date.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function formatTime(seconds) {
    const m = Math.floor(seconds / 60).toString().padStart(2, '0');
    const s = (seconds % 60).toString().padStart(2, '0');
    return `${m}:${s}`;
  }

  function getPlan() {
    return state.customPlan || TRAINING_PLAN;
  }

  function getDays(cycle) {
    return cycle === 'A' ? getPlan().cycleA : getPlan().cycleB;
  }

  // Find last session weights for an exercise by id
  function getLastWeights(exId) {
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const ex = state.sessions[i].exercises.find(e => e.id === exId);
      if (ex && ex.sets.some(s => s.weight)) return ex.sets;
    }
    return null;
  }

  // Find last setup notes for an exercise by id
  function getLastSetup(exId) {
    for (let i = state.sessions.length - 1; i >= 0; i--) {
      const ex = state.sessions[i].exercises.find(e => e.id === exId);
      if (ex && ex.setup) return ex.setup;
    }
    return '';
  }

  // Weight step for progression
  const FEEDBACK_STEP_KG = 2.5;

  /**
   * Evaluates the last session's performance for a specific exercise and suggests
   * the appropriate weights for the upcoming session based on the Double-Progression model.
   *
   * Rules (per set, evaluated on last session data):
   * 1. Manual feedback 'up'/'down' always wins
   * 2. Auto-progress: if ALL sets hit top of rep range AND avg RIR >= 1 → +2.5kg
   * 3. Auto-deload:   if any set has weight but 0 reps logged → −2.5kg
   * 4. Otherwise:     keep weight, mark 'maintain'
   *
   * @param {string} exId - The unique identifier of the exercise.
   * @returns {Array<{weight: string, _adjusted: string}>|null} Array of suggested set data, or null if no previous data.
   */
  function getSuggestedWeights(exId) {
    const lastSets = getLastWeights(exId);
    if (!lastSets) return null;

    // Find target rep ceiling for this exercise
    const allExs = [...getPlan().cycleA, ...getPlan().cycleB].flatMap(d => d.exercises);
    const planEx = allExs.find(e => e.id === exId);
    const repStr = planEx ? planEx.reps : '';
    const repMatch = repStr.match(/(\d+)(?:[^\d]+(\d+))?/);
    const repLow  = repMatch ? parseInt(repMatch[1]) : 0;
    const repHigh = repMatch && repMatch[2] ? parseInt(repMatch[2]) : repLow;

    // Analyse last session
    const weightedSets = lastSets.filter(s => parseFloat(s.weight) > 0);
    const allHitTop = weightedSets.length > 0 && weightedSets.every(s => {
      const r = parseInt(s.reps) || 0;
      return repHigh > 0 ? r >= repHigh : false;
    });
    const avgRIR = weightedSets.length > 0
      ? weightedSets.reduce((a, s) => a + (parseFloat(s.rir) || 0), 0) / weightedSets.length
      : 0;
    const anyEmpty = weightedSets.some(s => !(parseInt(s.reps) > 0));

    return lastSets.map(s => {
      const base = parseFloat(s.weight) || 0;
      // Manual feedback overrides everything
      if (s.feedback === 'up')   return { ...s, weight: String(base + FEEDBACK_STEP_KG), _adjusted: 'up' };
      if (s.feedback === 'down') return { ...s, weight: String(Math.max(0, base - FEEDBACK_STEP_KG)), _adjusted: 'down' };
      // Auto-progression
      if (allHitTop && avgRIR >= 1) return { ...s, weight: String(base + FEEDBACK_STEP_KG), _adjusted: 'up' };
      if (anyEmpty && base > 0)     return { ...s, weight: String(Math.max(0, base - FEEDBACK_STEP_KG)), _adjusted: 'down' };
      return { ...s, _adjusted: base > 0 ? 'maintain' : '' };
    });
  }

  /**
   * Generates a UI label for the progression status of an exercise.
   *
   * @param {string} exId - The unique identifier of the exercise.
   * @returns {{text: string, cls: string}|null} The label object with text and CSS class, or null if no progression data.
   */
  function getProgressionLabel(exId) {
    const suggested = getSuggestedWeights(exId);
    if (!suggested) return null;
    const adj = suggested.find(s => s._adjusted)?._adjusted;
    if (adj === 'up')       return { text: '↑ +2.5kg', cls: 'prog-up' };
    if (adj === 'down')     return { text: '↓ −2.5kg', cls: 'prog-down' };
    if (adj === 'maintain') return { text: '= Halten',  cls: 'prog-hold' };
    return null;
  }

  function getExerciseHistory(exId) {
    return state.sessions
      .filter(s => s.exercises.some(e => e.id === exId))
      .map(s => {
        const ex = s.exercises.find(e => e.id === exId);
        if (!ex || !ex.sets) return null;
        const maxW = Math.max(...ex.sets.map(st => parseFloat(st.weight) || 0));
        const totalVol = ex.sets.reduce((a, st) => a + (parseFloat(st.weight) || 0) * (parseInt(st.reps) || 0), 0);
        return { date: s.date, maxWeight: maxW, volume: totalVol };
      })
      .filter(Boolean);
  }

  function getExerciseMaxWeight(exId) {
    let maxW = 0;
    state.sessions.forEach(s => {
      s.exercises.forEach(ex => {
        if (ex.id === exId && ex.sets) {
          ex.sets.forEach(st => {
            const w = parseFloat(st.weight) || 0;
            if (w > maxW) maxW = w;
          });
        }
      });
    });
    return maxW;
  }

  function calculateE1RM(weight, reps) {
    if (weight <= 0 || reps <= 0) return 0;
    if (reps === 1) return weight;
    // Brzycki formula
    return weight * (36 / (37 - reps));
  }

  function getExerciseMaxE1RM(exId) {
    let maxE1RM = 0;
    state.sessions.forEach(s => {
      s.exercises.forEach(ex => {
        if (ex.id === exId && ex.sets) {
          ex.sets.forEach(st => {
            const w = parseFloat(st.weight) || 0;
            const r = parseInt(st.reps) || 0;
            const e1rm = calculateE1RM(w, r);
            if (e1rm > maxE1RM) maxE1RM = e1rm;
          });
        }
      });
    });
    return maxE1RM;
  }

  function triggerPRConfetti() {
    if (typeof window.confetti !== 'function') return;
    const duration = 2500;
    const end = Date.now() + duration;

    (function frame() {
      window.confetti({
        particleCount: 5,
        angle: 60,
        spread: 55,
        origin: { x: 0 },
        colors: ['#22d3a0', '#4f8ef7', '#f7b731']
      });
      window.confetti({
        particleCount: 5,
        angle: 120,
        spread: 55,
        origin: { x: 1 },
        colors: ['#22d3a0', '#4f8ef7', '#f7b731']
      });

      if (Date.now() < end) {
        requestAnimationFrame(frame);
      }
    }());
  }


  // ============================================
  // DASHBOARD 2.0 — Muskelgruppen-Heatmap
  // ============================================

  const MUSCLE_LABELS = {
    chest:      'Brust',
    front_delt: 'Vordere Schulter',
    side_delt:  'Seitliche Schulter',
    rear_delt:  'Hintere Schulter',
    triceps:    'Trizeps',
    lat:        'Latissimus',
    upper_back: 'Oberer Rücken',
    biceps:     'Bizeps',
    core:       'Core',
    quad:       'Quadrizeps',
    hamstring:  'Hamstrings',
    glute:      'Gesäß',
    calf:       'Waden'
  };

  function getMuscleVolume(days) {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const totals = {};
    Object.keys(MUSCLE_LABELS).forEach(function(m) { totals[m] = 0; });
    state.sessions.forEach(function(s) {
      if (new Date(s.date).getTime() < cutoff) return;
      s.exercises.forEach(function(ex) {
        var map = (typeof MUSCLE_MAP !== 'undefined') ? MUSCLE_MAP[ex.id] : null;
        if (!map) return;
        var doneSets = ex.sets ? ex.sets.filter(function(st) { return st.done || st.reps; }).length : 0;
        if (doneSets === 0) return;
        Object.keys(map).forEach(function(muscle) {
          totals[muscle] = (totals[muscle] || 0) + doneSets * map[muscle];
        });
      });
    });
    return totals;
  }

  function renderMuscleHeatmap(container) {
    if (!container) return;
    if (!state.sessions.length) {
      container.innerHTML = '<p class="empty-state">Noch keine Trainingsdaten.</p>';
      return;
    }
    var vol7  = getMuscleVolume(7);
    var vol28 = getMuscleVolume(28);
    var max28 = Math.max.apply(null, Object.values(vol28).concat([1]));

    var rows = Object.keys(MUSCLE_LABELS).map(function(key) {
      var label = MUSCLE_LABELS[key];
      var v7  = vol7[key]  || 0;
      var v28val = vol28[key] || 0;
      var pct28 = Math.round((v28val / max28) * 100);
      var pct7  = Math.min(Math.round((v7   / max28) * 100), 100);
      var tier = 'heat-0';
      if (pct28 > 0)  tier = 'heat-1';
      if (pct28 > 25) tier = 'heat-2';
      if (pct28 > 50) tier = 'heat-3';
      if (pct28 > 75) tier = 'heat-4';
      var trend = v7 > 0 ? '▲' : '';
      return '<div class="muscle-row">' +
        '<div class="muscle-label">' + label + '</div>' +
        '<div class="muscle-bar-wrap">' +
          '<div class="muscle-bar ' + tier + '" style="width:' + Math.max(pct28, 2) + '%">' +
            '<div class="muscle-bar-7d" style="width:' + pct7 + '%"></div>' +
          '</div>' +
        '</div>' +
        '<div class="muscle-vol">' + (v28val > 0 ? v28val : '–') + ' <span class="muscle-trend">' + trend + '</span></div>' +
        '</div>';
    }).join('');

    container.innerHTML =
      '<div class="muscle-legend">' +
        '<span class="legend-bar legend-28d"></span>28 Tage&nbsp;&nbsp;' +
        '<span class="legend-bar legend-7d"></span>7 Tage' +
      '</div>' + rows;
  }



  // --- Navigation ---
  function switchView(viewId) {
    document.querySelectorAll('.view').forEach(v => v.classList.remove('active'));
    $(viewId).classList.add('active');
    document.querySelectorAll('.nav-item').forEach(n => n.classList.remove('active'));
    const navBtn = document.querySelector(`[data-view="${viewId}"]`);
    if (navBtn) navBtn.classList.add('active');
    state.currentView = viewId;

    // Update header
    const titles = {
      viewDashboard: ['Dashboard', 'PPL-8 Protocol'],
      viewWorkout: ['Workout', ''],
      viewHistory: ['Historie', 'Trainingshistorie'],
      viewSettings: ['Einstellungen', 'Konfiguration']
    };
    const [t, s] = titles[viewId] || ['', ''];
    $('headerTitle').textContent = t;
    $('headerSub').textContent = s;

    if (viewId === 'viewHistory') renderHistory();
    if (viewId === 'viewDashboard') renderDashboard();
  }

  /**
   * Renders the main dashboard view, compiling data for day grid,
   * weekly volume, recent sessions, and various heatmaps.
   */
  function renderDashboard() {
    renderZnsWarning();
    renderDayGrid();
    renderWeeklyVolume();
    renderRecentSessions();
    renderHeatmap();
    try { renderMuscleHeatmap(document.getElementById('muscleHeatmapContainer')); } catch(e) { console.warn('Muscle heatmap:', e); }

  }

  function renderZnsWarning() {
    const container = $('znsWarningContainer');
    if (!container) return;

    // Only warn if ZNS was recorded within the last 36 hours AND value is ≤ 2
    const zns = state.znsBaseline;
    const isRecent = zns && zns.date && (Date.now() - new Date(zns.date).getTime()) < 36 * 3600 * 1000;
    if (isRecent && zns.value <= 2) {
      container.innerHTML = `
        <div class="card" style="background: rgba(240, 84, 84, 0.1); border-color: rgba(240, 84, 84, 0.4); margin-bottom: var(--gap-md);">
          <div style="display:flex; gap:12px; align-items:flex-start;">
            <div style="font-size: 1.5rem; line-height: 1;">⚠️</div>
            <div>
              <h4 style="font-family: var(--font-display); font-size: 0.95rem; color: var(--accent-red); margin-bottom: 4px; text-transform: uppercase; letter-spacing: 0.5px; font-weight: 800;">ZNS Warnung</h4>
              <p style="font-size: 0.82rem; color: var(--text-secondary); line-height: 1.5; margin: 0;">
                ZNS-Readiness aus letzter Session: <strong>${zns.value}/5</strong>.<br>
                Empfehlung: Reduziere heute Volumen und Intensität (z.B. -1 Arbeitssatz, RIR +1).
              </p>
            </div>
          </div>
        </div>
      `;
    } else {
      container.innerHTML = '';
    }
  }

  // Populates the Settings view fields from current state.
  // Called once on init() and after saveBaseline() — never from renderDashboard().
  function populateSettingsForm() {
    $('settingHeight').value = state.athlete.height;
    $('settingWeight').value = state.athlete.weight;
    $('settingBF').value = state.athlete.bodyFat;
    if (state.lastBackup) {
      $('lastBackup').innerHTML = `<small>Letztes Backup: ${formatDate(state.lastBackup)}</small>`;
    }
  }

  function renderDayGrid() {
    const days = getDays(state.currentCycle);
    const grid = $('dayGrid');
    grid.innerHTML = days.map((d, i) => `
    <div class="day-card ${d.type === 'rest' ? 'rest' : ''}" data-action="openWorkout" data-cycle="${esc(state.currentCycle)}" data-day="${i}">
      <div class="day-number">Tag ${d.day}</div>
      <div class="day-name">${esc(d.name)}</div>
      <div class="day-detail">${esc(d.subtitle)}</div>
      <div class="day-exercises">${d.exercises.length} Übung${d.exercises.length !== 1 ? 'en' : ''}</div>
    </div>
  `).join('');
  }

  function renderHeatmap() {
    const container = $('heatmapContainer');
    if (!container) return;

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const targetDays = 91;

    // Create an array for the last 91 days
    const daysArr = [];
    for (let i = targetDays - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setDate(d.getDate() - i);

      // format to local string instead of ISO to prevent timezone shift issues
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      const dayStr = String(d.getDate()).padStart(2, '0');
      const dateStr = `${y}-${m}-${dayStr}`;

      daysArr.push({ date: d, dateStr: dateStr });
    }

    // Determine the day of the week for the very first calendar day in our array.
    // getDay() is 0 (Sunday) to 6 (Saturday).
    // Our CSS grid-template-rows: repeat(7, 1fr) with auto-flow: column 
    // means it fills Top->Bottom, Left->Right.
    // If we want row 0 to be Sunday, row 1 Monday, etc., we must pad 
    // the very first column with empty cells, so the first actual day falls on the correct row.
    const firstDayOfWeek = daysArr[0].date.getDay(); 

    const finalCells = [];
    for (let i = 0; i < firstDayOfWeek; i++) {
        finalCells.push(null); // padding for top rows of the first column
    }
    daysArr.forEach(d => finalCells.push(d));

    const sessionMap = {};
    state.sessions.forEach(s => {
      const sd = new Date(s.date);
      const y = sd.getFullYear();
      const m = String(sd.getMonth() + 1).padStart(2, '0');
      const dayStr = String(sd.getDate()).padStart(2, '0');
      const dStr = `${y}-${m}-${dayStr}`;
      sessionMap[dStr] = (sessionMap[dStr] || 0) + 1;
    });

    let html = '';
    finalCells.forEach(day => {
      if (!day) {
        // Invisible padding cell
        html += `<div class="heatmap-square" style="background: transparent; box-shadow: none;"></div>`;
        return;
      }
      
      const count = sessionMap[day.dateStr] || 0;
      let level = 0;
      if (count === 1) level = 1;
      if (count >= 2) level = 2;
      const tooltip = `${day.date.toLocaleDateString('de-DE')} - ${count} Workout(s)`;
      html += `<div class="heatmap-square level-${level}" title="${tooltip}"></div>`;
    });

    container.innerHTML = html;

    setTimeout(() => {
      container.scrollLeft = container.scrollWidth;
    }, 10);
  }

  function renderWeeklyVolume() {
    const container = $('weeklyVolumeContainer');
    if (!container) return;

    const now = new Date();
    // Get sessions from the last 7 days
    const recentSessions = state.sessions.filter(s => {
      const d = new Date(s.date);
      const diff = (now - d) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    });

    let volPush = 0, volPull = 0, volLegs = 0;

    recentSessions.forEach(s => {
      const type = s.type; // "push", "pull", "legs"
      let totalVol = 0;
      s.exercises.forEach(ex => {
        if (ex.noTracking) return;
        ex.sets.forEach(st => {
          const w = parseFloat(st.weight) || 0;
          const r = parseInt(st.reps) || 0;
          totalVol += (w * r);
        });
      });

      if (type === 'push') volPush += totalVol;
      if (type === 'pull') volPull += totalVol;
      if (type === 'legs') volLegs += totalVol;
    });

    container.innerHTML = `
      <div class="vol-stat">
        <div class="vol-val">${(volPush / 1000).toFixed(1)}t</div>
        <div class="vol-label">Push</div>
      </div>
      <div class="vol-stat">
        <div class="vol-val">${(volPull / 1000).toFixed(1)}t</div>
        <div class="vol-label">Pull</div>
      </div>
      <div class="vol-stat">
        <div class="vol-val">${(volLegs / 1000).toFixed(1)}t</div>
        <div class="vol-label">Legs</div>
      </div>
    `;
  }

  function renderRecentSessions() {
    const list = $('recentList');
    if (!state.sessions.length) {
      list.innerHTML = '<p class="empty-state">Noch keine Trainings aufgezeichnet.</p>';
      return;
    }
    const recent = state.sessions.slice(-5).reverse();
    list.innerHTML = recent.map(s => `
    <div class="recent-item" data-action="showSession" data-id="${esc(s.id)}">
      <div class="recent-dot ${esc(s.type)}"></div>
      <div class="recent-info">
        <strong>${esc(s.dayName)}</strong>
        <small>${s.exercises.length} Übungen • ${s.duration || '--'} Min</small>
      </div>
      <div class="recent-time">${formatDate(s.date)}</div>
    </div>
  `).join('');
  }

  // Branded confirm dialog — avoids native browser confirm() which blocks thread and breaks iOS design
  function showConfirm(message, onConfirm, onCancel, { confirmLabel = 'Ja', cancelLabel = 'Abbrechen' } = {}) {
    $('modalContent').innerHTML = `
      <div class="modal-header">
        <h3>Hinweis</h3>
      </div>
      <div class="modal-body">
        <p style="font-size:0.9rem;line-height:1.55;color:var(--text-secondary);margin-bottom:var(--gap-md);">${message}</p>
        <div style="display:flex;gap:var(--gap-sm);justify-content:flex-end;">
          <button class="btn btn-outline btn-sm" id="confirmCancel">${cancelLabel}</button>
          <button class="btn btn-primary btn-sm" id="confirmOk">${confirmLabel}</button>
        </div>
      </div>
    `;
    show($('modalOverlay')); focusFirstIn($('modalOverlay'));
    $('confirmOk').addEventListener('click', () => { hide($('modalOverlay')); onConfirm(); });
    $('confirmCancel').addEventListener('click', () => { hide($('modalOverlay')); if (onCancel) onCancel(); });
  }

  // --- Workout View ---
  function openWorkout(cycle, dayIndex) {
    const days = getDays(cycle);
    const day = days[dayIndex];

    // Draft check — uses branded modal instead of native confirm()
    if (state.activeSession) {
      if (state.activeSession.cycle === cycle && state.activeSession.dayIndex === dayIndex) {
        showConfirm(
          'Es existiert ein ungespeichertes Training als Entwurf. Möchtest du es fortsetzen?',
          () => resumeWorkout(cycle, dayIndex),
          () => { state.activeSession = null; openWorkout(cycle, dayIndex); },
          { confirmLabel: 'Fortsetzen', cancelLabel: 'Neu starten' }
        );
        return;
      } else {
        showConfirm(
          'Es gibt ein anderes ungespeichertes Training. Möchtest du es verwerfen und ein neues starten?',
          () => { state.activeSession = null; openWorkout(cycle, dayIndex); },
          null,
          { confirmLabel: 'Verwerfen & neu', cancelLabel: 'Abbrechen' }
        );
        return;
      }
    }

    state.activeSession = {
      id: (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now().toString(),
      date: new Date().toISOString(),
      cycle: cycle,
      dayIndex: dayIndex,
      dayName: `Tag ${day.day}: ${day.name}`,
      type: day.type,
      exercises: day.exercises.map(ex => {
        if (ex.noTracking) {
          return { id: ex.id, name: ex.name, noTracking: true, done: false, notes: '' };
        }
        const numSets = ex.unilateral ? ex.sets * 2 : ex.sets;
        const suggestedWeights = getSuggestedWeights(ex.id);
        const lastSetup = getLastSetup(ex.id);
        const hasAdjustment = suggestedWeights && suggestedWeights.some(s => s._adjusted !== '');
        return {
          id: ex.id,
          name: ex.name,
          unilateral: !!ex.unilateral,
          setup: lastSetup,
          feedbackAdjusted: !!hasAdjustment,
          sets: Array.from({ length: numSets }, (_, si) => {
            const prevW = suggestedWeights && suggestedWeights[si] ? suggestedWeights[si].weight : '';
            return { weight: prevW, reps: '', rir: '', notes: '', done: false, feedback: '' };
          })
        };
      }),
      duration: null
    };

    // Render header
    $('workoutTitle').textContent = `Tag ${day.day}: ${day.name}`;
    $('workoutSubtitle').textContent = day.subtitle;

    // Render warmup
    renderWarmup(day.type);

    // Render exercises
    renderExercises(day);

    // Start timer
    state.workoutStartTime = Date.now();
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.workoutStartTime) / 1000);
      $('timerDisplay').textContent = formatTime(elapsed);
    }, 1000);

    switchView('viewWorkout');
    hide($('bottomNav'));
    window.history.pushState({ modal: 'workout' }, '');
    requestWakeLock();
    saveState();

    // Nutrition Reminder: show if Milon day (has Milon exercises)
    const hasMilon = day.exercises.some(e => e.name && e.name.toLowerCase().includes('milon'));
    if (hasMilon) showNutritionReminder();
  }

  function resumeWorkout(cycle, dayIndex) {
    const days = getDays(cycle);
    const day = days[dayIndex];

    $('workoutTitle').textContent = state.activeSession.dayName;
    $('workoutSubtitle').textContent = day.subtitle;

    renderWarmup(state.activeSession.type);
    renderExercises(day);

    // Recover timer
    if (!state.workoutStartTime) state.workoutStartTime = Date.now();
    if (state.timerInterval) clearInterval(state.timerInterval);
    state.timerInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - state.workoutStartTime) / 1000);
      $('timerDisplay').textContent = formatTime(elapsed);
    }, 1000);

    // Initial stats render
    state.activeSession.exercises.forEach((ex, i) => {
      if (!ex.noTracking) updateLiveStats(i);
    });

    switchView('viewWorkout');
    hide($('bottomNav'));
    window.history.pushState({ modal: 'workout' }, '');
    requestWakeLock();
  }

  // ============================================
  // NUTRITION TIMING REMINDER
  // Shown when opening a Milon workout day
  // ============================================
  function showNutritionReminder() {
    // Only show once per session (don't spam on resume)
    if (state._nutritionReminderShown) return;
    state._nutritionReminderShown = true;

    $('modalContent').innerHTML = `
      <div class="modal-header">
        <h3>🦴 Sehnen-Timing</h3>
        <button class="btn-close" data-action="closeOverlay">&times;</button>
      </div>
      <div class="modal-body">
        <div class="nutrition-reminder-card">
          <div class="nutr-row">
            <span class="nutr-icon">⏱</span>
            <div>
              <div class="nutr-title">45–60 Min vor dem Training</div>
              <div class="nutr-sub">Jetzt einnehmen für optimale Kollagen-Synthese</div>
            </div>
          </div>
          <div class="nutr-items">
            <div class="nutr-item">
              <span class="nutr-badge">15g</span>
              <span>Kollagen-Peptide</span>
            </div>
            <div class="nutr-item">
              <span class="nutr-badge">50mg</span>
              <span>Vitamin C</span>
            </div>
          </div>
          <p class="nutr-note">Vitamin C als Kofaktor für Kollagen-Crosslinking. Milon-Exzentrik maximiert den Sehnen-Remodeling-Reiz.</p>
        </div>
        <button class="btn btn-primary" style="width:100%;margin-top:12px;" data-action="closeOverlay">
          Verstanden – Training starten
        </button>
      </div>
    `;
    show($('modalOverlay')); focusFirstIn($('modalOverlay'));
    window.history.pushState({ modal: 'overlay' }, '');
  }

  function renderWarmup(type) {
    const protocol = (type === 'push' || type === 'pull') ? PRE_ACTIVATION.pushPull : PRE_ACTIVATION.legs;
    if (type === 'rest') {
      hide($('warmupCard'));
      return;
    }
    show($('warmupCard'));

    const body = $('warmupBody');
    body.innerHTML = `
    <p style="font-size:0.78rem;color:var(--text-muted);margin-bottom:8px;padding:0 4px;">${protocol.title}</p>
    ${protocol.exercises.map((ex, i) => `
      <div class="warmup-exercise">
        <div class="warmup-num">${i + 1}</div>
        <div class="warmup-info">
          <h4>${ex.name}</h4>
          <p>${ex.sets} — ${ex.detail}</p>
          ${ex.timer ? `<button class="warmup-timer-btn" data-action="startTimer" data-seconds="${ex.timer}">⏱ ${ex.timer} Sek. Timer</button>` : ''}
        </div>
      </div>
    `).join('')}
  `;
  }

  function renderExercises(day) {
    const list = $('exerciseList');
    const htmlParts = day.exercises.map((ex, i) => {
      const sessionEx = state.activeSession.exercises[i];
      const isNoTrack = !!ex.noTracking;
      const isUni = !!ex.unilateral;

      // --- No-Tracking exercises (Cardio, Sauna, Mobility, etc.) ---
      if (isNoTrack) {
        return `
    <div class="exercise-card ${sessionEx.done ? 'completed' : ''}" id="exCard_${i}">
      <div class="exercise-header" data-action="toggleExercise" data-idx="${i}">
        <div class="exercise-num" style="background:linear-gradient(135deg,var(--accent-green),var(--accent-cyan))">${i + 1}</div>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}</div>
          <div class="exercise-meta">${ex.reps}</div>
        </div>
        <div class="exercise-actions">
          <button class="btn-info" data-action="showExInfo" data-id="${ex.id}" title="Info">ℹ️</button>
        </div>
      </div>
      <div class="exercise-body hidden" id="exBody_${i}">
        ${ex.note ? `<p style="font-size:0.78rem;color:var(--accent-amber);margin-bottom:8px;padding:4px 8px;background:rgba(245,158,11,0.08);border-radius:6px;">📌 ${ex.note}</p>` : ''}
        <div class="activity-check-row">
          <button class="btn ${sessionEx.done ? 'btn-success' : 'btn-outline'} btn-sm" data-action="toggleActivityDone" data-idx="${i}">
            ${sessionEx.done ? '✅ Erledigt' : '⭕ Als erledigt markieren'}
          </button>
        </div>
        <div class="set-notes" style="margin-top:8px">
          <input type="text" class="input-field" placeholder="Notizen..." id="notes_${i}"
            value="${sessionEx.notes || ''}"
            data-action="updateExNotes" data-idx="${i}">
        </div>
      </div>
    </div>
  `;
      }

      // --- Regular tracked exercises ---
      const numSets = sessionEx.sets.length;

      let recommendOverload = false;
      const cachedSets = getLastWeights(ex.id);
      if (cachedSets && cachedSets.length > 0) {
        const targetRepsMatch = ex.reps.match(/(\d+)(?:\/[^\d]*)?$/);
        const targetReps = targetRepsMatch ? parseInt(targetRepsMatch[1]) : 0;
        if (targetReps > 0) {
          for (let s of cachedSets) {
            const dReps = parseInt(s.reps) || 0;
            const dRir = parseInt(s.rir);
            if (dReps >= targetReps && (isNaN(dRir) || dRir >= 1)) {
              recommendOverload = true;
              break;
            }
          }
        }
      }

      return `
    <div class="exercise-card" id="exCard_${i}">
      <div class="exercise-header" data-action="toggleExercise" data-idx="${i}">
        <div class="exercise-num">${i + 1}</div>
        <div class="exercise-info">
          <div class="exercise-name">${ex.name}${isUni ? ' <span style="font-size:0.7rem;color:var(--accent-cyan)">(pro Arm)</span>' : ''}</div>
          <div class="exercise-meta">
            ${ex.sets}x ${ex.reps} ${ex.tempo ? `<span class="tempo-tag">${ex.tempo}</span>` : ''}
            ${(() => { const pl = getProgressionLabel(ex.id); return pl ? `<span class="prog-badge ${pl.cls}" title="Doppel-Progression">${pl.text}</span>` : ''; })()}
            ${recommendOverload && !getProgressionLabel(ex.id) ? `<span class="overload-tag" title="Gewicht erhöhen!">🔥 Overload</span>` : ''}
            <span id="stats_${i}" class="exercise-live-stats" style="color:var(--accent-green);font-size:0.7rem;margin-left:6px;font-weight:700;"></span>
          </div>
        </div>
        <div class="exercise-actions">
          <button class="btn-info" data-action="showExInfo" data-id="${ex.id}" title="Ausführung">ℹ️</button>
          <button class="btn-info" data-action="showExChart" data-id="${ex.id}" title="Fortschritt">📈</button>
        </div>
      </div>
      <div class="exercise-body hidden" id="exBody_${i}">
        ${ex.note ? `<p style="font-size:0.78rem;color:var(--accent-amber);margin-bottom:8px;padding:4px 8px;background:rgba(245,158,11,0.08);border-radius:6px;">📌 ${ex.note}</p>` : ''}
        
        <div class="exercise-setup">
          <label class="setup-label">Geräte-Setup / Sitz Position</label>
          <input type="text" class="input-field input-setup" placeholder="z.B. Sitz 4, Winkel 30°, Pin 3..." value="${sessionEx.setup || ''}" data-action="updateExSetup" data-idx="${i}">
        </div>

        ${(() => {
          const isBW = !!ex.isBodyweightOnly;
          if (isUni) {
            // Unilateral: render pairs (L + R) side by side for each set number
            return Array.from({ length: ex.sets }, (_, pairIdx) => {
              const lSi = pairIdx;
              const rSi = pairIdx + ex.sets;
              const lSet = sessionEx.sets[lSi] || {};
              const rSet = sessionEx.sets[rSi] || {};
              const lPrefill = lSet.weight || '';
              const rPrefill = rSet.weight || '';

              const renderInputGroup = (label, siIdx, side) => `
                <div class="uni-side">
                  <div class="uni-side-label">${side}</div>
                  ${!isBW ? `<div class="set-input-group">
                    <label aria-label="Gewicht ${side === 'L' ? 'links' : 'rechts'}">KG</label>
                    <input type="number" class="input-field input-sm" id="w_${i}_${siIdx}" inputmode="decimal"
                      value="${side === 'L' ? lPrefill : rPrefill}"
                      data-field="weight" data-ex="${i}" data-si="${siIdx}">
                  </div>` : ''}
                  <div class="set-input-group">
                    <label>REPS</label>
                    <input type="number" class="input-field input-sm" id="r_${i}_${siIdx}" inputmode="numeric"
                      value="${side === 'L' ? (lSet.reps || '') : (rSet.reps || '')}"
                      data-field="reps" data-ex="${i}" data-si="${siIdx}">
                  </div>
                  ${!isBW ? `<div class="set-input-group">
                    <label>RIR</label>
                    <input type="number" class="input-field input-sm" id="rir_${i}_${siIdx}" inputmode="numeric" min="0" max="5"
                      value="${side === 'L' ? (lSet.rir || '') : (rSet.rir || '')}"
                      data-field="rir" data-ex="${i}" data-si="${siIdx}">
                  </div>` : ''}
                </div>
              `;

              return `
                <div class="set-row set-row-uni">
                  <div class="set-label">S${pairIdx + 1}</div>
                  <div class="uni-pair">
                    ${renderInputGroup('L', lSi, 'L')}
                    <div class="uni-divider"></div>
                    ${renderInputGroup('R', rSi, 'R')}
                  </div>
                  <div class="set-check-col">
                    <button class="set-check" id="chk_${i}_${lSi}" data-action="toggleSetDone" data-ex="${i}" data-si="${lSi}">✓</button>
                  </div>
                </div>
              `;
            }).join('');
          } else {
            return Array.from({ length: numSets }, (_, si) => {
              const prefillW = sessionEx.sets[si].weight || '';
              return `
                <div class="set-row">
                  <div class="set-label">S${si + 1}</div>
                  <div class="set-inputs">
                    ${!isBW ? `<div class="set-input-group">
                      <label>KG</label>
                      <div class="weight-prefill-wrap">
                        <input type="number" class="input-field input-sm" id="w_${i}_${si}" inputmode="decimal"
                          value="${prefillW}"
                          data-field="weight" data-ex="${i}" data-si="${si}">
                      </div>
                    </div>` : ''}
                    <div class="set-input-group">
                      <label>REPS</label>
                      <input type="number" class="input-field input-sm" id="r_${i}_${si}" inputmode="numeric"
                        value="${sessionEx.sets[si].reps || ''}"
                        data-field="reps" data-ex="${i}" data-si="${si}">
                    </div>
                    ${!isBW ? `<div class="set-input-group">
                      <label>RIR</label>
                      <input type="number" class="input-field input-sm" id="rir_${i}_${si}" inputmode="numeric" min="0" max="5"
                        value="${sessionEx.sets[si].rir || ''}"
                        data-field="rir" data-ex="${i}" data-si="${si}">
                    </div>` : ''}
                    <div class="set-input-group feedback-group">
                      <label>NEXT</label>
                      <div class="feedback-btns">
                        <button class="fb-btn fb-up" id="fb_up_${i}_${si}" data-action="feedback-up" data-ex="${i}" data-si="${si}" title="Nächstes Mal erhöhen">▲</button>
                        <button class="fb-btn fb-down" id="fb_dn_${i}_${si}" data-action="feedback-down" data-ex="${i}" data-si="${si}" title="Nächstes Mal senken">▼</button>
                      </div>
                    </div>
                  </div>
                  <button class="set-check" id="chk_${i}_${si}" data-action="toggleSetDone" data-ex="${i}" data-si="${si}">✓</button>
                </div>
              `;
            }).join('');
          }
        })()}
        <div class="set-notes">
          <input type="text" class="input-field" placeholder="Notizen..." id="notes_${i}"
            value="${sessionEx.notes || ''}"
            data-action="updateExNotes" data-idx="${i}">
        </div>
      </div>
    </div>
  `});
    // Use DocumentFragment to prevent multiple reflows
    const frag = document.createDocumentFragment();
    const tmp = document.createElement('div');
    tmp.innerHTML = htmlParts.join('');
    while (tmp.firstChild) frag.appendChild(tmp.firstChild);
    list.innerHTML = '';
    list.appendChild(frag);

    // Mark prefilled weight inputs — CSS attribute selectors don't pick up JS-set values reliably
    list.querySelectorAll('input.input-sm[id^="w_"]').forEach(input => {
      input.classList.toggle('has-value', input.value !== '');
      input.addEventListener('input', () => input.classList.toggle('has-value', input.value !== ''), { passive: true });
    });
  }

  function toggleExercise(idx) {
    // Accordion: close others
    if (state.activeSession) {
      state.activeSession.exercises.forEach((_, i) => {
        if (i !== idx) {
          const otherBody = $(`exBody_${i}`);
          if (otherBody && !otherBody.classList.contains('hidden')) {
            otherBody.classList.add('hidden');
          }
        }
      });
    }

    const body = $(`exBody_${idx}`);
    body.classList.toggle('hidden');
  }

  function updateSet(exIdx, setIdx, field, value) {
    if (state.activeSession) {
      state.activeSession.exercises[exIdx].sets[setIdx][field] = value;
      debouncedSave();

      // Update RIR Color class
      if (field === 'rir') {
        const input = $(`rir_${exIdx}_${setIdx}`);
        input.classList.remove('rir-red', 'rir-orange', 'rir-yellow');
        const rirVal = parseInt(value);
        if (!isNaN(rirVal)) {
          if (rirVal === 0) input.classList.add('rir-red');
          else if (rirVal === 1) input.classList.add('rir-orange');
          else if (rirVal >= 2 && rirVal <= 3) input.classList.add('rir-yellow');
        }
      }

      if (field === 'weight' || field === 'reps') {
        updateLiveStats(exIdx);
      }
    }
  }

  function updateLiveStats(exIdx) {
    if (!state.activeSession) return;
    const ex = state.activeSession.exercises[exIdx];
    let vol = 0;
    ex.sets.forEach(s => {
      const w = parseFloat(s.weight) || 0;
      const r = parseInt(s.reps) || 0;
      if (w > 0 && r > 0) {
        vol += (w * r);
      }
    });

    const el = $(`stats_${exIdx}`);
    if (el) {
      el.innerHTML = vol > 0 ? `&Sigma; ${Math.round(vol)} kg` : '';
    }
  }

  function setFeedback(exIdx, setIdx, direction) {
    if (!state.activeSession) return;
    const set = state.activeSession.exercises[exIdx].sets[setIdx];
    set.feedback = set.feedback === direction ? '' : direction;
    const upBtn = $(`fb_up_${exIdx}_${setIdx}`);
    const dnBtn = $(`fb_dn_${exIdx}_${setIdx}`);
    upBtn.classList.toggle('active', set.feedback === 'up');
    dnBtn.classList.toggle('active', set.feedback === 'down');
    debouncedSave();
  }

  function updateExNotes(exIdx, value) {
    if (state.activeSession) {
      state.activeSession.exercises[exIdx].notes = value;
      debouncedSave();
    }
  }

  function updateExSetup(exIdx, value) {
    if (state.activeSession) {
      state.activeSession.exercises[exIdx].setup = value;
      debouncedSave();
    }
  }

  function toggleSetDone(exIdx, setIdx) {
    if (!state.activeSession) return;
    const ex = state.activeSession.exercises[exIdx];
    const isUni = ex.unilateral;
    
    let isDoneNow = false;
    if (isUni) {
      const half = ex.sets.length / 2;
      const lSi = setIdx < half ? setIdx : setIdx - half;
      const rSi = lSi + half;
      const newState = !ex.sets[lSi].done;
      ex.sets[lSi].done = newState;
      if (ex.sets[rSi]) ex.sets[rSi].done = newState;
      isDoneNow = newState;
    } else {
      const set = ex.sets[setIdx];
      set.done = !set.done;
      isDoneNow = set.done;
    }

    const btnId = isUni ? `chk_${exIdx}_${setIdx < ex.sets.length / 2 ? setIdx : setIdx - ex.sets.length / 2}` : `chk_${exIdx}_${setIdx}`;
    const btn = $(btnId);
    if (btn) btn.classList.toggle('checked', isDoneNow);

    // Auto-Rest Timer & Confetti
    if (isDoneNow) {
      // Haptic feedback on set complete
      if (navigator.vibrate) navigator.vibrate(50);
      const planEx = [...getPlan().cycleA, ...getPlan().cycleB]
        .flatMap(d => d.exercises)
        .find(e => e.id === state.activeSession.exercises[exIdx].id);
      
      // PR Check (e1RM)
      if (!state.activeSession.exercises[exIdx].noTracking && !planEx.isBodyweightOnly) {
         const setInfo = ex.sets[setIdx];
         const w = parseFloat(setInfo.weight) || 0;
         const r = parseInt(setInfo.reps) || 0;
         const setE1RM = calculateE1RM(w, r);
         const historicMaxE1RM = getExerciseMaxE1RM(state.activeSession.exercises[exIdx].id);
         
         // Only trigger if we have some historic data AND this set beats the strict previous max
         // AND it's a relatively meaningful weight/reps combination.
         if (historicMaxE1RM > 0 && setE1RM > historicMaxE1RM && w > 0 && r > 0) {
            triggerPRConfetti();
            toast(`🎉 Neuer PR! Geschätztes 1RM: ${setE1RM.toFixed(1)} kg`);
         }
      }

      const restSeconds = (planEx && planEx.restSeconds) || DEFAULT_REST_SECONDS;
      startRestTimer(restSeconds);
    } else {
      closeRestTimer();
    }

    // Check if all sets of exercise are done
    const allDone = state.activeSession.exercises[exIdx].sets.every(s => s.done);
    const card = $(`exCard_${exIdx}`);
    if (card) card.classList.toggle('completed', allDone);
    debouncedSave();
  }

  function toggleActivityDone(exIdx) {
    if (!state.activeSession) return;
    const ex = state.activeSession.exercises[exIdx];
    ex.done = !ex.done;
    const card = $(`exCard_${exIdx}`);
    card.classList.toggle('completed', ex.done);

    // Update the button inside the card without full re-render
    const btnRow = card.querySelector('.activity-check-row .btn');
    if (btnRow) {
      if (ex.done) {
        btnRow.className = 'btn btn-success btn-sm';
        btnRow.textContent = '✅ Erledigt';
      } else {
        btnRow.className = 'btn btn-outline btn-sm';
        btnRow.textContent = '⭕ Als erledigt markieren';
      }
    }
    debouncedSave();
  }

  function openFinishModal() {
    if (!state.activeSession) return;
    show($('finishModal')); focusFirstIn($('finishModal'));
    window.history.pushState({ modal: 'finish' }, '');
  }

  function confirmFinishWorkout() {
    if (!state.activeSession) return;
    
    // Capture RPE and ZNS
    const rpe = parseFloat($('sessionRpeSlider').value) || 8;
    const zns = parseInt($('znsSlider').value) || 3;
    state.activeSession.sessionRpe = rpe;
    state.activeSession.znsReadiness = zns;
    
    // Set global baseline ZNS to last captured (with timestamp for expiry check)
    state.znsBaseline = { value: zns, date: new Date().toISOString() };

    hide($('finishModal'));

    if (state.timerInterval) clearInterval(state.timerInterval);
    closeRestTimer();
    releaseWakeLock();

    // Save to history
    const elapsed = Math.floor((Date.now() - state.workoutStartTime) / 60000);
    state.activeSession.duration = elapsed;
    state.sessions.push(state.activeSession);
    saveState();

    // Clear active state
    state.activeSession = null;
    state.workoutStartTime = null;
    state._nutritionReminderShown = false;

    show($('bottomNav'));
    switchView('viewDashboard');
    toast(`Training gespeichert! (${elapsed} Min)`);

    // Auto-push to Gist if configured
    if (gistGetToken() && gistGetId()) {
      setTimeout(() => gistPush(), 800);
    }
  }

  function backFromWorkout() {
    // Just pause timer but keep the session alive as a draft
    if (state.timerInterval) clearInterval(state.timerInterval);
    releaseWakeLock();
    flushSave(); // Ensure the draft is synced to localStorage

    show($('bottomNav'));
    switchView('viewDashboard');
    toast('Als Entwurf gespeichert 📝');
  }

  // --- Timer ---
  function startTimer(seconds, btn) {
    let remaining = seconds;
    btn.disabled = true;
    btn.textContent = `⏱ ${remaining} Sek.`;
    const iv = setInterval(() => {
      remaining--;
      btn.textContent = `⏱ ${remaining} Sek.`;
      if (remaining <= 0) {
        clearInterval(iv);
        btn.textContent = '✅ Fertig!';
        btn.disabled = false;
        if (navigator.vibrate) navigator.vibrate(200);
        setTimeout(() => { btn.textContent = `⏱ ${seconds} Sek. Timer`; }, 2000);
      }
    }, 1000);
  }

  // --- Rest Timer (thread-safe, Date.now() based) ---
  let _restTimerEnd = null;
  let _restTimerRAF = null;

  function startRestTimer(seconds) {
    const card = document.getElementById('floatingRestTimer');
    if (!card) return;
    _restTimerEnd = Date.now() + seconds * 1000;
    card.classList.remove('hidden');

    function tick() {
      const remaining = Math.max(0, Math.ceil((_restTimerEnd - Date.now()) / 1000));
      const display = document.getElementById('restTimerDisplay');
      const bar = document.getElementById('restTimerBar');
      if (display) display.textContent = formatTime(remaining);
      if (bar) bar.style.width = ((remaining / seconds) * 100) + '%';
      if (remaining <= 0) {
        if (navigator.vibrate) navigator.vibrate([200, 100, 200]);
        _restTimerRAF = null;
        card.classList.add('hidden');
        return;
      }
      _restTimerRAF = requestAnimationFrame(tick);
    }
    if (_restTimerRAF) cancelAnimationFrame(_restTimerRAF);
    _restTimerRAF = requestAnimationFrame(tick);
  }

  function closeRestTimer() {
    if (_restTimerRAF) { cancelAnimationFrame(_restTimerRAF); _restTimerRAF = null; }
    _restTimerEnd = null;
    const card = document.getElementById('floatingRestTimer');
    if (card) card.classList.add('hidden');
  }

  // --- Exercise Info Modal ---
  function showExInfo(exId) {
    const allExercises = [...getPlan().cycleA, ...getPlan().cycleB].flatMap(d => d.exercises);
    const ex = allExercises.find(e => e.id === exId);
    if (!ex) return;

    $('infoModalTitle').textContent = ex.name;
    $('infoModalBody').innerHTML = `
    <p><strong>Sets × Reps:</strong> ${ex.sets}x ${ex.reps}${ex.tempo ? ` | Tempo: ${ex.tempo}` : ''}</p>
    ${ex.note ? `<div class="tip-box">📌 ${ex.note}</div>` : ''}
    <h4>Korrekte Ausführung</h4>
    <p>${ex.guide}</p>
    ${ex.acl_warning ? `<div class="warning-box">⚠️ ACL/Kapsel-Schutz: ROM zwingend 2-3cm vor der Endgradigkeit limitieren!</div>` : ''}
  `;
    show($('infoModal')); focusFirstIn($('infoModal'));
    window.history.pushState({ modal: 'info' }, '');
  }

  // --- History ---
  // Current history tab state
  let _histTab = 'sessions'; // 'sessions' | 'charts' | 'prs'

  function renderHistory() {
    const stats = $('historyStats');

    const totalSessions = state.sessions.length;
    const totalVolume = state.sessions.reduce((acc, s) => {
      return acc + s.exercises.reduce((a, ex) => {
        if (ex.noTracking || !ex.sets) return a;
        return a + ex.sets.reduce((a2, set) => a2 + (parseFloat(set.weight || 0) * parseInt(set.reps || 0)), 0);
      }, 0);
    }, 0);
    const thisWeek = state.sessions.filter(s => {
      const d = new Date(s.date);
      const diff = (new Date() - d) / (1000 * 60 * 60 * 24);
      return diff <= 7;
    }).length;

    stats.innerHTML = `
      <div class="stat-card"><div class="stat-value">${totalSessions}</div><div class="stat-label">Trainings</div></div>
      <div class="stat-card"><div class="stat-value">${thisWeek}</div><div class="stat-label">Diese Woche</div></div>
      <div class="stat-card"><div class="stat-value">${(totalVolume / 1000).toFixed(1)}t</div><div class="stat-label">Volumen</div></div>
    `;

    renderHistoryTab(_histTab);
  }

  function renderHistoryTab(tab) {
    _histTab = tab;
    const list = $('historyList');

    // Update tab buttons
    document.querySelectorAll('.hist-tab').forEach(btn => {
      btn.classList.toggle('active', btn.dataset.tab === tab);
    });

    if (!state.sessions.length) {
      list.innerHTML = '<p class="empty-state">Noch keine Trainings aufgezeichnet.</p>';
      return;
    }

    if (tab === 'sessions') {
      list.innerHTML = state.sessions.slice().reverse().map(s => {
        const rpeHtml = s.sessionRpe ? `<span class="history-item-stat">RPE <strong>${s.sessionRpe}</strong></span>` : '';
        const znsHtml = s.znsReadiness ? `<span class="history-item-stat">ZNS <strong>${s.znsReadiness}</strong></span>` : '';
        return `
        <div class="history-item" data-action="showSession" data-id="${esc(s.id)}">
          <div class="history-item-header">
            <h4>${esc(s.dayName)}</h4>
            <span class="history-date">${formatDate(s.date)}</span>
          </div>
          <div class="history-item-stats">
            <span class="history-item-stat history-dot ${s.type}"></span>
            <span class="history-item-stat"><strong>${s.exercises.length}</strong> Übungen</span>
            <span class="history-item-stat"><strong>${s.duration || '--'}</strong> Min</span>
            ${rpeHtml}
            ${znsHtml}
          </div>
        </div>`;
      }).join('');

    } else if (tab === 'charts') {
      list.innerHTML = '<div id="progressCharts"></div>';
      renderProgressCharts($('progressCharts'));

    } else if (tab === 'prs') {
      // Full PR table per exercise
      const allExs = [...getPlan().cycleA, ...getPlan().cycleB].flatMap(d => d.exercises)
        .filter(e => !e.noTracking && !e.isBodyweightOnly);

      const rows = allExs.map(ex => {
        const maxW = getExerciseMaxWeight(ex.id);
        const hist = getExerciseHistory(ex.id);
        const sessions = hist.length;
        if (!sessions) return '';
        return `
          <div class="pr-table-row" data-action="showExChart" data-id="${esc(ex.id)}">
            <div class="pr-table-name">${esc(ex.name)}</div>
            <div class="pr-table-stats">
              <span class="pr-stat-pill">${maxW > 0 ? maxW + ' kg Max' : '–'}</span>
              <span class="pr-stat-sub">${sessions} Session${sessions !== 1 ? 's' : ''}</span>
            </div>
          </div>`;
      }).filter(Boolean).join('');

      list.innerHTML = rows || '<p class="empty-state">Noch keine Gewichtsdaten erfasst.</p>';
    }
  }

  // --- Progress Charts ---
  function renderProgressCharts(container) {
    // Collect all unique exercise IDs that have data
    const exerciseMap = new Map();
    state.sessions.forEach(s => {
      s.exercises.forEach(ex => {
        if (ex.noTracking || !ex.sets) return;
        if (!exerciseMap.has(ex.id)) exerciseMap.set(ex.id, ex.name);
      });
    });

    if (exerciseMap.size === 0) {
      container.innerHTML = '';
      return;
    }

    // Build selector + chart area
    const exerciseOptions = Array.from(exerciseMap.entries())
      .map(([id, name]) => `<option value="${id}">${name}</option>`).join('');

    container.innerHTML = `
        <div class="card card-chart">
          <div class="card-header">
            <span class="card-icon">📈</span>
            <h3>Fortschritt</h3>
          </div>
          <div class="chart-controls">
            <select id="chartExerciseSelect" class="input-field" style="font-size:0.83rem;">
              ${exerciseOptions}
            </select>
            <div class="chart-toggle">
              <button class="chart-tab active" data-metric="weight" data-action="switchChartMetric" data-value="weight">Gewicht</button>
              <button class="chart-tab" data-metric="volume" data-action="switchChartMetric" data-value="volume">Volumen</button>
            </div>
          </div>
          <div id="chartArea" class="chart-area"></div>
        </div>
        `;

    $('chartExerciseSelect').addEventListener('change', () => drawChart());
    state._chartMetric = state._chartMetric || 'weight';
    drawChart();
  }

  function switchChartMetric(metric) {
    state._chartMetric = metric;
    document.querySelectorAll('.chart-tab').forEach(t => t.classList.toggle('active', t.dataset.metric === metric));
    drawChart();
  }

  function drawChart() {
    const select = $('chartExerciseSelect');
    if (!select) return;
    const exId = select.value;
    const history = getExerciseHistory(exId);
    const area = $('chartArea');

    if (history.length < 1) {
      area.innerHTML = '<p class="empty-state">Noch keine Daten für diese Übung.</p>';
      return;
    }

    const metric = state._chartMetric || 'weight';
    const values = history.map(h => metric === 'weight' ? h.maxWeight : h.volume);
    const labels = history.map(h => {
      const d = new Date(h.date);
      return `${d.getDate()}.${d.getMonth() + 1}`;
    });

    const maxVal = Math.max(...values) || 1;
    const minVal = Math.min(...values);
    const range = maxVal - minVal || 1;
    const W = 540, H = 180, PAD = 40, PADR = 15, PADT = 10, PADB = 30;
    const chartW = W - PAD - PADR;
    const chartH = H - PADT - PADB;

    const points = values.map((v, i) => {
      const x = PAD + (values.length === 1 ? chartW / 2 : (i / (values.length - 1)) * chartW);
      const y = PADT + chartH - ((v - minVal) / range) * chartH;
      return { x, y, v };
    });

    const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
    const areaPath = `M${points[0].x},${PADT + chartH} ${points.map(p => `L${p.x},${p.y}`).join(' ')} L${points[points.length - 1].x},${PADT + chartH} Z`;

    // Y-axis labels (3 lines)
    const yLabels = [minVal, minVal + range / 2, maxVal].map((v, i) => {
      const y = PADT + chartH - (i / 2) * chartH;
      return `<text x="${PAD - 5}" y="${y + 4}" text-anchor="end" fill="#64748b" font-size="10">${Math.round(v)}</text>
                    <line x1="${PAD}" y1="${y}" x2="${W - PADR}" y2="${y}" stroke="rgba(148,163,184,0.1)" />`;
    }).join('');

    const xLabels = points.map((p, i) => {
      if (values.length > 10 && i % 2 !== 0) return '';
      return `<text x="${p.x}" y="${H - 5}" text-anchor="middle" fill="#64748b" font-size="9">${labels[i]}</text>`;
    }).join('');

    const dots = points.map(p =>
      `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent-blue)" stroke="var(--bg-secondary)" stroke-width="2"/>
             <title>${Math.round(p.v)} ${metric === 'weight' ? 'kg' : 'vol'}</title>`
    ).join('');

    // Trend arrow
    const trend = values.length >= 2 ? values[values.length - 1] - values[0] : 0;
    const trendColor = trend > 0 ? 'var(--accent-green)' : trend < 0 ? 'var(--accent-red)' : 'var(--text-secondary)';
    const trendIcon = trend > 0 ? '↑' : trend < 0 ? '↓' : '→';
    const trendText = `${trendIcon} ${Math.abs(Math.round(trend))} ${metric === 'weight' ? 'kg' : ''}`;

    area.innerHTML = `
        <div class="chart-trend" style="color:${trendColor}">${trendText} seit Start</div>
        <svg viewBox="0 0 ${W} ${H}" class="chart-svg">
          <defs>
            <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stop-color="var(--accent-blue)" stop-opacity="0.3"/>
              <stop offset="100%" stop-color="var(--accent-blue)" stop-opacity="0"/>
            </linearGradient>
          </defs>
          ${yLabels}
          ${xLabels}
          <path d="${areaPath}" fill="url(#chartGrad)" />
          <polyline points="${polyline}" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
          ${dots}
        </svg>
        `;
  }

  function showExChart(exId) {
    const history = getExerciseHistory(exId);
    const allExercises = [...getPlan().cycleA, ...getPlan().cycleB].flatMap(d => d.exercises);
    const ex = allExercises.find(e => e.id === exId);
    const name = ex ? ex.name : exId;

    if (history.length < 1) {
      $('infoModalTitle').textContent = name + ' – Fortschritt';
      $('infoModalBody').innerHTML = '<p class="empty-state">Noch keine Daten aufgezeichnet.</p>';
      show($('infoModal')); focusFirstIn($('infoModal'));
      window.history.pushState({ modal: 'info' }, '');
      return;
    }

    // Render mini chart in modal
    const values = history.map(h => h.maxWeight);
    const labels = history.map(h => { const d = new Date(h.date); return `${d.getDate()}.${d.getMonth() + 1}`; });
    const maxVal = Math.max(...values) || 1;
    const minVal = Math.min(...values);
    const range = maxVal - minVal || 1;
    const W = 480, H = 160, PAD = 40, PADR = 10, PADT = 10, PADB = 25;
    const chartW = W - PAD - PADR, chartH = H - PADT - PADB;
    const points = values.map((v, i) => {
      const x = PAD + (values.length === 1 ? chartW / 2 : (i / (values.length - 1)) * chartW);
      const y = PADT + chartH - ((v - minVal) / range) * chartH;
      return { x, y, v };
    });
    const polyline = points.map(p => `${p.x},${p.y}`).join(' ');
    const trend = values.length >= 2 ? values[values.length - 1] - values[0] : 0;
    const trendColor = trend > 0 ? 'var(--accent-green)' : trend < 0 ? 'var(--accent-red)' : 'var(--text-secondary)';

    $('infoModalTitle').textContent = name + ' – Fortschritt';
    $('infoModalBody').innerHTML = `
            <p style="color:${trendColor};font-weight:700;">${trend > 0 ? '↑' : trend < 0 ? '↓' : '→'} ${Math.abs(Math.round(trend))} kg seit Start</p>
            <svg viewBox="0 0 ${W} ${H}" style="width:100%;height:auto;margin-top:8px;">
              ${points.map((p, i) => `<text x="${p.x}" y="${H - 3}" text-anchor="middle" fill="#64748b" font-size="9">${labels[i]}</text>`).join('')}
              <polyline points="${polyline}" fill="none" stroke="var(--accent-blue)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" />
              ${points.map(p => `<circle cx="${p.x}" cy="${p.y}" r="4" fill="var(--accent-blue)" stroke="var(--bg-secondary)" stroke-width="2"/>`).join('')}
            </svg>
            <h4>Gewichtsverlauf</h4>
            ${history.map(h => `<p style="font-size:0.82rem;">${formatDate(h.date)}: <strong>${h.maxWeight} kg</strong> (Vol: ${h.volume})</p>`).join('')}
        `;
    show($('infoModal')); focusFirstIn($('infoModal'));
    window.history.pushState({ modal: 'info' }, '');
  }

  function showSessionDetail(id) {
    const session = state.sessions.find(s => s.id === id);
    if (!session) return;

    $('modalContent').innerHTML = `
    <div class="modal-header">
      <h3>${esc(session.dayName)}</h3>
      <button class="btn-close" data-action="closeOverlay">&times;</button>
    </div>
    <div class="modal-body">
      <p>${formatDate(session.date)} • ${session.duration || '--'} Min • Zyklus ${esc(session.cycle)}</p>
      <div class="history-detail-exercises">
        ${session.exercises.map(ex => `
          <div class="history-detail-exercise">
            <h5>${esc(ex.name)}</h5>
            ${ex.noTracking
              ? `<p style="font-size:0.78rem;color:var(--text-muted);">${ex.done ? '✅ Erledigt' : '⭕ Nicht abgehakt'}</p>`
              : (ex.sets || []).map((s, i) => `
              <div class="history-detail-set">
                <span>Satz ${i + 1}</span>
                <span>${esc(String(s.weight || '-'))} kg</span>
                <span>${esc(String(s.reps || '-'))} Reps</span>
                <span>RIR ${esc(String(s.rir || '-'))}</span>
              </div>
            `).join('')
            }
          </div>
        `).join('')}
      </div>
      <div style="margin-top:16px;">
        <button class="btn btn-danger btn-sm" data-action="deleteSession" data-id="${esc(id)}">Löschen</button>
      </div>
    </div>
  `;
    show($('modalOverlay')); focusFirstIn($('modalOverlay'));
    window.history.pushState({ modal: 'overlay' }, '');
  }

  function deleteSession(id) {
    showConfirm(
      'Training wirklich löschen? Diese Aktion kann nicht rückgängig gemacht werden.',
      () => {
        state.sessions = state.sessions.filter(s => s.id !== id);
        saveState();
        hide($('modalOverlay'));
        renderHistory();
        renderDashboard();
        toast('Training gelöscht');
      },
      () => { showSessionDetail(id); },
      { confirmLabel: 'Löschen', cancelLabel: 'Abbrechen' }
    );
  }

  // --- Cloud Backup (Export/Import) ---
  function exportData() {
    const data = {
      version: 1,
      exportDate: new Date().toISOString(),
      app: 'PPL-8 Training Tracker',
      state: {
        znsBaseline: state.znsBaseline,
        athlete: state.athlete,
        sessions: state.sessions,
        customPlan: state.customPlan
      }
    };
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `ppl8_backup_${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);

    state.lastBackup = new Date().toISOString();
    saveState();
    $('lastBackup').innerHTML = `<small>Letztes Backup: ${formatDate(state.lastBackup)}</small>`;
    toast('Backup exportiert ☁️');
  }

  function importData() {
    $('importFileInput').click();
  }

  function handleImport(e) {
    const file = e.target.files[0];
    e.target.value = ''; // reset so re-selecting same file fires change again
    if (!file) return;
    const reader = new FileReader();
    reader.onerror = () => toast('❌ Datei konnte nicht gelesen werden');
    reader.onload = function (ev) {
      try {
        const raw = ev.target.result;
        if (!raw || !raw.trim()) { toast('❌ Datei ist leer'); return; }
        const data = JSON.parse(raw);

        // Format A: PPL-8 JSON Export { version, state: { sessions, athlete, ... } }
        if (data.version && data.state && typeof data.state === 'object') {
          const s = data.state;
          if (s.sessions)    state.sessions    = s.sessions;
          if (s.athlete)     state.athlete     = s.athlete;
          if (s.customPlan)  state.customPlan  = s.customPlan;
          if (s.znsBaseline) state.znsBaseline = s.znsBaseline;
          saveState();
          renderDashboard();
          populateSettingsForm();
          toast('✅ Import erfolgreich! ' + (s.sessions ? s.sessions.length : 0) + ' Sessions geladen.');
          return;
        }

        // Format B: Gist Sync Payload { stateVersion, sessions, athlete, ... }
        if (data.sessions && Array.isArray(data.sessions)) {
          state.sessions = data.sessions;
          if (data.athlete)    state.athlete    = data.athlete;
          if (data.customPlan) state.customPlan = data.customPlan;
          saveState();
          renderDashboard();
          populateSettingsForm();
          toast('✅ Import erfolgreich! ' + data.sessions.length + ' Sessions geladen.');
          return;
        }

        toast('❌ Unbekanntes Backup-Format');
      } catch (err) {
        console.error('Import error:', err);
        toast('❌ JSON ungültig: ' + err.message);
      }
    };
    reader.readAsText(file);
  }



  // --- Plan Editor ---
  function openPlanEditor() {
    const plan = getPlan();
    const allDays = [...plan.cycleA, ...plan.cycleB];

    $('modalContent').innerHTML = `
    <div class="modal-header">
      <h3>Trainingsplan bearbeiten</h3>
      <button class="btn-close" data-action="closeOverlay">&times;</button>
    </div>
    <div class="modal-body plan-editor">
      ${allDays.map((day, di) => `
        <div class="plan-editor-day">
          <h4>Tag ${day.day}: ${esc(day.name)}</h4>
          ${day.exercises.map((ex, ei) => `
            <div class="plan-exercise-item">
              <span>${esc(ex.name)} — ${ex.sets}x${esc(ex.reps)}</span>
              <button class="btn-delete-ex" data-action="removeExercise" data-day="${di}" data-ex="${ei}">✕</button>
            </div>
          `).join('')}
          <button class="btn-add-exercise" data-action="addExercise" data-day="${di}">+ Übung hinzufügen</button>
        </div>
      `).join('')}
    </div>
  `;
    show($('modalOverlay')); focusFirstIn($('modalOverlay'));
    window.history.pushState({ modal: 'overlay' }, '');
  }

  function addExercisePrompt(dayIdx) {
    // Use branded modal instead of native prompt() — blocked on iOS PWA
    $('modalContent').innerHTML = `
      <div class="modal-header">
        <h3>Übung hinzufügen</h3>
        <button class="btn-close" data-action="closeOverlay">&times;</button>
      </div>
      <div class="modal-body">
        <div style="display:flex;flex-direction:column;gap:12px;">
          <div>
            <label style="font-size:0.78rem;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;">Übungsname</label>
            <input id="addExName" type="text" class="input-field" placeholder="z.B. Schrägbank Drücken">
          </div>
          <div style="display:flex;gap:8px;">
            <div style="flex:1;">
              <label style="font-size:0.78rem;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;">Sätze</label>
              <input id="addExSets" type="number" class="input-field" value="2" min="1" max="10" inputmode="numeric">
            </div>
            <div style="flex:1;">
              <label style="font-size:0.78rem;font-weight:600;color:var(--text-secondary);display:block;margin-bottom:4px;">Wiederholungen</label>
              <input id="addExReps" type="text" class="input-field" value="8-12" placeholder="8-12">
            </div>
          </div>
          <div style="display:flex;gap:8px;margin-top:4px;">
            <button class="btn btn-outline btn-sm" id="addExCancel" style="flex:1;">Abbrechen</button>
            <button class="btn btn-primary btn-sm" id="addExConfirm" style="flex:1;">Hinzufügen</button>
          </div>
        </div>
      </div>
    `;
    show($('modalOverlay')); focusFirstIn($('modalOverlay'));
    window.history.pushState({ modal: 'overlay' }, '');

    $('addExName').focus();
    $('addExName').addEventListener('keydown', (e) => { if (e.key === 'Enter') $('addExConfirm').click(); });
    $('addExCancel').addEventListener('click', () => { hide($('modalOverlay')); openPlanEditor(); });
    $('addExConfirm').addEventListener('click', () => {
      const name = ($('addExName').value || '').trim();
      if (!name) { $('addExName').focus(); return; }
      const sets = parseInt($('addExSets').value) || 2;
      const reps = ($('addExReps').value || '8-12').trim();

      if (!state.customPlan) state.customPlan = JSON.parse(JSON.stringify(TRAINING_PLAN));
      const allDays = [...state.customPlan.cycleA, ...state.customPlan.cycleB];
      allDays[dayIdx].exercises.push({
        id: 'custom_' + ((typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : Date.now()),
        name, sets, reps, tempo: null, note: '',
        guide: 'Noch keine Anleitung hinterlegt.'
      });
      saveState();
      hide($('modalOverlay'));
      openPlanEditor();
      toast('Übung hinzugefügt ✅');
    });
  }

  function removeExercise(dayIdx, exIdx) {
    showConfirm(
      'Übung wirklich aus dem Plan entfernen?',
      () => {
        if (!state.customPlan) {
          state.customPlan = JSON.parse(JSON.stringify(TRAINING_PLAN));
        }
        const allDays = [...state.customPlan.cycleA, ...state.customPlan.cycleB];
        allDays[dayIdx].exercises.splice(exIdx, 1);
        saveState();
        openPlanEditor();
        toast('Übung entfernt');
      },
      null,
      { confirmLabel: 'Entfernen', cancelLabel: 'Abbrechen' }
    );
  }

  // --- Settings ---
  function saveBaseline() {
    state.athlete.height = parseInt($('settingHeight').value) || 200;
    state.athlete.weight = parseInt($('settingWeight').value) || 94;
    state.athlete.bodyFat = parseInt($('settingBF').value) || 13;
    saveState();
    populateSettingsForm();
    toast('Gespeichert ✅');
  }

  function resetData() {
    // Two-step confirmation for destructive action — first modal leads to second
    showConfirm(
      'ALLE Trainingsdaten unwiderruflich löschen? Diese Aktion kann nicht rückgängig gemacht werden!',
      () => showConfirm(
        'Wirklich sicher? Erstelle vorher ein Backup in den Einstellungen!',
        () => {
          localStorage.removeItem(STORAGE_KEY);
          state.sessions = [];
          state.customPlan = null;
          state.znsBaseline = null;
          state.activeSession = null;
          state.workoutStartTime = null;
          renderDashboard();
          toast('Alle Daten gelöscht');
        },
        null,
        { confirmLabel: '⚠️ Endgültig löschen', cancelLabel: 'Abbrechen' }
      ),
      null,
      { confirmLabel: 'Ja, löschen', cancelLabel: 'Abbrechen' }
    );
  }

  // --- Toggle helpers ---
  function toggleCollapsible(bodyId, btnId) {
    const body = $(bodyId);
    const btn = btnId ? $(btnId) : null;
    body.classList.toggle('collapsed');
    if (btn) btn.querySelector('svg')?.classList.toggle('rotated', !body.classList.contains('collapsed'));
  }

  // --- Event Listeners ---
  function bindEvents() {
    // Nav
    document.querySelectorAll('.nav-item').forEach(btn => {
      btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    // Cycle tabs
    document.querySelectorAll('.cycle-tab').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.cycle-tab').forEach(t => t.classList.remove('active'));
        tab.classList.add('active');
        state.currentCycle = tab.dataset.cycle;
        renderDayGrid();
      });
    });

    // System toggle
    $('btnSystemToggle').addEventListener('click', () => toggleCollapsible('systemBody', 'btnSystemToggle'));

    // Warmup toggle — pass expand button ID so the chevron rotates
    $('btnWarmupToggle').addEventListener('click', () => toggleCollapsible('warmupBody', 'btnWarmupExpand'));

    // Workout
    $('btnFinishWorkout').addEventListener('click', openFinishModal);
    $('btnBackFromWorkout').addEventListener('click', backFromWorkout);

    // Settings
    const btnSaveBaseline = $('btnSaveBaseline'); if (btnSaveBaseline) btnSaveBaseline.addEventListener('click', saveBaseline);
    $('btnExportData').addEventListener('click', exportData);
    const btnExportCSV = document.getElementById('btnExportCSV');
    if (btnExportCSV) btnExportCSV.addEventListener('click', exportCSV);
    $('btnImportData').addEventListener('click', importData);
    $('importFileInput').addEventListener('change', handleImport);
    $('btnEditPlan').addEventListener('click', openPlanEditor);
    $('btnResetData').addEventListener('click', resetData);
    $('btnBackup').addEventListener('click', () => {
      if (gistGetToken()) { gistPush(); } else { exportData(); }
    });

    // Gist Sync
    const btnGistPush = document.getElementById('btnGistPush');
    const btnGistPull = document.getElementById('btnGistPull');
    const btnSaveGist = document.getElementById('btnSaveGist');
    if (btnGistPush) btnGistPush.addEventListener('click', gistPush);
    if (btnGistPull) btnGistPull.addEventListener('click', gistPull);
    if (btnSaveGist) btnSaveGist.addEventListener('click', saveGistSettings);
    const btnGistDiag = document.getElementById('btnGistDiag');
    if (btnGistDiag) btnGistDiag.addEventListener('click', window.gistDiagnose);

    // Populate token field if already stored
    const tokenInput = document.getElementById('gistTokenInput');
    const idInput = document.getElementById('gistIdDisplay');
    if (tokenInput && gistGetToken()) tokenInput.value = gistGetToken();
    if (idInput && gistGetId()) { idInput.value = gistGetId(); const row = idInput.closest('.gist-id-row'); if (row) row.style.display = ''; }

    // Workout Extra
    const btnCloseRestTimer = document.getElementById('btnCloseRestTimer');
    if (btnCloseRestTimer) btnCloseRestTimer.addEventListener('click', closeRestTimer);

    // Finish Modal — RPE/ZNS sliders, confirm, close, backdrop
    $('btnConfirmFinish').addEventListener('click', confirmFinishWorkout);
    $('btnCloseFinish').addEventListener('click', () => hide($('finishModal')));
    $('sessionRpeSlider').addEventListener('input', function() {
      $('sessionRpeDisplay').textContent = parseFloat(this.value).toFixed(1);
    });
    $('znsSlider').addEventListener('input', function() {
      $('znsDisplay').textContent = this.value;
    });
    $('finishModal').addEventListener('click', (e) => {
      if (e.target === $('finishModal')) hide($('finishModal'));
    });

    // Modals
    const _bci = $('btnCloseInfo'); if(_bci) _bci.addEventListener('click', () => { hide($('infoModal')); });
    const _bce = $('btnCloseEdit'); if(_bce) _bce.addEventListener('click', () => { hide($('editModal')); });
    $('infoModal').addEventListener('click', (e) => { if (e.target === $('infoModal')) hide($('infoModal')); });
    $('modalOverlay').addEventListener('click', (e) => { if (e.target === $('modalOverlay')) hide($('modalOverlay')); });


    // ── Delegated click: Day Grid ──────────────────────────────────────
    $('dayGrid').addEventListener('click', e => {
      const card = e.target.closest('[data-action="openWorkout"]');
      if (card) openWorkout(card.dataset.cycle, parseInt(card.dataset.day));
    });

    // ── Delegated click: Recent Sessions (dashboard) ───────────────────
    $('recentList').addEventListener('click', e => {
      const item = e.target.closest('[data-action="showSession"]');
      if (item) showSessionDetail(item.dataset.id);
    });

    // ── Delegated click: Warmup timer buttons ──────────────────────────
    $('warmupBody').addEventListener('click', e => {
      const btn = e.target.closest('[data-action="startTimer"]');
      if (btn) startTimer(parseInt(btn.dataset.seconds), btn);
    });

    // ── Delegated click: Exercise List (workout view) ──────────────────
    $('exerciseList').addEventListener('click', e => {
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'toggleExercise') {
        toggleExercise(+btn.dataset.idx);
      } else if (action === 'showExInfo') {
        e.stopPropagation();
        showExInfo(btn.dataset.id);
      } else if (action === 'showExChart') {
        e.stopPropagation();
        showExChart(btn.dataset.id);
      } else if (action === 'toggleSetDone') {
        toggleSetDone(+btn.dataset.ex, +btn.dataset.si);
      } else if (action === 'feedback-up') {
        setFeedback(+btn.dataset.ex, +btn.dataset.si, 'up');
      } else if (action === 'feedback-down') {
        setFeedback(+btn.dataset.ex, +btn.dataset.si, 'down');
      } else if (action === 'toggleActivityDone') {
        toggleActivityDone(+btn.dataset.idx);
      }
    });

    // ── Delegated input: Exercise List (all text/number inputs) ────────
    $('exerciseList').addEventListener('input', e => {
      const el = e.target;
      if (el.dataset.field !== undefined && el.dataset.ex !== undefined) {
        updateSet(+el.dataset.ex, +el.dataset.si, el.dataset.field, el.value);
      } else if (el.dataset.action === 'updateExNotes') {
        updateExNotes(+el.dataset.idx, el.value);
      } else if (el.dataset.action === 'updateExSetup') {
        updateExSetup(+el.dataset.idx, el.value);
      }
    });

    // ── Delegated click: Modal Overlay (dynamic modal content) ─────────
    $('modalOverlay').addEventListener('click', e => {
      if (e.target === $('modalOverlay')) { hide($('modalOverlay')); return; }
      const btn = e.target.closest('[data-action]');
      if (!btn) return;
      const action = btn.dataset.action;
      if (action === 'closeOverlay') {
        hide($('modalOverlay'));
      } else if (action === 'deleteSession') {
        deleteSession(btn.dataset.id);
      } else if (action === 'removeExercise') {
        removeExercise(+btn.dataset.day, +btn.dataset.ex);
      } else if (action === 'addExercise') {
        addExercisePrompt(+btn.dataset.day);
      } else if (action === 'switchChartMetric') {
        switchChartMetric(btn.dataset.value);
      }
    });

    // ── Delegated click: History List ──────────────────────────────────
    $('historyList').addEventListener('click', e => {
      const session = e.target.closest('[data-action="showSession"]');
      if (session) { showSessionDetail(session.dataset.id); return; }
      const chart = e.target.closest('[data-action="showExChart"]');
      if (chart) showExChart(chart.dataset.id);
    });

    // History tabs (moved from inline onclick to comply with CSP)
    document.querySelectorAll('.hist-tab').forEach(tab => {
      tab.addEventListener('click', () => renderHistoryTab(tab.dataset.tab));
    });

    // Hardware back button (popstate) — closes modals or exits workout view
    window.addEventListener('popstate', (e) => {
      if (!$('finishModal').classList.contains('hidden')) { hide($('finishModal')); return; }
      if (!$('infoModal').classList.contains('hidden')) { hide($('infoModal')); return; }
      if (!$('modalOverlay').classList.contains('hidden')) { hide($('modalOverlay')); return; }
      if (state.currentView === 'viewWorkout') { backFromWorkout(); return; }
    });

    // Escape key support — only closes the modal, does NOT call history.back()
    // (history.back() would fire popstate which triggers backFromWorkout() if in workout view)
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') {
        if (!$('finishModal').classList.contains('hidden')) { hide($('finishModal')); return; }
        if (!$('infoModal').classList.contains('hidden')) { hide($('infoModal')); return; }
        if (!$('modalOverlay').classList.contains('hidden')) { hide($('modalOverlay')); return; }
      }
    });

    // visibilitychange: flush pending saves, re-acquire wake lock
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'hidden') {
        flushSave();
      } else if (document.visibilityState === 'visible' && state.activeSession) {
        requestWakeLock();
      }
    });

    // Global error boundary
    window.addEventListener('error', (e) => {
      console.error('Uncaught error:', e.error);
      flushSave();
      toast('⚠️ Fehler aufgetreten. Daten wurden gesichert.');
    });
    window.addEventListener('unhandledrejection', (e) => {
      console.error('Unhandled rejection:', e.reason);
      flushSave();
    });
  }

  // --- Public API ---
  // Expose gist functions globally for inline onclick handlers
  window.gistPushData     = gistPush;
  window.gistPullData     = gistPull;
  window.gistSaveSettings = saveGistSettings;
  window.gistDiagnose     = async function() {
    const tokenEl = document.getElementById('gistTokenInput');
    const token   = (tokenEl && tokenEl.value.trim()) || gistGetToken();
    const toastEl = document.getElementById('toast');
    const msgEl   = document.getElementById('toastMsg');
    const show    = (msg, dur) => {
      msgEl.textContent = msg;
      toastEl.style.cursor = '';
      toastEl.classList.remove('hidden');
      if (dur !== 0) setTimeout(() => toastEl.classList.add('hidden'), dur || 4000);
    };

    if (!token) { show('⚠️ Kein Token im Feld – bitte eintragen und Token speichern drücken', 4000); return; }
    show('🔄 Teste GitHub API…', 0);
    try {
      const res = await fetch('https://api.github.com/user', {
        headers: {
          'Authorization': 'Bearer ' + token,
          'X-GitHub-Api-Version': '2022-11-28'
        }
      });
      const body = await res.json().catch(() => ({}));
      if (res.ok) {
        show('✅ Token gültig! User: ' + (body.login || '?') + ' – jetzt Push versuchen', 4000);
      } else if (res.status === 401) {
        show('❌ 401: Token ungültig oder abgelaufen. Neu generieren.', 5000);
      } else if (res.status === 403) {
        show('❌ 403: Zugriff verweigert. Gist-Berechtigung prüfen.', 5000);
      } else {
        show('❌ HTTP ' + res.status + ': ' + (body.message || 'Unbekannter Fehler'), 5000);
      }
    } catch(e) {
      show('❌ Netzwerkfehler: ' + e.message + ' (CORS?)', 6000);
    }
  };

  window.app = {
    openWorkout, toggleExercise, updateSet, updateExNotes, updateExSetup, toggleSetDone, toggleActivityDone,
    showExInfo, showExChart, showSessionDetail, deleteSession, startTimer,
    addExercisePrompt, removeExercise, setFeedback, switchChartMetric, renderHistoryTab
  };

  // --- CSV Export ---
  function exportCSV() {
    if (!state.sessions || state.sessions.length === 0) {
      toast('Keine Daten zum Exportieren.');
      return;
    }

    let csv = 'Datum,Zyklus,Tag,Übung,Satz,Arm/Seite,Gewicht (kg),Wiederholungen,RIR,Notizen,Feedback\n';

    state.sessions.forEach(session => {
      const dateStr = session.date.split('T')[0];
      session.exercises.forEach(ex => {
        if (ex.noTracking) return;
        ex.sets.forEach((set, i) => {
          if (!set.done && !set.weight && !set.reps) return; // Skip completely empty uncompleted sets

          let armSide = 'Standard';
          if (ex.unilateral) {
            armSide = i < (ex.sets.length / 2) ? 'Links' : 'Rechts';
          }

          const cleanNotes = (set.notes || '').replace(/"/g, '""'); // escape quotes for CSV

          csv += `"${dateStr}","${session.cycle}","${session.dayName}","${ex.name}",${i + 1},"${armSide}","${set.weight || 0}","${set.reps || 0}","${set.rir || ''}","${cleanNotes}","${set.feedback || ''}"\n`;
        });
      });
    });

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PPL8_Trainingsdaten_${new Date().toISOString().split('T')[0]}.csv`;
    a.click();
    URL.revokeObjectURL(url);
    toast('CSV Export erfolgreich!');
  }

  // --- Init ---
  function init() {
    loadState();

    // Bind events and populate form first (synchronous, no DOM rendering yet)
    bindEvents();
    populateSettingsForm();

    // Render dashboard BEFORE splash exits so content is ready underneath
    try {
      renderDashboard();
    } catch(e) {
      console.error('Dashboard render error:', e);
    }

    // Splash dismisses after content is ready — immune to render errors
    setTimeout(() => {
      $('splash').classList.add('fade-out');
      $('app').classList.remove('hidden');
      setTimeout(() => { const s = $('splash'); if(s) s.remove(); }, 500);
    }, 1200);

    // Auto-pull from Gist on startup (after UI is ready)
    setTimeout(() => gistAutoSync(), 1600);

    // Service Worker with graceful update detection
    if ('serviceWorker' in navigator) {
      navigator.serviceWorker.register('./sw.js').then(reg => {
        reg.addEventListener('updatefound', () => {
          const newWorker = reg.installing;
          newWorker.addEventListener('statechange', () => {
            if (newWorker.state === 'installed' && navigator.serviceWorker.controller) {
              toast('🔄 Update verfügbar. Tippen zum Aktualisieren.', () => {
                newWorker.postMessage({ type: 'SKIP_WAITING' });
                hide($('toast'));
                location.reload();
              });
            }
          });
        });
      }).catch(() => { });

      // Re-acquire wake lock after SW controller change
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (state.activeSession) requestWakeLock();
      });
    }
  }

  document.addEventListener('DOMContentLoaded', init);

})();
