/*
 * Lift Recap engine — turns Apple Watch heart-rate samples from a strength
 * workout into estimated sets, exercises and coaching metrics.
 *
 * Pure functions, no DOM. Works in the browser (window.LiftEngine) and Node.
 *
 * How it infers sets from heart rate:
 *   - Lifting a set makes HR climb; resting makes it fall. The smoothed HR
 *     trace looks like a saw-tooth: trough -> peak = one working set,
 *     peak -> next trough = rest.
 *   - A zig-zag filter with an adaptive threshold finds those swings.
 *   - Rest gaps that are much longer than your usual rest (walking to a new
 *     station, setting up) mark a switch to a new exercise.
 *   - Each exercise block's intensity (HR rise, peak %HRmax, set length) is
 *     used to guess what kind of lift it was (heavy compound, compound,
 *     accessory, core, conditioning) and, with your focus for the day and
 *     your past sessions, a likely exercise name.
 */
(function (root) {
  'use strict';

  var STEP = 5; // seconds between resampled points
  var SET_LAG = 5; // HR keeps climbing a few seconds after the last rep

  var DEFAULT_PROFILE = {
    age: 30,
    restHR: 62,
    maxHR: 0, // 0 = estimate from age (Tanaka: 208 - 0.7 * age)
    weight: 75,
    sex: 'male',
    goal: 'hypertrophy'
  };

  var GOALS = {
    strength: { label: 'Strength', rest: [120, 300], reps: '3–6' },
    hypertrophy: { label: 'Muscle growth', rest: [60, 150], reps: '6–12' },
    endurance: { label: 'Muscular endurance', rest: [30, 90], reps: '12–20' }
  };

  var CATEGORIES = {
    heavy: { label: 'Heavy compound', hint: 'Big HR spike, long recovery' },
    compound: { label: 'Compound', hint: 'Moderate HR rise' },
    accessory: { label: 'Accessory / isolation', hint: 'Small HR rise' },
    core: { label: 'Core', hint: 'Short, low-HR sets late in the session' },
    cardio: { label: 'Conditioning', hint: 'Sustained elevated HR' }
  };

  var FOCI = {
    push: 'Push', pull: 'Pull', legs: 'Legs', upper: 'Upper body',
    lower: 'Lower body', full: 'Full body'
  };

  var LIBRARY = {
    push: {
      heavy: ['Barbell Bench Press', 'Incline Bench Press', 'Overhead Press'],
      compound: ['Overhead Press', 'Incline Dumbbell Press', 'Weighted Dips', 'Machine Chest Press', 'Dumbbell Shoulder Press'],
      accessory: ['Lateral Raises', 'Triceps Pushdown', 'Cable Chest Fly', 'Overhead Triceps Extension', 'Front Raises', 'Pec Deck'],
      core: ['Cable Crunch', 'Plank'],
      cardio: ['Conditioning finisher']
    },
    pull: {
      heavy: ['Deadlift', 'Barbell Row', 'Weighted Pull-ups'],
      compound: ['Lat Pulldown', 'Seated Cable Row', 'Chest-Supported Row', 'Pull-ups', 'T-Bar Row'],
      accessory: ['Biceps Curls', 'Face Pulls', 'Hammer Curls', 'Rear Delt Fly', 'Shrugs', 'Preacher Curls'],
      core: ['Hanging Knee Raise', 'Plank'],
      cardio: ['Rowing intervals']
    },
    legs: {
      heavy: ['Back Squat', 'Romanian Deadlift', 'Leg Press', 'Bulgarian Split Squat', 'Walking Lunges'],
      compound: ['Hack Squat', 'Hip Thrust', 'Leg Press', 'Goblet Squat', 'Step-ups'],
      accessory: ['Leg Extension', 'Lying Hamstring Curl', 'Calf Raises', 'Hip Abduction', 'Seated Hamstring Curl'],
      core: ['Hanging Leg Raise', 'Ab Wheel'],
      cardio: ['Bike / sled finisher']
    },
    upper: {
      heavy: ['Barbell Bench Press', 'Barbell Row', 'Weighted Pull-ups'],
      compound: ['Overhead Press', 'Lat Pulldown', 'Incline Dumbbell Press', 'Seated Cable Row', 'Dips'],
      accessory: ['Lateral Raises', 'Biceps Curls', 'Triceps Pushdown', 'Face Pulls', 'Hammer Curls', 'Cable Fly'],
      core: ['Cable Crunch', 'Plank'],
      cardio: ['Conditioning finisher']
    },
    lower: {
      heavy: ['Back Squat', 'Deadlift', 'Leg Press', 'Front Squat'],
      compound: ['Romanian Deadlift', 'Hip Thrust', 'Bulgarian Split Squat', 'Hack Squat', 'Walking Lunges'],
      accessory: ['Leg Extension', 'Hamstring Curl', 'Calf Raises', 'Hip Abduction', 'Back Extension'],
      core: ['Hanging Leg Raise', 'Ab Wheel'],
      cardio: ['Bike / sled finisher']
    },
    full: {
      heavy: ['Back Squat', 'Deadlift', 'Barbell Bench Press', 'Leg Press'],
      compound: ['Barbell Row', 'Overhead Press', 'Pull-ups / Lat Pulldown', 'Incline Dumbbell Press', 'Kettlebell Swings'],
      accessory: ['Biceps Curls', 'Lateral Raises', 'Triceps Pushdown', 'Calf Raises', 'Face Pulls'],
      core: ['Plank', 'Hanging Leg Raise', 'Cable Crunch'],
      cardio: ['Conditioning circuit']
    }
  };

  // ---------- small helpers ----------
  function clamp(x, a, b) { return Math.max(a, Math.min(b, x)); }
  function mean(a) { return a.length ? a.reduce(function (s, x) { return s + x; }, 0) / a.length : 0; }
  function quantile(a, q) {
    if (!a.length) return 0;
    var s = a.slice().sort(function (x, y) { return x - y; });
    var pos = (s.length - 1) * q, lo = Math.floor(pos), hi = Math.ceil(pos);
    return s[lo] + (s[hi] - s[lo]) * (pos - lo);
  }
  function median(a) { return quantile(a, 0.5); }
  function norm(x, a, b) { return clamp((x - a) / (b - a), 0, 1); }

  function profileWithDefaults(p) {
    var out = {};
    for (var k in DEFAULT_PROFILE) out[k] = DEFAULT_PROFILE[k];
    if (p) for (var j in p) if (p[j] !== '' && p[j] !== null && p[j] !== undefined) out[j] = p[j];
    out.age = +out.age; out.restHR = +out.restHR; out.weight = +out.weight; out.maxHR = +out.maxHR;
    if (!out.maxHR) out.maxHR = Math.round(208 - 0.7 * out.age);
    if (!GOALS[out.goal]) out.goal = 'hypertrophy';
    return out;
  }

  // ---------- parsing ----------
  function parseTime(tok) {
    tok = String(tok).trim().replace(/^"|"$/g, '');
    if (/^\d{10}(\.\d+)?$/.test(tok)) return parseFloat(tok) * 1000; // epoch seconds
    if (/^\d{13}$/.test(tok)) return parseInt(tok, 10); // epoch ms
    if (tok.length < 8 || !/\d{1,4}[-/:]\d/.test(tok)) return NaN;
    // Apple Health exports use "2026-11-25 18:01:05 -0800"
    var m = tok.match(/^(\d{4}-\d{2}-\d{2}) (\d{2}:\d{2}:\d{2}) ([+-]\d{2})(\d{2})$/);
    if (m) tok = m[1] + 'T' + m[2] + m[3] + ':' + m[4];
    var t = Date.parse(tok);
    if (isNaN(t) && /^\d{4}-\d{2}-\d{2} \d/.test(tok)) t = Date.parse(tok.replace(' ', 'T'));
    return t;
  }

  /**
   * Accepts many shapes of text:
   *   2026-11-25T18:01:05-08:00,128          (from the Shortcut)
   *   HR,2026-11-25T18:01:05-08:00,128
   *   KCAL,2026-11-25T18:01:05-08:00,4.2
   *   CSV with a header row (Health Auto Export etc.)
   *   JSON array of {date|startDate|t, value|qty|bpm|v}
   * Returns { hr: [{t, v}], kcal: [{t, v}] } sorted by time.
   */
  function parseInput(text) {
    var hr = [], kcal = [];
    text = String(text || '').trim();
    if (!text) return { hr: hr, kcal: kcal };

    if (text[0] === '[' || text[0] === '{') {
      try {
        var j = JSON.parse(text);
        if (j && j.samples) j = j.samples;
        if (j && j.data && j.data.metrics) { // Health Auto Export JSON
          j.data.metrics.forEach(function (m) {
            (m.data || []).forEach(function (d) {
              var t = parseTime(d.date), v = +(d.Avg || d.qty || d.Max);
              if (!isNaN(t) && isFinite(v)) (/energy/i.test(m.name) ? kcal : hr).push({ t: t, v: v });
            });
          });
        } else if (Array.isArray(j)) {
          j.forEach(function (d) {
            var t = typeof d.t === 'number' ? d.t : parseTime(d.date || d.startDate || d.t || d.time);
            var v = +(d.value !== undefined ? d.value : d.qty !== undefined ? d.qty : d.bpm !== undefined ? d.bpm : d.v);
            var type = String(d.type || 'hr');
            if (!isNaN(t) && isFinite(v)) (/kcal|energy|cal/i.test(type) ? kcal : hr).push({ t: t, v: v });
          });
        }
      } catch (e) { /* fall through to line parsing */ }
    }

    if (!hr.length) {
      var lines = text.split(/\r?\n|\u2028|\s{2,}(?=\d{4}-)/);
      lines.forEach(function (line) {
        line = line.trim();
        if (!line) return;
        var toks = line.split(/[,;|\t]/).map(function (s) { return s.trim(); }).filter(Boolean);
        var t = NaN, v = NaN, type = 'hr';
        for (var i = 0; i < toks.length; i++) {
          var tk = toks[i];
          if (/^(kcal|energy|active ?energy|cal|e)$/i.test(tk)) { type = 'kcal'; continue; }
          if (/^(hr|heart ?rate|bpm)$/i.test(tk)) continue;
          if (isNaN(t)) {
            var pt = parseTime(tk);
            if (!isNaN(pt)) { t = pt; continue; }
          }
          var num = tk.match(/-?\d+(\.\d+)?/);
          if (num && !/\d{4}-\d{2}/.test(tk)) v = parseFloat(num[0]);
        }
        if (!isNaN(t) && isFinite(v)) (type === 'kcal' ? kcal : hr).push({ t: t, v: v });
      });
    }

    hr = hr.filter(function (s) { return s.v >= 30 && s.v <= 240; });
    var byT = function (a, b) { return a.t - b.t; };
    hr.sort(byT); kcal.sort(byT);
    // de-duplicate identical timestamps
    hr = hr.filter(function (s, i) { return i === 0 || s.t !== hr[i - 1].t; });
    return { hr: hr, kcal: kcal };
  }

  // ---------- signal processing ----------
  function resample(samples) {
    var out = [];
    if (samples.length < 2) return out;
    var t0 = samples[0].t, t1 = samples[samples.length - 1].t, j = 0;
    for (var t = t0; t <= t1; t += STEP * 1000) {
      while (j < samples.length - 2 && samples[j + 1].t < t) j++;
      var a = samples[j], b = samples[j + 1] || a, gap = b.t - a.t;
      var v = gap > 0 ? a.v + (b.v - a.v) * clamp((t - a.t) / gap, 0, 1) : a.v;
      out.push({ t: t, raw: v, gap: gap > 180000 });
    }
    return out;
  }

  function smooth(series, radius) {
    return series.map(function (p, i) {
      var s = 0, n = 0;
      for (var k = Math.max(0, i - radius); k <= Math.min(series.length - 1, i + radius); k++) { s += series[k].raw; n++; }
      return { t: p.t, raw: p.raw, v: s / n, gap: p.gap };
    });
  }

  /** Finds the main workout block: longest stretch of elevated HR. */
  function findWorkoutWindow(series, profile) {
    if (!series.length) return null;
    var vals = series.map(function (p) { return p.v; });
    var base = Math.min(profile.restHR, quantile(vals, 0.1));
    var thr = base + Math.max(18, 0.12 * (profile.maxHR - base));
    var segs = [], cur = null;
    series.forEach(function (p, i) {
      if (p.v >= thr && !p.gap) {
        if (!cur) cur = { a: i, b: i }; else cur.b = i;
      } else if (cur) { segs.push(cur); cur = null; }
    });
    if (cur) segs.push(cur);
    if (!segs.length) return { a: 0, b: series.length - 1 };
    // merge segments separated by < 6 minutes
    var merged = [segs[0]];
    for (var i = 1; i < segs.length; i++) {
      var last = merged[merged.length - 1];
      if ((series[segs[i].a].t - series[last.b].t) < 6 * 60000) last.b = segs[i].b; else merged.push(segs[i]);
    }
    merged.sort(function (x, y) { return (series[y.b].t - series[y.a].t) - (series[x.b].t - series[x.a].t); });
    var best = merged[0];
    var pad = Math.round(60 / STEP);
    return { a: Math.max(0, best.a - pad), b: Math.min(series.length - 1, best.b + pad) };
  }

  function zigzag(vals, D) {
    var piv = [], trend = 0, cand = 0, minI = 0, maxI = 0;
    for (var i = 1; i < vals.length; i++) {
      if (trend === 0) {
        if (vals[i] < vals[minI]) minI = i;
        if (vals[i] > vals[maxI]) maxI = i;
        if (vals[i] - vals[minI] >= D) { piv.push({ i: minI, type: 'trough' }); trend = 1; cand = i; }
        else if (vals[maxI] - vals[i] >= D) { piv.push({ i: maxI, type: 'peak' }); trend = -1; cand = i; }
      } else if (trend === 1) {
        if (vals[i] >= vals[cand]) cand = i;
        else if (vals[cand] - vals[i] >= D) { piv.push({ i: cand, type: 'peak' }); trend = -1; cand = i; }
      } else {
        if (vals[i] <= vals[cand]) cand = i;
        else if (vals[i] - vals[cand] >= D) { piv.push({ i: cand, type: 'trough' }); trend = 1; cand = i; }
      }
    }
    if (trend !== 0) piv.push({ i: cand, type: trend === 1 ? 'peak' : 'trough' });
    return piv;
  }

  // ---------- core analysis ----------
  function detectSets(win, profile) {
    var vals = win.map(function (p) { return p.v; });
    var range = quantile(vals, 0.95) - quantile(vals, 0.05);
    var D = clamp(0.16 * range, 6, 11);
    var piv = zigzag(vals, D);
    var sets = [];
    for (var k = 0; k < piv.length - 1; k++) {
      if (piv[k].type !== 'trough' || piv[k + 1].type !== 'peak') continue;
      var tr = piv[k].i, pk = piv[k + 1].i;
      // The zig-zag trough can sit anywhere in a flat rest/warm-up plateau.
      // Walk back from the peak to where HR actually started climbing.
      var st = pk;
      while (st - 3 > tr && vals[st] - vals[st - 3] > 1.5) st--;
      if (vals[pk] - vals[st] >= 0.6 * (vals[pk] - vals[tr]) || ((pk - st) * STEP <= 150 && vals[pk] - vals[st] >= D)) tr = st;
      var upSec = (pk - tr) * STEP;
      var sustained = upSec > 180;
      var startI = tr, endI = Math.max(tr + 2, pk - Math.round(SET_LAG / STEP));
      var setSec = clamp((endI - startI) * STEP, 10, sustained ? 3600 : 150);
      // heart-rate recovery: drop in the 60 s after the peak (if not interrupted)
      var nextTr = piv[k + 2] ? piv[k + 2].i : vals.length - 1;
      var i60 = pk + Math.round(60 / STEP);
      var hrr = i60 <= nextTr + 1 && i60 < vals.length ? vals[pk] - vals[i60] : null;
      sets.push({
        startT: win[startI].t,
        endT: win[startI].t + setSec * 1000,
        peakT: win[pk].t,
        troughHR: Math.round(vals[tr]),
        peakHR: Math.round(vals[pk]),
        rise: vals[pk] - vals[tr],
        durSec: setSec,
        hrr60: hrr === null ? null : Math.round(hrr),
        sustained: sustained
      });
    }
    // a sustained climb that is really a cardio block shows up as one long "set"
    for (var s = 0; s < sets.length; s++) {
      sets[s].restAfter = s < sets.length - 1 ? Math.max(0, (sets[s + 1].startT - sets[s].endT) / 1000) : null;
    }
    return { sets: sets, threshold: D };
  }

  function groupIntoExercises(sets) {
    if (!sets.length) return [];
    var rests = sets.map(function (s) { return s.restAfter; }).filter(function (r) { return r !== null && r < 900; });
    var med = median(rests) || 90;
    var scores = [];
    for (var i = 0; i < sets.length - 1; i++) {
      var a = sets[i], b = sets[i + 1];
      var featChange = Math.abs(b.rise - a.rise) / Math.max(8, (a.rise + b.rise) / 2);
      var score = (a.restAfter / med) + 0.8 * featChange;
      if (a.sustained !== b.sustained) score += 2;
      scores.push({ i: i, score: score, rest: a.restAfter });
    }
    var cut = {};
    scores.forEach(function (s) {
      if (s.rest > Math.max(150, 1.5 * med) || s.score > 2.2 || s.rest > 330) cut[s.i] = true;
    });
    function groupCount() { return Object.keys(cut).length + 1; }
    var ranked = scores.slice().sort(function (x, y) { return y.score - x.score; });
    var r = 0;
    while (sets.length / groupCount() > 4.5 && r < ranked.length) {
      if (ranked[r].rest > 1.2 * med) cut[ranked[r].i] = true;
      r++;
    }
    var groups = [], cur = [];
    sets.forEach(function (s, idx) {
      cur.push(s);
      if (cut[idx] || idx === sets.length - 1) { groups.push(cur); cur = []; }
    });
    // split any monster groups (> 6 sets) in half at their longest rest
    var out = [];
    groups.forEach(function (g) {
      while (g.length > 6) {
        var best = 2, bestRest = -1;
        for (var k = 2; k < g.length - 2; k++) if (g[k].restAfter > bestRest) { bestRest = g[k].restAfter; best = k; }
        out.push(g.slice(0, best + 1)); g = g.slice(best + 1);
      }
      out.push(g);
    });
    return out;
  }

  function classify(groups, profile) {
    var feats = groups.map(function (g, idx) {
      var rise = mean(g.map(function (s) { return s.rise; }));
      var peakPct = mean(g.map(function (s) { return s.peakHR; })) / profile.maxHR;
      var dur = mean(g.map(function (s) { return s.durSec; }));
      var I = 0.6 * norm(rise, 8, 38) + 0.4 * norm(peakPct, 0.6, 0.9);
      return { rise: rise, peakPct: peakPct, dur: dur, I: I, pos: groups.length > 1 ? idx / (groups.length - 1) : 0, sustained: g.some(function (s) { return s.sustained; }) };
    });
    var Is = feats.map(function (f) { return f.I; });
    var lo = Math.min.apply(null, Is), hi = Math.max.apply(null, Is);
    return feats.map(function (f) {
      var rel = hi - lo > 0.05 ? (f.I - lo) / (hi - lo) : 0.5;
      var score = 0.55 * f.I + 0.45 * rel;
      var cat, margin;
      if (f.sustained) { cat = 'cardio'; margin = 0.3; }
      else if (score >= 0.62) { cat = 'heavy'; margin = score - 0.62; }
      else if (score >= 0.36) { cat = 'compound'; margin = Math.min(score - 0.36, 0.62 - score); }
      else if (f.pos >= 0.75 && f.dur <= 40 && f.rise < 14) { cat = 'core'; margin = 0.05; }
      else { cat = 'accessory'; margin = 0.36 - score; }
      f.category = cat;
      f.score = score;
      f.confidence = margin > 0.12 ? 'likely' : 'possible';
      return f;
    });
  }

  function guessFocus(feats) {
    var heavy = feats.filter(function (f) { return f.category === 'heavy'; }).length;
    var n = feats.length || 1;
    var avgPeak = mean(feats.map(function (f) { return f.peakPct; }));
    if (heavy / n >= 0.45 && avgPeak > 0.74) return 'legs';
    if (heavy / n >= 0.3) return 'full';
    return 'upper';
  }

  /** history: array of saved sessions, newest first. */
  function nameExercises(exercises, focus, history) {
    var lib = LIBRARY[focus] || LIBRARY.full;
    var used = {};
    var past = (history || []).filter(function (h) { return h.focus === focus; })[0];
    var pastByCat = {};
    if (past) past.exercises.forEach(function (e) {
      (pastByCat[e.category] = pastByCat[e.category] || []).push(e.name);
    });
    exercises.forEach(function (ex) {
      if (ex.userNamed) { used[ex.name] = true; return; }
      var pool = (pastByCat[ex.category] || []).concat(lib[ex.category] || [], lib.accessory);
      var pick = null;
      for (var i = 0; i < pool.length; i++) if (!used[pool[i]]) { pick = pool[i]; break; }
      ex.name = pick || CATEGORIES[ex.category].label;
      ex.fromHistory = !!(pastByCat[ex.category] && pastByCat[ex.category].indexOf(ex.name) >= 0);
      ex.alternatives = pool.filter(function (n, k) { return n !== ex.name && pool.indexOf(n) === k; }).slice(0, 4);
      used[ex.name] = true;
    });
    return exercises;
  }

  function trimp(win, profile) {
    var k = profile.sex === 'female' ? [0.86, 1.67] : [0.64, 1.92];
    var load = 0;
    win.forEach(function (p) {
      var r = clamp((p.v - profile.restHR) / (profile.maxHR - profile.restHR), 0, 1);
      load += (STEP / 60) * r * k[0] * Math.exp(k[1] * r);
    });
    return load;
  }

  function loadLabel(load) {
    if (load < 25) return 'Light';
    if (load < 50) return 'Moderate';
    if (load < 85) return 'Hard';
    return 'Very hard';
  }

  function keytelKcal(win, profile) {
    var kcal = 0;
    win.forEach(function (p) {
      var perMin = profile.sex === 'female'
        ? (-20.4022 + 0.4472 * p.v - 0.1263 * profile.weight + 0.074 * profile.age) / 4.184
        : (-55.0969 + 0.6309 * p.v + 0.1988 * profile.weight + 0.2017 * profile.age) / 4.184;
      kcal += Math.max(1.2, perMin) * STEP / 60;
    });
    return kcal;
  }

  function zones(win, profile) {
    var bounds = [0.6, 0.7, 0.8, 0.9];
    var names = ['Easy', 'Light', 'Moderate', 'Hard', 'Max'];
    var secs = [0, 0, 0, 0, 0];
    win.forEach(function (p) {
      var pct = p.v / profile.maxHR, z = 0;
      while (z < 4 && pct >= bounds[z]) z++;
      secs[z] += STEP;
    });
    return names.map(function (n, i) {
      return { zone: i + 1, name: n, secs: secs[i], range: i === 0 ? '< 60%' : i === 4 ? '90%+' : Math.round(bounds[i - 1] * 100) + '–' + Math.round(bounds[i] * 100) + '%' };
    });
  }

  function coachNotes(s, profile, history) {
    var notes = [];
    var goal = GOALS[profile.goal];
    var mr = s.stats.medianRest;
    if (mr) {
      if (mr > goal.rest[1]) notes.push({ tone: 'warn', title: 'Rest periods ran long', body: 'Your typical rest was about ' + fmtDur(mr) + '. For ' + goal.label.toLowerCase() + ', ' + fmtDur(goal.rest[0]) + '–' + fmtDur(goal.rest[1]) + ' is usually enough. A rest timer would tighten the session without losing quality.' });
      else if (mr < goal.rest[0]) notes.push({ tone: 'warn', title: 'Rests were short', body: 'Typical rest was ' + fmtDur(mr) + '. For ' + goal.label.toLowerCase() + ' aim for ' + fmtDur(goal.rest[0]) + '–' + fmtDur(goal.rest[1]) + ' so you can keep the weight up set after set.' });
      else notes.push({ tone: 'good', title: 'Rest periods on target', body: 'Typical rest of ' + fmtDur(mr) + ' fits a ' + goal.label.toLowerCase() + ' goal (' + fmtDur(goal.rest[0]) + '–' + fmtDur(goal.rest[1]) + ').' });
    }
    // recovery trend
    var hrrs = s.sets.map(function (x) { return x.hrr60; }).filter(function (x) { return x !== null; });
    if (hrrs.length >= 6) {
      var third = Math.floor(hrrs.length / 3);
      var early = mean(hrrs.slice(0, third)), late = mean(hrrs.slice(-third));
      if (early > 0 && late < early * 0.75) notes.push({ tone: 'warn', title: 'Recovery slowed late in the session', body: 'Your heart rate dropped ' + Math.round(early) + ' bpm in the minute after early sets, but only ' + Math.round(late) + ' bpm near the end. That is fatigue piling up — put your most important lifts first and consider stopping 1–2 sets sooner.' });
      else if (early > 0) notes.push({ tone: 'good', title: 'Recovery held up', body: 'Heart-rate recovery stayed steady from the first sets to the last (' + Math.round(early) + ' → ' + Math.round(late) + ' bpm drop in 60 s). You had more in the tank — you could add a set or a little weight.' });
    }
    if (s.stats.avgHRR !== null && s.stats.avgHRR < 12) notes.push({ tone: 'info', title: 'Cardio base could help', body: 'An average 60-second heart-rate drop under 12 bpm suggests your heart is slow to recover between sets. Two 20–30 min easy cardio sessions a week usually improve this within a month.' });
    // HR creep inside exercises
    var creep = s.exercises.filter(function (e) { return e.sets.length >= 3 && e.sets[e.sets.length - 1].peakHR - e.sets[0].peakHR >= 10; });
    if (creep.length) notes.push({ tone: 'info', title: 'Heart rate climbed set to set', body: creep.map(function (e) { return e.name; }).join(', ') + ' got harder on your heart as the sets went on. Normal for hard sets. If the last set felt like a grind, keep the weight the same next time instead of adding more.' });
    // density
    var dens = s.stats.density;
    if (dens < 0.12 && s.stats.durationSec > 1800) notes.push({ tone: 'info', title: 'Low work density', body: 'Only about ' + Math.round(dens * 100) + '% of the session was spent under load. Supersetting accessories (e.g. curls with triceps) can cut 10–15 minutes without cutting work.' });
    if (s.stats.durationSec > 85 * 60) notes.push({ tone: 'info', title: 'Long session', body: 'Over ' + Math.round(s.stats.durationSec / 60) + ' minutes. Past roughly 75 minutes, focus and output tend to drop. Consider trimming an exercise or two.' });
    // best effort
    var top = s.exercises.slice().sort(function (a, b) { return b.score - a.score; })[0];
    if (top) notes.push({ tone: 'info', title: 'Hardest block: ' + top.name, body: 'Peaked at ' + Math.max.apply(null, top.sets.map(function (x) { return x.peakHR; })) + ' bpm (' + Math.round(top.peakPct * 100) + '% of max) with a ' + Math.round(top.rise) + ' bpm average rise per set.' });
    // vs last session of same focus
    var prev = (history || []).filter(function (h) { return h.focus === s.focus && h.id !== s.id; })[0];
    if (prev) {
      var dl = s.stats.load - prev.stats.load;
      notes.push({ tone: dl >= 0 ? 'good' : 'info', title: 'Compared to your last ' + (FOCI[s.focus] || '').toLowerCase() + ' day', body: 'Training load ' + (dl >= 0 ? 'up ' : 'down ') + Math.abs(Math.round(dl)) + ' (' + Math.round(prev.stats.load) + ' → ' + Math.round(s.stats.load) + '), sets ' + prev.stats.sets + ' → ' + s.stats.sets + ', duration ' + Math.round(prev.stats.durationSec / 60) + ' → ' + Math.round(s.stats.durationSec / 60) + ' min.' });
    }
    notes.push({ tone: 'info', title: 'Next session', body: 'For ' + goal.label.toLowerCase() + ': ' + goal.reps + ' reps per set, stopping 1–3 reps short of failure. If every set of an exercise felt this manageable, add 2.5–5% weight next time.' });
    return notes;
  }

  function fmtDur(sec) {
    sec = Math.round(sec);
    if (sec < 60) return sec + ' s';
    var m = Math.floor(sec / 60), s = sec % 60;
    return s ? m + ':' + (s < 10 ? '0' : '') + s + ' min' : m + ' min';
  }

  function computeStats(win, sets, exercises, profile, kcalSamples) {
    var vals = win.map(function (p) { return p.v; });
    var durationSec = (win[win.length - 1].t - win[0].t) / 1000;
    var workSec = sets.reduce(function (s, x) { return s + x.durSec; }, 0);
    var rests = sets.map(function (x) { return x.restAfter; }).filter(function (r) { return r !== null && r < 600; });
    var hrrs = sets.map(function (x) { return x.hrr60; }).filter(function (x) { return x !== null; });
    var load = trimp(win, profile);
    var watchKcal = (kcalSamples || []).filter(function (k) { return k.t >= win[0].t && k.t <= win[win.length - 1].t; })
      .reduce(function (s, k) { return s + k.v; }, 0);
    return {
      startT: win[0].t,
      endT: win[win.length - 1].t,
      durationSec: durationSec,
      workSec: workSec,
      restSec: Math.max(0, durationSec - workSec),
      density: durationSec ? workSec / durationSec : 0,
      sets: sets.length,
      exercises: exercises.length,
      avgHR: Math.round(mean(vals)),
      maxHR: Math.round(Math.max.apply(null, win.map(function (p) { return p.raw; }))),
      medianRest: rests.length ? median(rests) : null,
      avgHRR: hrrs.length ? Math.round(mean(hrrs)) : null,
      load: load,
      loadLabel: loadLabel(load),
      kcal: Math.round(watchKcal > 20 ? watchKcal : keytelKcal(win, profile)),
      kcalSource: watchKcal > 20 ? 'watch' : 'estimate'
    };
  }

  /**
   * Main entry.
   * opts: { profile, focus ('auto'|key), history, window: {startT, endT} }
   */
  function analyze(parsed, opts) {
    opts = opts || {};
    var profile = profileWithDefaults(opts.profile);
    if (!parsed.hr || parsed.hr.length < 20) throw new Error('Not enough heart-rate samples (need at least 20, got ' + (parsed.hr ? parsed.hr.length : 0) + ').');
    var series = smooth(resample(parsed.hr), 1);
    var w;
    if (opts.window && opts.window.startT) {
      var a = 0, b = series.length - 1;
      while (a < b && series[a].t < opts.window.startT) a++;
      while (b > a && series[b].t > opts.window.endT) b--;
      w = { a: a, b: b };
    } else w = findWorkoutWindow(series, profile);
    var win = series.slice(w.a, w.b + 1);
    if (win.length < 24) throw new Error('The workout window is too short to analyse.');

    var det = detectSets(win, profile);
    var groups = groupIntoExercises(det.sets);
    var feats = classify(groups, profile);
    var autoFocus = guessFocus(feats);
    var focus = opts.focus && opts.focus !== 'auto' ? opts.focus : autoFocus;

    var exercises = groups.map(function (g, i) {
      var f = feats[i];
      return {
        id: 'ex' + i,
        sets: g,
        category: f.category,
        confidence: f.confidence,
        rise: f.rise,
        peakPct: f.peakPct,
        score: f.score,
        startT: g[0].startT,
        endT: g[g.length - 1].endT
      };
    });
    nameExercises(exercises, focus, opts.history);
    var stats = computeStats(win, det.sets, exercises, profile, parsed.kcal);

    var session = {
      id: 'w' + Math.round(win[0].t / 1000),
      createdAt: Date.now(),
      focus: focus,
      autoFocus: autoFocus,
      focusWasAuto: !(opts.focus && opts.focus !== 'auto'),
      profile: profile,
      series: win.map(function (p) { return [p.t, Math.round(p.v * 10) / 10]; }),
      fullRange: { startT: series[0].t, endT: series[series.length - 1].t },
      sets: det.sets,
      exercises: exercises,
      stats: stats,
      zones: zones(win, profile)
    };
    session.notes = coachNotes(session, profile, opts.history);
    return session;
  }

  /** Recompute stats + notes after the user edits exercises (merge/delete/rename). */
  function refresh(session, history) {
    var win = session.series.map(function (p) { return { t: p[0], v: p[1], raw: p[1] }; });
    var sets = [];
    session.exercises.forEach(function (e) { sets = sets.concat(e.sets); });
    sets.sort(function (a, b) { return a.startT - b.startT; });
    sets.forEach(function (s, i) { s.restAfter = i < sets.length - 1 ? Math.max(0, (sets[i + 1].startT - s.endT) / 1000) : null; });
    session.sets = sets;
    session.exercises.forEach(function (e) { e.startT = e.sets[0].startT; e.endT = e.sets[e.sets.length - 1].endT; });
    var keepKcal = session.stats.kcalSource === 'watch' ? session.stats.kcal : null;
    session.stats = computeStats(win, sets, session.exercises, session.profile, []);
    if (keepKcal) { session.stats.kcal = keepKcal; session.stats.kcalSource = 'watch'; }
    session.notes = coachNotes(session, session.profile, history);
    return session;
  }

  // ---------- demo data ----------
  function seededRandom(seed) {
    return function () { seed = (seed * 1664525 + 1013904223) % 4294967296; return seed / 4294967296; };
  }

  /** Simulates a push day as Apple Watch would record it (one sample / 5 s). */
  function demoText(endT) {
    var rnd = seededRandom(42);
    var plan = [
      { sets: 4, work: 40, peak: 140, rest: 140 },
      { sets: 3, work: 35, peak: 132, rest: 120 },
      { sets: 3, work: 40, peak: 128, rest: 100 },
      { sets: 3, work: 35, peak: 114, rest: 75 },
      { sets: 3, work: 40, peak: 112, rest: 70 },
      { sets: 3, work: 30, peak: 108, rest: 60 }
    ];
    var timeline = []; // [durationSec, targetHR, tau]
    timeline.push([8 * 60, 72, 30]);   // before workout
    timeline.push([6 * 60, 102, 40]);  // warm-up
    plan.forEach(function (ex, ei) {
      for (var s = 0; s < ex.sets; s++) {
        var fatigue = s * 3;
        timeline.push([ex.work + Math.round(rnd() * 8), ex.peak + fatigue + 10, 16]);
        timeline.push([s === ex.sets - 1 ? 210 + Math.round(rnd() * 60) : ex.rest + Math.round(rnd() * 25 - 10), 96 + ei * -1, 32]);
      }
    });
    timeline.push([10 * 60, 74, 60]); // after workout
    var total = timeline.reduce(function (s, x) { return s + x[0]; }, 0);
    var t0 = (endT || Date.now()) - total * 1000;
    var hr = 72, t = 0, lines = [];
    timeline.forEach(function (seg) {
      for (var i = 0; i < seg[0]; i++, t++) {
        hr += (seg[1] - hr) / seg[2];
        if (t % 5 === 0) lines.push(new Date(t0 + t * 1000).toISOString() + ',' + Math.round(hr + (rnd() - 0.5) * 3));
      }
    });
    return lines.join('\n');
  }

  var api = {
    parseInput: parseInput,
    analyze: analyze,
    refresh: refresh,
    nameExercises: nameExercises,
    demoText: demoText,
    fmtDur: fmtDur,
    profileWithDefaults: profileWithDefaults,
    DEFAULT_PROFILE: DEFAULT_PROFILE,
    GOALS: GOALS,
    CATEGORIES: CATEGORIES,
    FOCI: FOCI,
    LIBRARY: LIBRARY
  };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.LiftEngine = api;
})(this);
