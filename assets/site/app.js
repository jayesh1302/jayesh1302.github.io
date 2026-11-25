(() => {
  const root = document.documentElement;
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;

  /* ---------- theme ---------- */
  const metaTheme = () => $$('meta[name="theme-color"]').forEach(m => m.setAttribute('content', root.dataset.theme === 'dark' ? '#0a0c10' : '#f6f5f1'));
  metaTheme();
  $('#theme').addEventListener('click', () => {
    root.dataset.theme = root.dataset.theme === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('theme', root.dataset.theme); } catch (e) {}
    metaTheme();
    if (navigator.vibrate) navigator.vibrate(8);
  });

  /* ---------- cursor glow (desktop) ---------- */
  const glow = $('#glow');
  if (matchMedia('(pointer:fine)').matches) addEventListener('pointermove', e => {
    glow.style.setProperty('--mx', e.clientX + 'px'); glow.style.setProperty('--my', e.clientY + 'px');
  }, { passive: true });

  /* ---------- typed line ---------- */
  const words = ['LLM evals & benchmarks', 'multi-agent orchestration', 'tool-calling agent skills', 'reliable AI infrastructure', 'backends for 140M+ users'];
  const typed = $('#typed');
  if (!reduce) {
    let wi = 0, ci = words[0].length, del = true;
    const tick = () => {
      const w = words[wi]; typed.textContent = w.slice(0, ci);
      if (!del && ci === w.length) { del = true; return setTimeout(tick, 2000); }
      if (del && ci === 0) { del = false; wi = (wi + 1) % words.length; }
      ci += del ? -1 : 1; setTimeout(tick, del ? 26 : 52);
    };
    setTimeout(tick, 2200);
  }

  /* ---------- agent trace animation ---------- */
  const trace = $('#trace');
  const runs = [
    { q: 'Summarize my spending this quarter', tools: [['retrieve', 'transactions(q3)', '142ms'], ['compute', 'categorize()', '38ms']] },
    { q: 'Am I on track for my savings goal?', tools: [['retrieve', 'goals(user)', '96ms'], ['reason', 'project_trend()', '212ms']] },
    { q: 'Draft an invoice for last week', tools: [['retrieve', 'timesheets(7d)', '118ms'], ['action', 'create_invoice()', '64ms']] },
  ];
  const line = (html, cls = '') => { const d = document.createElement('div'); d.className = 'tl ' + cls; d.innerHTML = html; trace.appendChild(d); requestAnimationFrame(() => requestAnimationFrame(() => d.classList.add('show'))); return d; };
  const esc = s => s.replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
  const wait = ms => new Promise(r => setTimeout(r, ms));
  async function play(run) {
    trace.innerHTML = '';
    line(`<span class="ic">❯</span><span class="v">"${esc(run.q)}"</span>`, 'prompt');
    await wait(500);
    const steps = [['◇', 'plan', 'route → 2 tools', 'ok']].concat(run.tools.map(t => ['◆', t[0], t[1], t[2]]));
    steps.push(['◇', 'respond', 'stream → user', 'ok']);
    for (const [ic, k, v, r] of steps) {
      const el = line(`<span class="ic">${ic}</span><span class="k">${k}</span><span class="v">${esc(v)}</span><span class="r"><span class="spinner"></span></span>`);
      await wait(reduce ? 0 : 420 + Math.random() * 300);
      el.lastElementChild.innerHTML = r === 'ok' ? '<span class="ok">✓</span>' : `${r} <span class="ok">✓</span>`;
    }
    await wait(300);
    const ev = line(`<span class="ic">★</span><span class="k">eval</span><span class="v">llm-judge + checks</span><span class="r"><span class="spinner"></span></span>`);
    await wait(reduce ? 0 : 700);
    ev.lastElementChild.innerHTML = '<span class="ok">pass</span>';
    const sc = document.createElement('div'); sc.className = 'score';
    sc.innerHTML = '<span>task_success ✓</span><span>grounded ✓</span><span>tool_args ✓</span><span>safe ✓</span>';
    trace.appendChild(sc); requestAnimationFrame(() => requestAnimationFrame(() => sc.classList.add('show')));
  }
  let ri = 0, traceVisible = true, running = false;
  new IntersectionObserver(es => { traceVisible = es[0].isIntersecting; if (traceVisible && !running) loop(); }).observe(trace);
  async function loop() {
    running = true;
    while (traceVisible) {
      await play(runs[ri++ % runs.length]);
      if (reduce) break;
      await wait(3200);
    }
    running = false;
  }

  /* ---------- reveal + counters + focus bars ---------- */
  const countUp = c => {
    const end = +c.dataset.count, suf = c.dataset.suffix || '', t0 = performance.now();
    if (reduce) return;
    const step = now => { const k = Math.min(1, (now - t0) / 1400), e = 1 - Math.pow(1 - k, 3); c.textContent = Math.round(end * e) + suf; if (k < 1) requestAnimationFrame(step); };
    requestAnimationFrame(step);
  };
  const io = new IntersectionObserver(es => es.forEach(e => {
    if (!e.isIntersecting) return;
    e.target.classList.add('in'); io.unobserve(e.target);
    $$('[data-count]', e.target).forEach(countUp);
  }), { threshold: .12, rootMargin: '0px 0px -40px 0px' });
  $$('.reveal').forEach((el, i) => { el.style.transitionDelay = (i % 3) * 60 + 'ms'; io.observe(el); });

  /* ---------- active section: tab bar + desktop nav ---------- */
  const links = $$('.tabbar a, .nav a');
  const ids = ['home', 'focus', 'work', 'projects', 'skills', 'kudos', 'contact'];
  const tabFor = { skills: 'projects', kudos: 'projects' };
  const setActive = id => links.forEach(a => {
    const h = a.getAttribute('href').slice(1);
    const inTab = a.closest('.tabbar');
    a.classList.toggle('active', h === id || (inTab && h === tabFor[id]));
  });
  const secObs = new IntersectionObserver(es => es.forEach(e => { if (e.isIntersecting) setActive(e.target.id); }), { rootMargin: '-45% 0px -50% 0px' });
  ids.forEach(id => { const s = document.getElementById(id); if (s) secObs.observe(s); });
  links.forEach(a => a.addEventListener('click', () => { if (navigator.vibrate) navigator.vibrate(6); }));

  /* ---------- top bar border + timeline progress ---------- */
  const topbar = $('#topbar'), xp = $('#xp'), fill = $('#xpFill'), jobs = $$('.job', xp);
  let ticking = false;
  const onScroll = () => {
    topbar.classList.toggle('scrolled', scrollY > 8);
    const r = xp.getBoundingClientRect(), mid = innerHeight * .6;
    fill.style.setProperty('--p', Math.max(0, Math.min(100, (mid - r.top) / r.height * 100)) + '%');
    jobs.forEach(j => j.classList.toggle('active', $('.node', j).getBoundingClientRect().top < mid));
    ticking = false;
  };
  addEventListener('scroll', () => { if (!ticking) { ticking = true; requestAnimationFrame(onScroll); } }, { passive: true });
  onScroll();

  /* ---------- project rail dots ---------- */
  const rail = $('#rail'), dots = $('#dots'), cards = $$('.card', rail);
  dots.innerHTML = cards.map(() => '<i></i>').join('');
  const dotEls = $$('i', dots);
  const updDots = () => {
    const c = rail.scrollLeft + rail.clientWidth / 2;
    let best = 0, bd = Infinity;
    cards.forEach((k, i) => { const d = Math.abs(k.offsetLeft + k.offsetWidth / 2 - c); if (d < bd) { bd = d; best = i; } });
    dotEls.forEach((d, i) => d.classList.toggle('on', i === best));
  };
  rail.addEventListener('scroll', () => requestAnimationFrame(updDots), { passive: true }); updDots();

  /* ---------- card spotlight + tilt (desktop) ---------- */
  if (matchMedia('(pointer:fine)').matches) $$('.card').forEach(c => {
    c.addEventListener('pointermove', e => {
      const r = c.getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
      c.style.setProperty('--x', x + 'px'); c.style.setProperty('--y', y + 'px');
      if (!reduce) c.style.transform = `perspective(800px) rotateX(${(y / r.height - .5) * -5}deg) rotateY(${(x / r.width - .5) * 5}deg)`;
    });
    c.addEventListener('pointerleave', () => { c.style.transform = ''; });
  });

  /* ---------- marquee ---------- */
  const tr = $('#track'); tr.innerHTML += tr.innerHTML;
})();
