/* Lift Recap — UI layer. All data stays in this browser (localStorage). */
(function () {
  'use strict';
  var E = window.LiftEngine;
  var APP_URL = location.origin + location.pathname;

  // ---------- storage (never throws) ----------
  var store = {
    get: function (k, d) { try { var v = localStorage.getItem('liftrecap.' + k); return v ? JSON.parse(v) : d; } catch (e) { return d; } },
    set: function (k, v) { try { localStorage.setItem('liftrecap.' + k, JSON.stringify(v)); return true; } catch (e) { return false; } },
    del: function (k) { try { localStorage.removeItem('liftrecap.' + k); } catch (e) { /* ignore */ } }
  };

  var state = {
    view: 'recap',
    profile: Object.assign({ unit: 'kg' }, E.DEFAULT_PROFILE, store.get('profile', {})),
    history: store.get('history', []),
    raw: store.get('raw', null),
    parsed: null,
    session: store.get('current', null),
    hotExercise: null
  };

  // ---------- utils ----------
  function $(sel, el) { return (el || document).querySelector(sel); }
  function $all(sel, el) { return Array.prototype.slice.call((el || document).querySelectorAll(sel)); }
  function esc(s) { return String(s === undefined || s === null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function fmtTime(t) { return new Date(t).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }); }
  function fmtDate(t) { return new Date(t).toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric' }); }
  function fmtMin(sec) { var m = Math.round(sec / 60); return m >= 60 ? Math.floor(m / 60) + 'h ' + (m % 60) + 'm' : m + ' min'; }
  function fmtRest(sec) { if (sec === null || sec === undefined) return '—'; sec = Math.round(sec); var m = Math.floor(sec / 60), s = sec % 60; return m + ':' + (s < 10 ? '0' : '') + s; }
  var toastTimer;
  function toast(msg) {
    var el = $('#toast'); el.textContent = msg; el.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(function () { el.classList.remove('show'); }, 2600);
  }
  function persistSession() { if (state.session) store.set('current', state.session); }

  // ---------- data flow ----------
  function loadText(text, opts) {
    var parsed = E.parseInput(text);
    if (parsed.hr.length < 20) {
      toast('Could not find heart-rate samples in that data.');
      return false;
    }
    state.raw = text;
    state.parsed = parsed;
    store.set('raw', text);
    try {
      state.session = E.analyze(parsed, { profile: state.profile, history: state.history, focus: (opts && opts.focus) || 'auto' });
    } catch (e) { toast(e.message); return false; }
    persistSession();
    setView('recap');
    return true;
  }

  function reanalyze(opts) {
    if (!state.parsed && state.raw) state.parsed = E.parseInput(state.raw);
    if (!state.parsed) return;
    var keepFocus = state.session && !state.session.focusWasAuto ? state.session.focus : 'auto';
    try {
      state.session = E.analyze(state.parsed, Object.assign({ profile: state.profile, history: state.history, focus: keepFocus }, opts || {}));
      persistSession();
      render();
    } catch (e) { toast(e.message); }
  }

  function readHash() {
    var h = location.hash.slice(1);
    if (!h) return;
    var params = {};
    h.split('&').forEach(function (kv) {
      var i = kv.indexOf('=');
      if (i > 0) params[kv.slice(0, i)] = kv.slice(i + 1);
      else params[kv] = '';
    });
    history.replaceState(null, '', location.pathname);
    if ('demo' in params) { loadText(E.demoText(), { focus: 'push' }); return; }
    if (params.data) {
      var text = params.data;
      try { text = decodeURIComponent(text.replace(/\+/g, '%20')); } catch (e) { /* already decoded */ }
      if (loadText(text, { focus: params.focus })) toast('Workout imported from Apple Watch');
    }
  }

  // ---------- views ----------
  function setView(v) {
    state.view = v;
    $all('.tabs button').forEach(function (b) { b.setAttribute('aria-selected', b.dataset.view === v ? 'true' : 'false'); });
    ['recap', 'history', 'setup'].forEach(function (k) { $('#view-' + k).hidden = k !== v; });
    render();
    window.scrollTo(0, 0);
  }

  function render() {
    if (state.view === 'recap') renderRecap();
    else if (state.view === 'history') renderHistory();
    else renderSetup();
  }

  // ----- import / empty state -----
  function importCard(compact) {
    return '' +
      '<div class="card ' + (compact ? '' : 'import-hero') + '">' +
      (compact ? '<div class="card-head"><h2>Import another workout</h2></div>' :
        '<div class="icon"><svg viewBox="0 0 24 24"><rect x="6" y="5" width="12" height="14" rx="4" fill="none" stroke="currentColor" stroke-width="2"/><path d="M9 5V2.5h6V5M9 19v2.5h6V19M9.5 12h1.5l1-2 1.5 4 1-2h1" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></div>' +
        '<h1>Your workout, decoded</h1>' +
        '<p class="muted">Finish a Functional Strength Training workout on your Apple Watch. Your iPhone shortcut sends the heart-rate data here, and Lift Recap estimates the exercises, sets and rest you did.</p>') +
      '<div class="btn-row">' +
      '<button class="btn primary" data-act="paste">Paste from clipboard</button>' +
      '<label class="btn"><input type="file" accept=".txt,.csv,.json,.xml" hidden data-act="file">Open file</label>' +
      '<button class="btn" data-act="demo">Try a demo workout</button>' +
      '</div>' +
      '<details style="margin-top:16px;text-align:left"><summary class="small muted" style="cursor:pointer">Or paste data manually</summary>' +
      '<textarea id="raw-input" placeholder="2026-11-25T18:01:05-08:00,128&#10;2026-11-25T18:01:10-08:00,131&#10;..."></textarea>' +
      '<div class="btn-row" style="margin-top:8px"><button class="btn primary small" data-act="analyze-text">Analyze</button></div></details>' +
      (compact ? '' : '<p class="small muted" style="margin-top:18px">First time? <a href="#" data-act="go-setup">Set up the Apple Watch shortcut</a> (about 3 minutes, one time only).</p>') +
      '</div>';
  }

  function bindImport(root) {
    $all('[data-act]', root).forEach(function (el) {
      var act = el.dataset.act;
      if (act === 'file') {
        el.addEventListener('change', function () {
          var f = el.files[0]; if (!f) return;
          var r = new FileReader();
          r.onload = function () { if (loadText(String(r.result))) toast('Imported ' + f.name); };
          r.readAsText(f);
        });
        return;
      }
      el.addEventListener('click', function (ev) {
        ev.preventDefault();
        if (act === 'paste') {
          if (!navigator.clipboard || !navigator.clipboard.readText) { toast('Clipboard not available — paste manually below.'); $('details', root).open = true; return; }
          navigator.clipboard.readText().then(function (t) {
            if (!loadText(t)) { $('details', root).open = true; }
          }).catch(function () { toast('Clipboard blocked — paste manually below.'); $('details', root).open = true; });
        } else if (act === 'demo') { loadText(E.demoText(), { focus: 'push' }); toast('Demo: a simulated push day'); }
        else if (act === 'analyze-text') loadText($('#raw-input').value);
        else if (act === 'go-setup') setView('setup');
      });
    });
  }

  // ----- recap -----
  function renderRecap() {
    var root = $('#view-recap');
    var s = state.session;
    if (!s) { root.innerHTML = importCard(false); bindImport(root); return; }
    var st = s.stats;
    var unit = state.profile.unit || 'kg';
    var volume = 0, loggedSets = 0;
    s.exercises.forEach(function (e) { e.sets.forEach(function (x) { if (+x.reps > 0) { loggedSets++; volume += (+x.reps) * (+x.kg || 0); } }); });
    var saved = state.history.some(function (h) { return h.id === s.id; });

    var focusChips = '<button class="chip-btn" data-focus="auto" aria-pressed="' + s.focusWasAuto + '">Auto' + (s.focusWasAuto ? ' · ' + esc(E.FOCI[s.autoFocus]) : '') + '</button>' +
      Object.keys(E.FOCI).map(function (k) {
        return '<button class="chip-btn" data-focus="' + k + '" aria-pressed="' + (!s.focusWasAuto && s.focus === k) + '">' + esc(E.FOCI[k]) + '</button>';
      }).join('');

    var tiles = [
      { k: 'Duration', v: fmtMin(st.durationSec), s: fmtTime(st.startT) + ' – ' + fmtTime(st.endT) },
      { k: 'Sets', v: st.sets, unit: '', s: st.exercises + ' exercises' },
      { k: 'Training load', v: Math.round(st.load), s: st.loadLabel + ' effort' },
      { k: 'Calories', v: st.kcal, unit: 'kcal', s: st.kcalSource === 'watch' ? 'from Apple Watch' : 'estimated from HR' },
      { k: 'Heart rate', v: st.avgHR, unit: 'avg', s: 'max ' + st.maxHR + ' bpm (' + Math.round(st.maxHR / s.profile.maxHR * 100) + '% of max)' },
      { k: 'Typical rest', v: st.medianRest ? fmtRest(st.medianRest) : '—', s: 'between sets' },
      { k: 'Work density', v: Math.round(st.density * 100), unit: '%', s: fmtMin(st.workSec) + ' under load' },
      loggedSets ? { k: 'Volume', v: Math.round(volume).toLocaleString(), unit: unit, s: loggedSets + ' sets logged' }
        : { k: 'HR recovery', v: st.avgHRR !== null ? st.avgHRR : '—', unit: st.avgHRR !== null ? 'bpm' : '', s: 'drop 60 s after a set' }
    ];

    root.innerHTML = '' +
      '<div class="recap-head">' +
      '<div><div class="eyebrow">Workout recap</div><h1>' + esc(fmtDate(st.startT)) + '</h1>' +
      '<p class="muted small">' + esc(E.FOCI[s.focus]) + ' day · ' + st.sets + ' sets across ' + st.exercises + ' exercises</p></div>' +
      '<div class="btn-row">' +
      '<button class="btn ' + (saved ? '' : 'primary') + '" data-act="save">' + (saved ? 'Saved ✓' : 'Save to history') + '</button>' +
      '<button class="btn" data-act="copy-claude" title="Copy a summary to paste into Claude for coaching">Ask Claude coach</button>' +
      '</div></div>' +
      '<div class="focus-row"><span class="label">What did you train?</span><div class="chips">' + focusChips + '</div></div>' +
      '<div class="tiles">' + tiles.map(function (t) {
        return '<div class="tile"><div class="k">' + esc(t.k) + '</div><div class="v">' + esc(t.v) + (t.unit ? '<small>' + esc(t.unit) + '</small>' : '') + '</div><div class="s">' + esc(t.s) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="card"><div class="card-head"><h2>Heart rate</h2><span class="small muted">Shaded = estimated working sets</span></div>' +
      '<div class="chart-wrap" id="hr-chart"></div>' +
      '<div class="legend-inline"><span><i style="background:var(--accent);height:3px"></i>Heart rate (bpm)</span><span><i style="background:var(--band-strong)"></i>Working set</span><span><i style="background:transparent;border:1px solid var(--text-3);width:12px;height:12px;border-radius:50%;display:inline-grid;place-items:center;font-style:normal;font-size:8px">1</i>Exercise number</span></div></div>' +
      '<div class="card-head" style="margin:22px 0 0"><h2>What you did</h2><span class="small muted">Best guesses — tap a name to fix it</span></div>' +
      '<div class="ex-list">' + s.exercises.map(exerciseCard).join('') + '</div>' +
      '<div class="two-col">' +
      '<div class="card"><div class="card-head"><h2>Coach notes</h2></div><div class="notes">' + s.notes.map(noteHtml).join('') + '</div></div>' +
      '<div class="card"><div class="card-head"><h2>Time in heart-rate zones</h2><span class="small muted">max ' + s.profile.maxHR + ' bpm</span></div>' + zonesHtml(s) +
      '<p class="small muted" style="margin-top:12px">Strength days live mostly in the easy–moderate zones; spikes into hard zones happen on big compound sets.</p></div>' +
      '</div>' +
      (state.raw ? windowControl(s) : '') +
      '<p class="disclaimer"><span>ⓘ</span><span>Exercises and sets are inferred from heart rate only — the Apple Watch does not share motion data with web apps. Expect the set count to be close and the exercise names to be guesses; your edits are remembered and improve future guesses for the same training focus.</span></p>' +
      importCard(true) +
      '<div class="btn-row"><button class="btn ghost small" data-act="export">Export this workout (JSON)</button><button class="btn ghost small danger" data-act="clear">Clear current workout</button></div>';

    drawChart($('#hr-chart'), s);
    bindRecap(root);
    bindImport(root);
  }

  function exerciseCard(e, i) {
    var maxRise = Math.max.apply(null, state.session.exercises.map(function (x) { return Math.max.apply(null, x.sets.map(function (y) { return y.rise; })); }));
    var unit = state.profile.unit || 'kg';
    var cat = E.CATEGORIES[e.category];
    var peak = Math.max.apply(null, e.sets.map(function (x) { return x.peakHR; }));
    return '' +
      '<article class="card ex" data-ex="' + i + '">' +
      '<div class="ex-top"><span class="ex-num">' + (i + 1) + '</span>' +
      '<input class="ex-name" value="' + esc(e.name) + '" list="exercise-list" aria-label="Exercise name" data-field="name">' +
      '</div>' +
      '<div class="ex-meta">' +
      '<span class="tag ' + (e.userNamed ? '' : e.confidence) + '">' + esc(e.userNamed ? 'Confirmed by you' : cat.label + ' · ' + e.confidence) + '</span>' +
      '<span>' + e.sets.length + ' set' + (e.sets.length > 1 ? 's' : '') + '</span>' +
      '<span>' + fmtTime(e.startT) + '</span>' +
      '<span>peak ' + peak + ' bpm</span>' +
      (e.fromHistory && !e.userNamed ? '<span>↺ from your last ' + esc(E.FOCI[state.session.focus].toLowerCase()) + ' day</span>' : '') +
      '</div>' +
      (!e.userNamed && e.alternatives && e.alternatives.length ? '<div class="alts">Or maybe: ' + e.alternatives.map(function (a) { return '<button data-alt="' + esc(a) + '">' + esc(a) + '</button>'; }).join('') + '</div>' : '') +
      '<table class="sets-table"><thead><tr><th>Set</th><th class="bar-cell">Effort (HR rise)</th><th class="hide-sm">Work</th><th>Rest</th><th>Reps</th><th>' + esc(unit) + '</th></tr></thead><tbody>' +
      e.sets.map(function (x, j) {
        return '<tr><td>' + (j + 1) + '</td>' +
          '<td class="bar-cell"><div class="mini-bar" style="width:' + Math.round(x.rise / maxRise * 100) + '%" title="+' + Math.round(x.rise) + ' bpm → ' + x.peakHR + ' bpm"></div></td>' +
          '<td class="hide-sm">~' + Math.round(x.durSec) + 's</td>' +
          '<td>' + (j === e.sets.length - 1 ? '<span class="muted">→ next</span>' : fmtRest(x.restAfter)) + '</td>' +
          '<td><input type="number" inputmode="numeric" min="0" placeholder="–" value="' + esc(x.reps || '') + '" data-set="' + j + '" data-field="reps" aria-label="Reps"></td>' +
          '<td><input type="number" inputmode="decimal" min="0" step="0.5" placeholder="–" value="' + esc(x.kg || '') + '" data-set="' + j + '" data-field="kg" aria-label="Weight"></td></tr>';
      }).join('') + '</tbody></table>' +
      '<div class="ex-actions">' +
      (i > 0 ? '<button class="btn ghost small" data-exact="merge">Merge with #' + i + '</button>' : '') +
      (e.sets.length > 1 ? '<button class="btn ghost small" data-exact="split">Split in two</button>' : '') +
      '<button class="btn ghost small" data-exact="dropset">Remove last set</button>' +
      '<button class="btn ghost small danger" data-exact="delete">Not an exercise</button>' +
      '</div></article>';
  }

  function noteHtml(n) {
    var ic = n.tone === 'good' ? '✓' : n.tone === 'warn' ? '!' : 'i';
    return '<div class="note ' + n.tone + '"><div class="ic">' + ic + '</div><div><h3>' + esc(n.title) + '</h3><p>' + esc(n.body) + '</p></div></div>';
  }

  function zonesHtml(s) {
    var total = s.zones.reduce(function (a, z) { return a + z.secs; }, 0) || 1;
    var max = Math.max.apply(null, s.zones.map(function (z) { return z.secs; })) || 1;
    return s.zones.map(function (z) {
      return '<div class="zone-row" title="' + Math.round(z.secs / total * 100) + '% of session"><div class="zl"><b>Z' + z.zone + ' ' + esc(z.name) + '</b><span>' + esc(z.range) + '</span></div>' +
        '<div class="bar-track"><div class="bar" style="width:' + (z.secs / max * 100) + '%;background:var(--z' + z.zone + ')"></div></div>' +
        '<div class="zv">' + fmtMin(z.secs) + '</div></div>';
    }).join('');
  }

  function windowControl(s) {
    var fr = s.fullRange;
    var steps = Math.max(1, Math.round((fr.endT - fr.startT) / 60000));
    var a = Math.round((s.stats.startT - fr.startT) / 60000), b = Math.round((s.stats.endT - fr.startT) / 60000);
    return '<details class="card" id="win-ctl"><summary>Adjust workout start / end</summary>' +
      '<p class="small muted" style="margin-top:8px">Lift Recap found the workout automatically in the data your shortcut sent. If it cut off a warm-up or included your drive home, fix it here. This re-runs the analysis and clears your edits.</p>' +
      '<div class="range-row"><span>Start</span><input type="range" min="0" max="' + steps + '" value="' + a + '" id="win-a"><span class="num-tab" id="win-a-l">' + fmtTime(s.stats.startT) + '</span></div>' +
      '<div class="range-row"><span>End</span><input type="range" min="0" max="' + steps + '" value="' + b + '" id="win-b"><span class="num-tab" id="win-b-l">' + fmtTime(s.stats.endT) + '</span></div>' +
      '<div class="btn-row" style="margin-top:12px"><button class="btn small primary" data-act="apply-window">Re-analyze</button><button class="btn small" data-act="auto-window">Auto-detect again</button></div></details>';
  }

  function bindRecap(root) {
    var s = state.session;
    $all('[data-focus]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        var f = b.dataset.focus;
        s.focusWasAuto = f === 'auto';
        s.focus = f === 'auto' ? s.autoFocus : f;
        E.nameExercises(s.exercises, s.focus, state.history);
        E.refresh(s, state.history);
        persistSession(); renderRecap();
      });
    });
    $all('.ex', root).forEach(function (card) {
      var i = +card.dataset.ex, ex = s.exercises[i];
      $('.ex-name', card).addEventListener('change', function (ev) {
        var v = ev.target.value.trim(); if (!v) return;
        ex.name = v; ex.userNamed = true; persistSession(); renderRecap();
      });
      $all('[data-alt]', card).forEach(function (b) {
        b.addEventListener('click', function () { ex.name = b.dataset.alt; ex.userNamed = true; persistSession(); renderRecap(); });
      });
      $all('input[data-set]', card).forEach(function (inp) {
        inp.addEventListener('change', function () {
          ex.sets[+inp.dataset.set][inp.dataset.field] = inp.value === '' ? '' : +inp.value;
          persistSession();
        });
      });
      $all('[data-exact]', card).forEach(function (b) {
        b.addEventListener('click', function () {
          var act = b.dataset.exact;
          if (act === 'merge') {
            var prev = s.exercises[i - 1];
            prev.sets = prev.sets.concat(ex.sets);
            s.exercises.splice(i, 1);
          } else if (act === 'split') {
            var half = Math.ceil(ex.sets.length / 2);
            var copy = JSON.parse(JSON.stringify(ex));
            copy.sets = ex.sets.slice(half); copy.userNamed = false; copy.id = ex.id + 'b';
            ex.sets = ex.sets.slice(0, half);
            s.exercises.splice(i + 1, 0, copy);
            E.nameExercises(s.exercises, s.focus, state.history);
          } else if (act === 'dropset') {
            ex.sets.pop();
            if (!ex.sets.length) s.exercises.splice(i, 1);
          } else if (act === 'delete') {
            s.exercises.splice(i, 1);
          }
          if (!s.exercises.length) { toast('No exercises left'); }
          else E.refresh(s, state.history);
          persistSession(); renderRecap();
        });
      });
    });
    $all('[data-act]', root).forEach(function (el) {
      var act = el.dataset.act;
      if (act === 'save') el.addEventListener('click', saveSession);
      if (act === 'copy-claude') el.addEventListener('click', copyForClaude);
      if (act === 'export') el.addEventListener('click', function () { download('lift-recap-' + new Date(s.stats.startT).toISOString().slice(0, 10) + '.json', JSON.stringify(s, null, 1)); });
      if (act === 'clear') el.addEventListener('click', function () {
        if (!confirm('Clear the current workout? Saved history is kept.')) return;
        state.session = null; state.raw = null; state.parsed = null;
        store.del('current'); store.del('raw'); renderRecap();
      });
      if (act === 'apply-window') el.addEventListener('click', function () {
        var fr = s.fullRange;
        var a = fr.startT + (+$('#win-a').value) * 60000, b = fr.startT + (+$('#win-b').value) * 60000;
        if (b - a < 5 * 60000) { toast('Window must be at least 5 minutes'); return; }
        reanalyze({ window: { startT: a, endT: b } });
      });
      if (act === 'auto-window') el.addEventListener('click', function () { reanalyze(); });
    });
    ['a', 'b'].forEach(function (k) {
      var r = $('#win-' + k); if (!r) return;
      r.addEventListener('input', function () { $('#win-' + k + '-l').textContent = fmtTime(s.fullRange.startT + (+r.value) * 60000); });
    });
  }

  // ---------- chart ----------
  function drawChart(host, s) {
    var W = Math.max(300, host.clientWidth || 600), H = W < 500 ? 220 : 260;
    var m = { l: 34, r: 8, t: 22, b: 24 };
    var pts = s.series;
    var t0 = pts[0][0], t1 = pts[pts.length - 1][0];
    var vals = pts.map(function (p) { return p[1]; });
    var yMin = Math.floor((Math.min.apply(null, vals) - 5) / 10) * 10, yMax = Math.ceil((Math.max.apply(null, vals) + 5) / 10) * 10;
    function x(t) { return m.l + (t - t0) / (t1 - t0) * (W - m.l - m.r); }
    function y(v) { return m.t + (1 - (v - yMin) / (yMax - yMin)) * (H - m.t - m.b); }
    var stepY = (yMax - yMin) > 80 ? 30 : 20;
    var grid = '', axis = '';
    for (var v = Math.ceil(yMin / stepY) * stepY; v <= yMax; v += stepY) {
      grid += '<line x1="' + m.l + '" x2="' + (W - m.r) + '" y1="' + y(v) + '" y2="' + y(v) + '"/>';
      axis += '<text x="' + (m.l - 6) + '" y="' + (y(v) + 4) + '" text-anchor="end">' + v + '</text>';
    }
    var spanMin = (t1 - t0) / 60000;
    var tickMin = spanMin > 100 ? 30 : spanMin > 45 ? 15 : 10;
    var first = Math.ceil(t0 / (tickMin * 60000)) * tickMin * 60000;
    for (var tt = first; tt <= t1; tt += tickMin * 60000) {
      var xx = x(tt);
      if (xx < m.l + 16 || xx > W - m.r - 16) continue;
      axis += '<text x="' + xx + '" y="' + (H - 6) + '" text-anchor="middle">' + fmtTime(tt) + '</text>';
    }
    var bands = '', labels = '';
    s.exercises.forEach(function (e, i) {
      e.sets.forEach(function (st) {
        bands += '<rect class="band" data-ex="' + i + '" x="' + x(st.startT) + '" y="' + m.t + '" width="' + Math.max(2, x(st.endT) - x(st.startT)) + '" height="' + (H - m.t - m.b) + '" rx="2"/>';
      });
      var cx = (x(e.startT) + x(e.endT)) / 2;
      labels += '<g class="ex-label"><circle cx="' + cx + '" cy="10" r="8" fill="none" stroke="currentColor" style="color:var(--text-3)"/><text x="' + cx + '" y="13.5" text-anchor="middle" font-size="10">' + (i + 1) + '</text></g>';
    });
    var d = pts.map(function (p, i) { return (i ? 'L' : 'M') + x(p[0]).toFixed(1) + ' ' + y(p[1]).toFixed(1); }).join('');
    host.innerHTML = '<svg viewBox="0 0 ' + W + ' ' + H + '" role="img" aria-label="Heart rate over the workout with estimated sets shaded">' +
      '<g class="grid">' + grid + '</g>' + bands + '<path class="line" d="' + d + '"/>' +
      '<g class="axis">' + axis + '</g>' + labels +
      '<line class="cross" id="cross" y1="' + m.t + '" y2="' + (H - m.b) + '" style="display:none"/><circle class="dot" id="cdot" r="4" style="display:none"/>' +
      '<rect id="hit" x="' + m.l + '" y="0" width="' + (W - m.l - m.r) + '" height="' + H + '" fill="transparent"/></svg>' +
      '<div class="tooltip" id="tip"></div>';

    var svg = $('svg', host), tip = $('#tip', host), cross = $('#cross', host), dot = $('#cdot', host);
    function locate(clientX) {
      var r = svg.getBoundingClientRect();
      var px = (clientX - r.left) / r.width * W;
      var t = t0 + (px - m.l) / (W - m.l - m.r) * (t1 - t0);
      var lo = 0, hi = pts.length - 1;
      while (hi - lo > 1) { var mid = (lo + hi) >> 1; if (pts[mid][0] < t) lo = mid; else hi = mid; }
      var p = Math.abs(pts[lo][0] - t) < Math.abs(pts[hi][0] - t) ? pts[lo] : pts[hi];
      var where = '';
      s.exercises.forEach(function (e, i) {
        e.sets.forEach(function (st, j) {
          if (p[0] >= st.startT - 2500 && p[0] <= st.endT + 2500) where = '<br>' + esc(e.name) + ' · set ' + (j + 1);
        });
      });
      var cx = x(p[0]), cy = y(p[1]);
      cross.setAttribute('x1', cx); cross.setAttribute('x2', cx); cross.style.display = '';
      dot.setAttribute('cx', cx); dot.setAttribute('cy', cy); dot.style.display = '';
      tip.innerHTML = '<b>' + Math.round(p[1]) + ' bpm</b> · ' + fmtTime(p[0]) + where;
      var left = cx / W * r.width;
      left = Math.max(70, Math.min(r.width - 70, left));
      tip.style.left = left + 'px'; tip.style.top = (cy / H * r.height - 10) + 'px'; tip.style.opacity = 1;
    }
    function hide() { tip.style.opacity = 0; cross.style.display = 'none'; dot.style.display = 'none'; }
    svg.addEventListener('pointermove', function (ev) { locate(ev.clientX); });
    svg.addEventListener('pointerdown', function (ev) { locate(ev.clientX); });
    svg.addEventListener('pointerleave', hide);
  }

  // ---------- actions ----------
  function saveSession() {
    var s = state.session; if (!s) return;
    var copy = JSON.parse(JSON.stringify(s));
    state.history = state.history.filter(function (h) { return h.id !== s.id; });
    state.history.unshift(copy);
    state.history.sort(function (a, b) { return b.stats.startT - a.stats.startT; });
    if (!store.set('history', state.history)) toast('Could not save — browser storage is full or blocked');
    else toast('Saved. Future guesses for ' + E.FOCI[s.focus].toLowerCase() + ' days will use these names.');
    updateDatalist();
    renderRecap();
  }

  function summaryText(s) {
    var st = s.stats, unit = state.profile.unit || 'kg';
    var lines = [];
    lines.push('You are my strength coach. Below is a summary of today\'s gym session. Sets and rest were inferred from my Apple Watch heart rate, so treat counts as approximate. Exercise names marked (guess) were not confirmed.');
    lines.push('');
    lines.push('Profile: age ' + s.profile.age + ', ' + s.profile.sex + ', ' + s.profile.weight + ' kg, resting HR ' + s.profile.restHR + ', max HR ' + s.profile.maxHR + '. Goal: ' + E.GOALS[s.profile.goal].label + '.');
    lines.push('Session: ' + fmtDate(st.startT) + ', ' + E.FOCI[s.focus] + ' day, ' + fmtMin(st.durationSec) + ', ' + st.sets + ' sets, training load (TRIMP) ' + Math.round(st.load) + ' (' + st.loadLabel + '), avg HR ' + st.avgHR + ', max HR ' + st.maxHR + ', typical rest ' + fmtRest(st.medianRest) + ', avg 60-s HR recovery ' + (st.avgHRR === null ? 'n/a' : st.avgHRR + ' bpm') + ', ~' + st.kcal + ' kcal.');
    lines.push('');
    s.exercises.forEach(function (e, i) {
      var sets = e.sets.map(function (x) {
        var rk = x.reps ? x.reps + (x.kg ? '×' + x.kg + unit : ' reps') : '';
        return (rk ? rk + ' ' : '') + '(peak ' + x.peakHR + ' bpm, rest ' + fmtRest(x.restAfter) + ')';
      }).join('; ');
      lines.push((i + 1) + '. ' + e.name + (e.userNamed ? '' : ' (guess)') + ' — ' + e.sets.length + ' sets: ' + sets);
    });
    var prev = state.history.filter(function (h) { return h.focus === s.focus && h.id !== s.id; })[0];
    if (prev) lines.push('', 'Last ' + E.FOCI[s.focus] + ' day (' + fmtDate(prev.stats.startT) + '): ' + prev.stats.sets + ' sets, load ' + Math.round(prev.stats.load) + ', ' + fmtMin(prev.stats.durationSec) + '. Exercises: ' + prev.exercises.map(function (e) { return e.name; }).join(', ') + '.');
    lines.push('', 'Please give me: (1) a short assessment of this session, (2) what to change next time (exercises, sets, reps, rest), and (3) a concrete plan for my next ' + E.FOCI[s.focus] + ' day.');
    return lines.join('\n');
  }

  function copyForClaude() {
    var text = summaryText(state.session);
    var done = function () { toast('Copied — paste it into Claude for coaching'); };
    if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, function () { fallbackCopy(text); done(); });
    else { fallbackCopy(text); done(); }
  }
  function fallbackCopy(text) {
    var ta = document.createElement('textarea'); ta.value = text; document.body.appendChild(ta); ta.select();
    try { document.execCommand('copy'); } catch (e) { /* ignore */ }
    ta.remove();
  }
  function download(name, text) {
    var a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([text], { type: 'application/json' }));
    a.download = name; document.body.appendChild(a); a.click(); a.remove();
  }

  // ----- history -----
  function renderHistory() {
    var root = $('#view-history');
    var h = state.history;
    if (!h.length) {
      root.innerHTML = '<div class="card import-hero"><h1>No saved workouts yet</h1><p class="muted">After a workout, tap <b>Save to history</b> on the recap. Your history stays on this device and helps Lift Recap learn your usual exercises.</p></div>';
      return;
    }
    var weekAgo = Date.now() - 7 * 864e5, monthAgo = Date.now() - 28 * 864e5;
    var wk = h.filter(function (x) { return x.stats.startT >= weekAgo; });
    var mo = h.filter(function (x) { return x.stats.startT >= monthAgo; });
    var sum = function (arr, f) { return arr.reduce(function (a, x) { return a + f(x); }, 0); };
    var tiles = [
      { k: 'This week', v: wk.length, unit: wk.length === 1 ? 'session' : 'sessions', s: sum(wk, function (x) { return x.stats.sets; }) + ' sets' },
      { k: 'Weekly load', v: Math.round(sum(wk, function (x) { return x.stats.load; })), s: '4-wk avg ' + Math.round(sum(mo, function (x) { return x.stats.load; }) / 4) },
      { k: 'Time lifting', v: fmtMin(sum(wk, function (x) { return x.stats.durationSec; })), s: 'last 7 days' },
      { k: 'All time', v: h.length, unit: 'workouts', s: 'since ' + new Date(h[h.length - 1].stats.startT).toLocaleDateString([], { month: 'short', day: 'numeric' }) }
    ];
    var trend = '';
    var wl = Math.round(sum(wk, function (x) { return x.stats.load; })), avg = sum(mo, function (x) { return x.stats.load; }) / 4;
    if (mo.length >= 4 && avg > 0) {
      var ratio = wl / avg;
      trend = '<div class="note ' + (ratio > 1.5 ? 'warn' : 'info') + '"><div class="ic">' + (ratio > 1.5 ? '!' : 'i') + '</div><div><h3>' +
        (ratio > 1.5 ? 'Load spike this week' : ratio < 0.6 ? 'Lighter week' : 'Load is steady') + '</h3><p>This week\'s load is ' + Math.round(ratio * 100) + '% of your 4-week average. ' +
        (ratio > 1.5 ? 'Jumps over ~150% raise injury and burnout risk. Consider an easier session next.' : ratio < 0.6 ? 'Fine as a planned deload. Otherwise, try to get back to your usual sessions.' : 'Steady, gradual increases are what drive progress.') + '</p></div></div>';
    }
    root.innerHTML = '<div><div class="eyebrow">History</div><h1>Your training</h1></div>' +
      '<div class="tiles">' + tiles.map(function (t) {
        return '<div class="tile"><div class="k">' + esc(t.k) + '</div><div class="v">' + esc(t.v) + (t.unit ? '<small>' + esc(t.unit) + '</small>' : '') + '</div><div class="s">' + esc(t.s) + '</div></div>';
      }).join('') + '</div>' + trend +
      h.map(function (x, i) {
        var d = new Date(x.stats.startT);
        return '<div class="card hist-item" data-i="' + i + '" tabindex="0" role="button">' +
          '<div class="hist-date"><div class="m">' + d.toLocaleDateString([], { month: 'short' }) + '</div><div class="d">' + d.getDate() + '</div></div>' +
          '<div class="hist-body"><h3>' + esc(E.FOCI[x.focus]) + ' · ' + fmtMin(x.stats.durationSec) + ' · ' + x.stats.sets + ' sets</h3>' +
          '<div class="names">' + esc(x.exercises.map(function (e) { return e.name; }).join(' · ')) + '</div></div>' +
          '<div class="hist-load"><b>' + Math.round(x.stats.load) + '</b><span class="small muted">' + esc(x.stats.loadLabel) + '</span></div>' +
          '<button class="btn ghost small danger" data-del="' + i + '" aria-label="Delete workout">✕</button></div>';
      }).join('') +
      '<div class="btn-row"><button class="btn ghost small" data-act="backup">Back up history (JSON)</button><label class="btn ghost small"><input type="file" accept=".json" hidden id="restore">Restore backup</label></div>';

    $all('.hist-item', root).forEach(function (el) {
      el.addEventListener('click', function (ev) {
        if (ev.target.closest('[data-del]')) return;
        state.session = JSON.parse(JSON.stringify(state.history[+el.dataset.i]));
        state.raw = null; state.parsed = null; store.del('raw');
        persistSession(); setView('recap');
      });
    });
    $all('[data-del]', root).forEach(function (b) {
      b.addEventListener('click', function () {
        if (!confirm('Delete this workout from history?')) return;
        state.history.splice(+b.dataset.del, 1); store.set('history', state.history); renderHistory();
      });
    });
    $('[data-act=backup]', root).addEventListener('click', function () { download('lift-recap-history.json', JSON.stringify(state.history)); });
    $('#restore', root).addEventListener('change', function (ev) {
      var f = ev.target.files[0]; if (!f) return;
      var r = new FileReader();
      r.onload = function () {
        try {
          var arr = JSON.parse(r.result); if (!Array.isArray(arr)) throw new Error();
          var ids = {}; state.history.forEach(function (x) { ids[x.id] = true; });
          arr.forEach(function (x) { if (x && x.id && x.stats && !ids[x.id]) state.history.push(x); });
          state.history.sort(function (a, b) { return b.stats.startT - a.stats.startT; });
          store.set('history', state.history); toast('History restored'); renderHistory();
        } catch (e) { toast('That file is not a Lift Recap backup'); }
      };
      r.readAsText(f);
    });
  }

  // ----- setup -----
  function renderSetup() {
    var root = $('#view-setup');
    var p = state.profile;
    var est = Math.round(208 - 0.7 * (+p.age || 30));
    root.innerHTML = '' +
      '<div><div class="eyebrow">Setup</div><h1>Connect your Apple Watch</h1>' +
      '<p class="muted" style="margin-top:6px">Apple doesn\'t let websites read your watch directly, so a free iPhone Shortcut does the hand-off. When your strength workout ends, it reads that workout\'s heart rate from the Health app and opens this page with the data. No apps to install, no accounts, nothing uploaded to a server.</p></div>' +
      '<div class="card"><div class="card-head"><h2>1 · Build the shortcut</h2><span class="small muted">Shortcuts app on iPhone · one time</span></div>' +
      '<ol class="steps">' +
      '<li>Open <b>Shortcuts</b> → <b>+</b> → name it <b>Lift Recap</b>.</li>' +
      '<li>Add <b>Find Health Samples</b>. Set <b>Type</b> = <i>Heart Rate</i>, filter <b>Start Date</b> <i>is in the last</i> <b>3 hours</b>, <b>Sort by</b> Start Date, <b>Order</b> Oldest First, <b>Limit</b> off.</li>' +
      '<li>Add <b>Repeat with Each</b> (on Health Samples). Inside it add <b>Format Date</b>: date = <i>Repeat Item → Start Date</i>, format = <b>ISO 8601</b>, include time on. Then add a <b>Text</b> action containing <code>Formatted Date,Repeat Item→Value</code> (comma in between, no spaces).</li>' +
      '<li>After <b>End Repeat</b>, add <b>Combine Text</b> (Repeat Results, separator <b>New Lines</b>), then <b>Copy to Clipboard</b> (backup in case the link is too long).</li>' +
      '<li>Add <b>URL Encode</b> (Combined Text), then a <b>Text</b> action with:<br><code>' + esc(APP_URL) + '#data=</code> followed by the <i>URL Encoded Text</i> variable.</li>' +
      '<li>Add <b>Open URLs</b> with that Text. Run it once and allow Health access to heart rate.</li>' +
      '</ol></div>' +
      '<div class="card"><div class="card-head"><h2>2 · Make it automatic</h2></div>' +
      '<ol class="steps">' +
      '<li>Shortcuts → <b>Automation</b> → <b>+</b> → <b>Apple Watch Workout</b> (on older iOS versions it may be called <i>Workout</i>).</li>' +
      '<li>Choose <b>Ends</b>, pick <b>Functional Strength Training</b> (add Traditional Strength Training too if you use it), and select <b>Run Immediately</b>.</li>' +
      '<li>Action: <b>Run Shortcut → Lift Recap</b>. Now, ending your workout on the watch opens the recap on your phone.</li>' +
      '</ol>' +
      '<p class="small muted">No automation option? Add the shortcut to your Home Screen or a widget and tap it right after you end your workout. If the page opens without data, tap <b>Paste from clipboard</b>.</p></div>' +
      '<div class="card"><div class="card-head"><h2>3 · Your profile</h2><span class="small muted">Makes zones, load and calories accurate</span></div>' +
      '<div class="form-grid">' +
      field('age', 'Age', 'number', p.age) +
      field('restHR', 'Resting HR', 'number', p.restHR, 'Health app → Heart → Resting Rate') +
      field('maxHR', 'Max HR', 'number', p.maxHR || '', 'Blank = estimate (' + est + ')') +
      field('weight', 'Body weight (kg)', 'number', p.weight) +
      '<div class="field"><label for="f-sex">Sex (for formulas)</label><select id="f-sex" data-k="sex"><option value="male"' + (p.sex === 'male' ? ' selected' : '') + '>Male</option><option value="female"' + (p.sex === 'female' ? ' selected' : '') + '>Female</option></select></div>' +
      '<div class="field"><label for="f-goal">Training goal</label><select id="f-goal" data-k="goal">' + Object.keys(E.GOALS).map(function (g) { return '<option value="' + g + '"' + (p.goal === g ? ' selected' : '') + '>' + E.GOALS[g].label + '</option>'; }).join('') + '</select></div>' +
      '<div class="field"><label for="f-unit">Weight unit for logging</label><select id="f-unit" data-k="unit"><option value="kg"' + (p.unit === 'kg' ? ' selected' : '') + '>kg</option><option value="lb"' + (p.unit === 'lb' ? ' selected' : '') + '>lb</option></select></div>' +
      '</div><div class="btn-row" style="margin-top:14px"><button class="btn primary" id="save-profile">Save profile</button></div></div>' +
      '<div class="card"><div class="card-head"><h2>How the guessing works</h2></div>' +
      '<p class="small muted">Each set makes your heart rate climb, and resting brings it back down, so the heart-rate trace looks like a saw blade. Lift Recap finds each climb (a set) and each drop (rest). A rest much longer than usual means you moved to a new exercise. How hard your heart worked tells big lifts apart from small ones: squats and deadlifts spike it, curls and raises barely move it. Combined with your focus for the day and the names you confirmed before, that gives a best guess at each exercise. The set count is usually close; the exercise names are educated guesses until you confirm them.</p>' +
      '<p class="small muted" style="margin-top:8px">Other data sources work too: CSV or JSON from <b>Health Auto Export</b>, or any file with timestamp and heart-rate columns.</p></div>';

    $('#save-profile', root).addEventListener('click', function () {
      var np = Object.assign({}, state.profile);
      $all('[data-k]', root).forEach(function (el) { np[el.dataset.k] = el.type === 'number' ? (el.value === '' ? 0 : +el.value) : el.value; });
      state.profile = np;
      store.set('profile', np);
      toast('Profile saved');
      if (state.session && state.raw) reanalyze();
    });
  }
  function field(k, label, type, val, hint) {
    return '<div class="field"><label for="f-' + k + '">' + esc(label) + '</label><input id="f-' + k + '" data-k="' + k + '" type="' + type + '" inputmode="numeric" value="' + esc(val) + '">' + (hint ? '<div class="hint">' + esc(hint) + '</div>' : '') + '</div>';
  }

  function updateDatalist() {
    var names = {};
    Object.keys(E.LIBRARY).forEach(function (f) { Object.keys(E.LIBRARY[f]).forEach(function (c) { E.LIBRARY[f][c].forEach(function (n) { names[n] = 1; }); }); });
    state.history.forEach(function (h) { h.exercises.forEach(function (e) { names[e.name] = 1; }); });
    $('#exercise-list').innerHTML = Object.keys(names).sort().map(function (n) { return '<option value="' + esc(n) + '">'; }).join('');
  }

  // ---------- boot ----------
  $all('.tabs button').forEach(function (b) { b.addEventListener('click', function () { setView(b.dataset.view); }); });
  var rT;
  window.addEventListener('resize', function () { clearTimeout(rT); rT = setTimeout(function () { if (state.view === 'recap' && state.session) drawChart($('#hr-chart'), state.session); }, 150); });
  window.addEventListener('hashchange', readHash);
  updateDatalist();
  render();
  readHash();
})();
