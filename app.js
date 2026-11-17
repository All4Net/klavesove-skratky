(function () {
  'use strict';

  const CFG = Object.assign({
    RESULTS_URL: '', PASS_PERCENT: 100, QUIZ_TOTAL: 20, QUIZ_TIME: 180,
    PRACTICAL_LIMIT: 480, FINAL_LIMIT: 540, FINAL_TEST: true, QUIZ_TEST: true, EDITION: 'full',
    MODE_SWITCH: true, CTA_LABEL: '', CTA_TARGET: '', MANUAL_TIMES: false, STANDALONE: false
  }, window.APP_CONFIG || {});
  const HAS_FINAL = CFG.FINAL_TEST !== false;   // Light verzia nemá záverečný test
  const HAS_QUIZ = CFG.QUIZ_TEST !== false;     // ani kvíz
  const QUIZ_TOTAL = CFG.QUIZ_TOTAL;
  const QUIZ_TIME = CFG.QUIZ_TIME;
  const ONLINE = !!CFG.RESULTS_URL;

  /* poradie aplikácií zodpovedá riadkom v tabuľke zamestnanca */
  const APPS = {
    practical: ['Poznámkový blok', 'Total Commander', 'Prehliadač Firefox', 'Microsoft Excel', 'Ladesk'],
    final: ['Total Commander', 'Microsoft Word', 'Ladesk', 'Microsoft Excel', 'Prehliadač Firefox']
  };
  const LIMIT = { practical: CFG.PRACTICAL_LIMIT, final: CFG.FINAL_LIMIT };

  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }
  const norm = (s) => String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (s) => Math.floor(Math.max(0, s) / 60) + ':' + pad(Math.max(0, s) % 60);

  const store = {
    get(key, fallback) {
      try { const v = localStorage.getItem('skratky.' + key); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(key, value) {
      try { localStorage.setItem('skratky.' + key, JSON.stringify(value)); } catch (e) { /* súkromný režim */ }
    }
  };

  /* Komunikácia s Google Apps Scriptom (tabuľka s výsledkami).
     Používa sa načítanie skriptu (JSONP), ktoré funguje vo všetkých prehliadačoch aj pri otvorení súboru z disku.
     Zápisy nesú jedinečné "rid", takže opakované odoslanie nezapíše výsledok dvakrát. */
  function newRid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 10); }

  function api(action, data) {
    return new Promise((resolve, reject) => {
      const cb = '__skr' + newRid();
      const payload = JSON.stringify(Object.assign({ action, edition: CFG.EDITION }, data || {}));
      const tag = document.createElement('script');
      let done = false;
      const finish = (fn, value) => {
        if (done) return;
        done = true;
        clearTimeout(timeout);
        delete window[cb];
        tag.remove();
        fn(value);
      };
      const timeout = setTimeout(() => finish(reject, new Error('server neodpovedá (časový limit)')), 30000);
      window[cb] = (json) => {
        if (CFG.EDITION === 'light' && !(json && json.ver >= 2)) {      // starý skript by zapisoval do pôvodných stĺpcov
          finish(reject, new Error('v Google je starý skript, nasaď novú verziu Code.gs'));
        } else if (json && json.ok) {
          finish(resolve, json);
        } else {
          finish(reject, new Error((json && json.error) || 'neznáma chyba'));
        }
      };
      tag.onerror = () => finish(reject, new Error('nepodarilo sa spojiť so serverom'));
      tag.src = CFG.RESULTS_URL + '?callback=' + cb + '&payload=' + encodeURIComponent(payload);
      document.head.appendChild(tag);
    });
  }

  /* Skratka "Ctrl + Shift + T" -> klávesy [Ctrl] + [Shift] + [T] */
  function renderKeys(text) {
    const wrap = el('span', 'keys');
    text.split(/\s\+\s/).forEach((part, i) => {
      if (i) wrap.append(el('span', 'plus', '+'));
      wrap.append(el('kbd', null, part.trim()));
    });
    return wrap;
  }

  /* ===== STAV (zamestnanec, odomknutia) ===== */
  const empSelect = $('#empSelect');
  const empText = $('#empText');
  const whoStatus = $('#whoStatus');

  let S = null;               // stav zo zošita: { max, quiz, practical, final } – každé { attempts, passed }
  let statusFailed = false;
  let listError = '';          // dôvod, prečo sa nenačítal zoznam zamestnancov
  let lastFetch = 0;
  let trainerPin = '';        // PIN školiteľa overený v tejto relácii
  let unlocked = {};          // { practical: true, final: true } po zadaní PIN pre aktuálneho zamestnanca
  let lastNote = {};          // správa po zápise výsledku
  let mode = 'practice';      // 'practice' = cvičný režim (bez mena, nič sa nezapisuje) | 'official' = na ostro
  try { if (ONLINE && sessionStorage.getItem('skratky.mode') === 'official') mode = 'official'; } catch (e) { /* ignore */ }
  if (!CFG.MODE_SWITCH && ONLINE) mode = 'official';    // Light: jediný režim je na ostro
  const isOfficial = () => ONLINE && mode === 'official';

  const readEmployee = () => (empSelect.hidden ? empText.value : empSelect.value).trim();
  function employeeValid() {
    const v = readEmployee();
    return empSelect.hidden ? /\S+\s+\S+/.test(v) : !!v;
  }

  function statusLine() {
    if (!S) return '';
    const part = (name, st) => name + ': ' + (st.passed ? 'splnené ✓' : st.attempts + '/' + S.max + ' pokusy');
    return (HAS_QUIZ ? part('Kvíz', S.quiz) + '  ·  ' : '') + part('Praktický test', S.practical) + (HAS_FINAL ? '  ·  ' + part('Záverečný test', S.final) : '');
  }

  async function refreshStatus() {
    const emp = readEmployee();
    S = null; statusFailed = false;
    whoStatus.className = 'who-status';
    if (isOfficial() && !empSelect.hidden && emp) {
      whoStatus.textContent = 'Načítavam stav…';
      try {
        const res = await api('status', { emp });
        if (emp !== readEmployee()) return;
        S = res;
        whoStatus.textContent = statusLine();
      } catch (err) {
        if (emp !== readEmployee()) return;
        statusFailed = true;
        whoStatus.className = 'who-status err';
        whoStatus.textContent = 'Stav sa nepodarilo načítať: ' + err.message;
      }
      lastFetch = Date.now();
    } else if (!ONLINE) {
      if (CFG.STANDALONE) {                                  // hláška o povinnom mene sa ukáže až pri pokuse ísť ďalej
        whoStatus.textContent = '';
        $('#whoField').classList.remove('needs');
      } else {
        whoStatus.textContent = 'Režim bez tabuľky: výsledky sa nezapisujú a zámky sú vypnuté.';
      }
    } else if (!isOfficial()) {
      whoStatus.textContent = 'Cvičný režim: nič sa nezapisuje, všetko je odomknuté.';
    } else {
      whoStatus.textContent = empSelect.hidden ? 'Meno a priezvisko sú povinný údaj.' : 'Vyber svoje meno zo zoznamu.';
    }
    renderAll();
  }

  function paintMode() {
    document.body.dataset.mode = mode;
    document.body.dataset.standalone = String(!!CFG.STANDALONE);   // Light: bez tabuľky, meno sa píše ručne
    $$('#modeSwitch .mode-btn').forEach((b) => b.classList.toggle('active', b.dataset.mode === mode));
  }
  function setMode(m) {
    if (m === mode || (m === 'official' && !ONLINE)) return;
    if (quizStarted && !finished && !confirm('Rozbehnutý kvíz sa zruší. Pokračovať?')) return;
    mode = m;
    try { sessionStorage.setItem('skratky.mode', m); } catch (e) { /* ignore */ }
    unlocked = {}; lastNote = {}; trainerPin = '';
    paintMode();
    resetQuiz();
    refreshStatus();
  }
  $$('#modeSwitch .mode-btn').forEach((b) => b.addEventListener('click', () => setMode(b.dataset.mode)));
  const officialBtn = $('#modeSwitch [data-mode="official"]');
  if (!ONLINE && officialBtn) {
    officialBtn.disabled = true;
    officialBtn.title = 'Zápis do tabuľky nie je zapnutý';
  }

  function onEmployeeChange() {
    unlocked = {}; lastNote = {}; trainerPin = '';
    if (CFG.STANDALONE && typeof wizReset === 'function') wizReset();   // iná osoba = nový test
    try { sessionStorage.setItem('skratky.emp', readEmployee()); } catch (e) { /* ignore */ }
    resetQuiz();
    refreshStatus();
  }

  async function initEmployees() {
    if (!ONLINE) {
      empText.hidden = false;
      empText.addEventListener('input', onEmployeeChange);
      refreshStatus();
      return;
    }
    empSelect.hidden = false;
    empSelect.append(new Option('Načítavam zoznam…', ''));
    empSelect.disabled = true;
    try {
      const res = await api('employees');
      empSelect.innerHTML = '';
      empSelect.append(new Option('— vyber svoje meno —', ''));
      res.employees.forEach((n) => empSelect.append(new Option(n, n)));
      empSelect.disabled = false;
      let saved = '';
      try { saved = sessionStorage.getItem('skratky.emp') || ''; } catch (e) { /* ignore */ }
      if (saved && res.employees.includes(saved)) empSelect.value = saved;
      empSelect.addEventListener('change', onEmployeeChange);
      onEmployeeChange();
    } catch (err) {
      empSelect.hidden = true;
      empText.hidden = false;
      empText.addEventListener('input', onEmployeeChange);
      whoStatus.className = 'who-status';
      whoStatus.textContent = 'Meno a priezvisko sú povinný údaj.';
      try { console.warn('Zoznam zamestnancov sa nepodarilo načítať: ' + err.message); } catch (e) { /* ignore */ }
      statusFailed = true;
      listError = err.message;
      renderAll();
    }
  }

  /* ===== OBRAZOVKY (úvod, skratky, kvíz, praktický test, záverečný test) ===== */
  const VIEWS = ['home', 'shortcuts'].concat(HAS_QUIZ ? ['quiz'] : [], ['practice'], HAS_FINAL ? ['finaltest'] : []);
  const STEP_NAMES = { shortcuts: 'Skratky', quiz: 'Kvíz', practice: 'Praktický test', finaltest: 'Záverečný test' };
  const SUB = {
    shortcuts: 'Prehľad a vyhľadávanie',
    quiz: '20 otázok, 3 minúty',
    practice: 'Cieľ pod ' + Math.round(CFG.PRACTICAL_LIMIT / 60) + ' minút',
    finaltest: 'Pod 9 minút, so školiteľom'
  };

  function showView(name, userClick) {
    if (!VIEWS.includes(name)) name = 'home';
    VIEWS.forEach((id) => { document.getElementById(id).hidden = id !== name; });
    $('#crumbs').hidden = !CFG.STANDALONE && name === 'home';   // v Light verzii je menu v hornej lište stále
    $$('#crumbs [data-step]').forEach((c) => c.classList.toggle('active', c.dataset.step === name));
    document.body.dataset.view = name;
    if (name === 'practice' && wiz.built) { wizEqualize(); if (wiz.i < 5) wiz.inputs[wiz.i].focus({ preventScroll: true }); }   // Light: kurzor rovno v čase aplikácie
    try { history.replaceState(null, '', '#' + name); } catch (e) { /* ignore */ }
    if (userClick) {
      window.scrollTo(0, 0);
      if (isOfficial() && !empSelect.hidden && readEmployee() && Date.now() - lastFetch > 5000) refreshStatus();
    }
  }
  document.addEventListener('click', (e) => {
    const t = e.target.closest('[data-step]');
    if (!t || t.disabled) return;
    if (t.id === 'whoChip') {                               // meno vpravo hore: prejde na úvod a označí pole, aby sa dalo prepísať
      showView('home', true);
      const f = empText.hidden ? empSelect : empText;
      f.focus();
      if (f.select) f.select();
      return;
    }
    if (CFG.STANDALONE && t.dataset.step !== 'home' && !employeeValid()) { demandName(); return; }   // bez mena sa ďalej nejde
    showView(t.dataset.step, true);
  });

  /* Light: meno a priezvisko je povinné. Hláška sa ukáže až vtedy, keď sa človek chce niekam prekliknúť. */
  function demandName() {
    const field = $('#whoField');
    showView('home');
    window.scrollTo(0, 0);
    field.classList.remove('needs');
    void field.offsetWidth;                                  // znovu spustí animáciu
    field.classList.add('needs');
    whoStatus.className = 'who-status req';
    whoStatus.textContent = 'Meno a priezvisko sú povinný údaj.';
    (empText.hidden ? empSelect : empText).focus();
  }
  const goHomeBtn = $('#goHome');
  if (goHomeBtn) goHomeBtn.addEventListener('click', () => showView('home', true));
  $('#goNext').addEventListener('click', () => {
    if (CFG.STANDALONE && !employeeValid()) demandName();
    else showView(CFG.CTA_TARGET || nextStep(), true);
  });

  function nextStep() {
    if (!S) return 'shortcuts';
    if (HAS_QUIZ && !S.quiz.passed) return 'quiz';
    if (!S.practical.passed) return 'practice';
    if (HAS_FINAL && !S.final.passed) return 'finaltest';
    return 'shortcuts';
  }

  function setStep(name, sub, state) {   // state: '', 'done', 'locked'
    $$('[data-step="' + name + '"]').forEach((n) => {
      n.classList.toggle('done', state === 'done');
      n.classList.toggle('locked', state === 'locked');
      const s = $('.sub', n);
      if (s) s.textContent = sub;
    });
  }
  function paintSteps() {
    setStep('shortcuts', SUB.shortcuts, '');
    if (!S) {
      setStep('quiz', SUB.quiz, ''); setStep('practice', SUB.practice, ''); setStep('finaltest', SUB.finaltest, '');
      return;
    }
    setStep('quiz', S.quiz.passed ? 'Splnené ✓' : 'Pokusy na ostro: ' + S.quiz.attempts + '/' + S.max, S.quiz.passed ? 'done' : '');
    setStep('practice', S.practical.passed ? 'Splnené ✓'
      : (!HAS_QUIZ || S.quiz.passed) ? 'Meranie na ostro: ' + S.practical.attempts + '/' + S.max : 'Cvičný režim · na ostro po kvíze',
      S.practical.passed ? 'done' : '');
    setStep('finaltest', S.final.passed ? 'Splnené ✓'
      : S.practical.passed ? 'Pokusy: ' + S.final.attempts + '/' + S.max : 'Zamknuté do splnenia praktického testu',
      S.final.passed ? 'done' : (S.practical.passed ? '' : 'locked'));
  }
  function paintHome() {
    const need = (isOfficial() || CFG.STANDALONE) && !employeeValid();
    const cta = $('#goNext');
    if (CFG.STANDALONE) {                                    // tlačidlo ostáva klikateľné, aby sa dalo vysvetliť, prečo nejde ďalej
      cta.disabled = false;
      cta.classList.toggle('is-off', need);
      cta.setAttribute('aria-disabled', need ? 'true' : 'false');
    } else {
      cta.disabled = need;
    }
    const next = nextStep();
    $('.cta-label', cta).textContent = CFG.CTA_LABEL ? CFG.CTA_LABEL
      : need ? 'Najprv vyber meno'
      : !isOfficial() ? 'Začať cvičiť'
      : !S ? 'Začať' : next === 'shortcuts' ? 'Prejsť na skratky' : 'Pokračovať: ' + STEP_NAMES[next];
    const name = readEmployee();
    const chip = $('#whoChip');
    chip.hidden = CFG.STANDALONE && !name;
    chip.textContent = !CFG.MODE_SWITCH
      ? (name ? '👤 ' + name + ' · zmeniť' : 'Vyber meno')
      : isOfficial() ? (name ? '👤 ' + name + ' · na ostro' : 'Na ostro · vyber meno') : 'Cvičný režim · zmeniť';
  }

  /* ===== PREHĽAD SKRATIEK ===== */
  const SC_ORDER = ['Windows', 'Prehliadač Firefox', 'Total Commander', 'Excel', 'Ladesk'];
  $$('#shortcuts code').forEach((c) => c.replaceWith(renderKeys(c.textContent)));

  const scAll = $('#scAll');
  const scGroups = $$('.app-group', scAll);
  scGroups.forEach((group) => {
    const h = $('h4', group);
    const full = h.textContent.trim();
    const icon = full.split(' ')[0];
    group.dataset.icon = icon;
    group.dataset.app = full.slice(icon.length).trim();
    const grid = $('.sc-grid', group);
    const cells = Array.from(grid.children);
    const rows = [];
    for (let i = 2; i < cells.length; i += 2) {      // prvé dva bunky sú hlavička „Skratka / Akcia“
      const row = el('div', 'sc-row');
      row.append(cells[i], cells[i + 1]);
      rows.push(row);
    }
    grid.replaceChildren(...rows);
    h.textContent = group.dataset.app;
    h.append(el('span', 'count', rows.length + ' skratiek'));
  });
  SC_ORDER.forEach((name) => {
    const g = scGroups.find((x) => x.dataset.app === name);
    if (g) scAll.append(g);
  });

  const scSearch = $('#scSearch');
  const scChips = $('#scChips');
  let scApp = SC_ORDER[0];
  SC_ORDER.forEach((name) => {
    const g = scGroups.find((x) => x.dataset.app === name);
    const b = el('button', 'chip-btn', (g ? g.dataset.icon + ' ' : '') + name);
    b.type = 'button';
    b.dataset.app = name;
    b.addEventListener('click', () => { scApp = name; scSearch.value = ''; applyShortcuts(); });
    scChips.append(b);
  });

  function applyShortcuts() {
    const q = norm(scSearch.value.trim());
    let visible = 0;
    scGroups.forEach((group) => {
      let n = 0;
      $$('.sc-row', group).forEach((r) => {
        const match = !q || norm(r.textContent + ' ' + group.dataset.app).includes(q);
        r.hidden = !match;
        if (match) n++;
      });
      group.hidden = q ? n === 0 : group.dataset.app !== scApp;
      if (!group.hidden) visible += n;
    });
    $$('.chip-btn', scChips).forEach((b) => b.classList.toggle('active', !q && b.dataset.app === scApp));
    $('#scEmpty').hidden = visible > 0;
  }
  scSearch.addEventListener('input', applyShortcuts);
  $('#scPrint').addEventListener('click', () => window.print());
  applyShortcuts();

  /* ===== KVÍZ ===== */
  let quizPool = [];
  let currentIndex = 0;
  let answers = [];
  let quizStarted = false;
  let finished = false;
  let resultSent = false;
  let quizRid = newRid();
  let timeLeft = QUIZ_TIME;
  let timer = null;
  let advanceTimer = null;
  let runMode = 'practice';   // režim prebiehajúceho kvízu

  const elements = {
    qNum: $('#qNum'), qTotal: $('#qTotal'), qArea: $('#qArea'), qText: $('#qText'),
    qOptions: $('#qOptions'), qScore: $('#qScore'), qWrong: $('#qWrong'),
    qTime: $('#qTime'), qTimeFill: $('#qTimeFill'), qDots: $('#qDots'),
    qPrev: $('#qPrev'), qNext: $('#qNext'), qReset: $('#qReset'),
    qResult: $('#qResult'), qNameOverlay: $('#qNameOverlay'), dl: $('#dl'),
    qModeInfo: $('#qModeInfo'), qModePill: $('#qModePill')
  };

  function shuffleArray(array) {
    const a = [...array];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }

  /* 3 náhodné nesprávne možnosti zo všetkých odpovedí + správna (rovnako ako predtým) */
  function generateOptions(correctAnswer) {
    const all = [...new Set(QUESTION_POOL.map((q) => q.correct))];
    const others = all.filter((a) => a !== correctAnswer);
    const options = [correctAnswer];
    while (options.length < 4 && others.length) {
      options.push(others.splice(Math.floor(Math.random() * others.length), 1)[0]);
    }
    return shuffleArray(options);
  }

  const isNameValid = () => !isOfficial() || employeeValid();

  function firstUnanswered() {
    const i = answers.findIndex((a) => !a);
    return i === -1 ? QUIZ_TOTAL - 1 : i;
  }

  function officialQuizAllowed() {
    return isOfficial() && !!S && employeeValid() && !S.quiz.passed && S.quiz.attempts < S.max;
  }

  function updateQuizModeUI() {
    const allowed = officialQuizAllowed();
    let info;
    if (!isOfficial()) info = 'Cvičný režim: výsledok sa nezapisuje. Na ostro sa prepneš na úvodnej obrazovke.';
    else if (!employeeValid()) info = 'Vyber si meno na úvodnej obrazovke.';
    else if (statusFailed || !S) info = 'Stav z tabuľky sa nenačítal, kvíz na ostro nie je dostupný.';
    else if (S.quiz.passed) info = 'Kvíz máš splnený ✓. Ďalšie pokusy sa už nezapisujú.';
    else if (S.quiz.attempts >= S.max) info = 'Pokusy na ostro máš vyčerpané (' + S.quiz.attempts + '/' + S.max + '). O ďalší pokus sa dohodni so školiteľom.';
    else info = 'Na ostro: výsledok sa zapíše do tabuľky. Pokus č. ' + (S.quiz.attempts + 1) + ' z ' + S.max + '.';
    elements.qModeInfo.textContent = info;

    const live = (quizStarted || finished) ? runMode === 'official' : allowed;
    elements.qModePill.textContent = live ? 'Na ostro' : 'Cvičný';
    elements.qModePill.classList.toggle('live', live);
  }

  function updateTimebar() {
    const pct = Math.max(0, Math.min(100, (timeLeft / QUIZ_TIME) * 100));
    const bar = elements.qTimeFill;
    bar.style.width = pct + '%';
    bar.classList.remove('good', 'warn', 'critical', 'blink');
    if (pct > 60) bar.classList.add('good');
    else if (pct > 30) bar.classList.add('warn');
    else {
      bar.classList.add('critical');
      if (timeLeft <= 10) bar.classList.add('blink');
    }
    elements.qTime.textContent = fmtTime(timeLeft);
  }

  function updateCounters() {
    elements.qScore.textContent = answers.filter((a) => a && a.isCorrect).length;
    elements.qWrong.textContent = answers.filter((a) => a && a.isCorrect === false).length;
  }

  function renderDots() {
    elements.qDots.innerHTML = '';
    const limit = firstUnanswered();
    answers.forEach((a, i) => {
      const d = el('button', 'dot', String(i + 1));
      d.type = 'button';
      if (a) d.classList.add(a.isCorrect ? 'right' : 'wrong');
      if (i === currentIndex) d.classList.add('current');
      d.disabled = !isNameValid() || (!finished && i > limit);
      d.setAttribute('aria-label', 'Otázka ' + (i + 1));
      d.addEventListener('click', () => { currentIndex = i; renderQuestion(); });
      elements.qDots.appendChild(d);
    });
  }

  function refreshControls() {
    const valid = isNameValid();
    elements.qNameOverlay.hidden = valid;
    elements.qPrev.disabled = !valid || currentIndex === 0;
    elements.qNext.disabled = !valid || currentIndex === QUIZ_TOTAL - 1 || !answers[currentIndex];
    elements.qReset.disabled = !valid;
    const answered = !!answers[currentIndex];
    $$('.option', elements.qOptions).forEach((b) => { b.disabled = !valid || answered || finished; });
    renderDots();
  }

  function renderQuestion() {
    if (!quizPool.length) return;
    const question = quizPool[currentIndex];
    elements.qNum.textContent = currentIndex + 1;
    elements.qArea.textContent = question.area;
    elements.qText.textContent = question.q;

    elements.qOptions.innerHTML = '';
    question.options.forEach((option, i) => {
      const btn = el('button', 'option');
      btn.type = 'button';
      btn.dataset.value = option;
      btn.append(el('span', 'letter', 'ABCD'[i]), renderKeys(option));
      btn.addEventListener('click', () => selectAnswer(option));
      elements.qOptions.appendChild(btn);
    });

    const answer = answers[currentIndex];
    if (answer) {
      $$('.option', elements.qOptions).forEach((btn) => {
        if (btn.dataset.value === answer.selected) btn.classList.add(answer.isCorrect ? 'correct' : 'wrong');
        if (!answer.isCorrect && btn.dataset.value === question.correct) btn.classList.add('correct');
      });
    }
    refreshControls();
  }

  function startTimer() {
    if (quizStarted) return;
    quizStarted = true;
    timer = setInterval(() => {
      timeLeft--;
      updateTimebar();
      if (timeLeft <= 0) finishQuiz(true);
    }, 1000);
  }

  function selectAnswer(selected) {
    if (!isNameValid()) { refreshControls(); return; }
    if (finished || answers[currentIndex]) return;
    if (!quizStarted) { runMode = officialQuizAllowed() ? 'official' : 'practice'; updateQuizModeUI(); }
    startTimer();

    const question = quizPool[currentIndex];
    const isCorrect = selected === question.correct;
    answers[currentIndex] = { selected, isCorrect };

    $$('.option', elements.qOptions).forEach((btn) => {
      if (btn.dataset.value === selected) btn.classList.add(isCorrect ? 'correct' : 'wrong');
      if (!isCorrect && btn.dataset.value === question.correct) btn.classList.add('correct');
    });
    updateCounters();
    refreshControls();

    if (answers.every(Boolean)) {
      advanceTimer = setTimeout(() => finishQuiz(false), isCorrect ? 900 : 500);
    } else if (isCorrect) {
      const idx = currentIndex;
      advanceTimer = setTimeout(() => {
        if (!finished && currentIndex === idx && currentIndex < QUIZ_TOTAL - 1) nextQuestion();
      }, 900);
    }
  }

  function nextQuestion() {
    if (!answers[currentIndex] || currentIndex >= QUIZ_TOTAL - 1) return;
    currentIndex++;
    renderQuestion();
  }

  function prevQuestion() {
    if (currentIndex > 0) { currentIndex--; renderQuestion(); }
  }

  function resetQuiz() {
    clearInterval(timer); timer = null;
    clearTimeout(advanceTimer);
    quizStarted = false; finished = false; resultSent = false; quizRid = newRid();
    timeLeft = QUIZ_TIME;
    currentIndex = 0;
    answers = new Array(QUIZ_TOTAL).fill(null);
    quizPool = shuffleArray(QUESTION_POOL).slice(0, QUIZ_TOTAL).map((q) => ({ ...q, options: generateOptions(q.correct) }));
    runMode = 'practice';
    elements.qResult.hidden = true;
    elements.qResult.innerHTML = '';
    updateTimebar();
    updateCounters();
    updateQuizModeUI();
    renderQuestion();
  }

  /* ----- výsledok ----- */
  function quizStats() {
    const correct = answers.filter((a) => a && a.isCorrect).length;
    const wrong = answers.filter((a) => a && a.isCorrect === false).length;
    const percentage = Math.round((correct / QUIZ_TOTAL) * 100);
    return { correct, wrong, percentage, passed: percentage >= CFG.PASS_PERCENT };
  }

  function buildPayload() {
    const s = quizStats();
    return {
      emp: readEmployee(),
      name: readEmployee(),
      total: QUIZ_TOTAL,
      correct: s.correct,
      wrong: s.wrong,
      percent: s.percentage,
      elapsed: quizStarted ? QUIZ_TIME - Math.max(0, timeLeft) : 0,
      passed: s.passed,
      rid: quizRid,
      details: quizPool.map((q, i) => {
        const a = answers[i];
        return (a && a.isCorrect ? '1' : '0') + '|' + q.area + '|' + q.q + '|' + ((a && a.selected) || '') + '|' + q.correct;
      })
    };
  }

  async function sendResults(statusEl) {
    statusEl.className = 'send-status';
    statusEl.textContent = 'Odosielam výsledok…';
    try {
      await api('quiz', buildPayload());
      resultSent = true;
      statusEl.className = 'send-status ok';
      statusEl.textContent = '✓ Výsledok bol zapísaný do tabuľky.';
      const retry = $('#qRetrySend');
      if (retry) retry.hidden = true;
      refreshStatus();
    } catch (err) {
      statusEl.className = 'send-status err';
      statusEl.textContent = 'Výsledok sa nepodarilo odoslať (' + err.message + '). Stiahni CSV a odovzdaj ho školiteľovi.';
      const retry = $('#qRetrySend');
      if (retry) retry.hidden = false;
    }
  }

  function renderResult(timeUp) {
    const s = quizStats();
    const box = elements.qResult;
    box.className = 'result ' + (s.passed ? 'pass' : 'fail');
    box.innerHTML = '';

    const C = 2 * Math.PI * 52;
    const ring = el('div', 'ring');
    ring.innerHTML =
      '<svg viewBox="0 0 120 120"><circle class="track" cx="60" cy="60" r="52"></circle>' +
      '<circle class="value" cx="60" cy="60" r="52" stroke-dasharray="' + C + '" stroke-dashoffset="' + C + '"></circle></svg>';
    ring.append(el('div', 'pct', s.percentage + '%'));

    const text = el('div');
    text.append(
      el('h3', null, s.passed ? 'Kvíz splnený! 🎉' : 'Kvíz nesplnený'),
      el('p', null,
        s.correct + '/' + QUIZ_TOTAL + ' správnych (' + s.percentage + ' %)' +
        (s.passed ? '.' : ', na splnenie treba ' + CFG.PASS_PERCENT + ' %.') +
        (timeUp ? ' Čas vypršal.' : ''))
    );

    const areas = el('div', 'areas');
    const byArea = {};
    quizPool.forEach((q, i) => {
      const a = byArea[q.area] || (byArea[q.area] = { ok: 0, n: 0 });
      a.n++;
      if (answers[i] && answers[i].isCorrect) a.ok++;
    });
    Object.keys(byArea).forEach((name) => {
      const a = byArea[name];
      const row = el('div', 'area-row');
      const bar = el('div', 'bar');
      const fill = el('i');
      fill.style.width = Math.round((a.ok / a.n) * 100) + '%';
      if (a.ok < a.n) fill.classList.add('low');
      bar.append(fill);
      row.append(el('span', null, name), bar, el('span', null, a.ok + '/' + a.n));
      areas.append(row);
    });

    const actions = el('div', 'result-actions');
    const exportBtn = el('button', 'btn', 'Stiahnuť výsledok (CSV)');
    exportBtn.type = 'button';
    exportBtn.addEventListener('click', exportCSV);
    const again = el('button', 'btn primary', 'Skúsiť znova');
    again.type = 'button';
    again.addEventListener('click', () => { resetQuiz(); window.scrollTo({ top: 0, behavior: 'smooth' }); });
    const retry = el('button', 'btn ghost', 'Odoslať znova');
    retry.type = 'button'; retry.id = 'qRetrySend'; retry.hidden = true;
    const status = el('span', 'send-status');
    retry.addEventListener('click', () => sendResults(status));
    actions.append(exportBtn, again, retry, status);

    box.append(ring, text, areas, actions);
    box.hidden = false;
    requestAnimationFrame(() => requestAnimationFrame(() => {
      const v = $('.value', ring);
      if (v) v.style.strokeDashoffset = C * (1 - s.percentage / 100);
    }));
    box.scrollIntoView({ behavior: 'smooth', block: 'nearest' });

    if (s.passed) confetti();
    if (runMode === 'official') {
      if (!resultSent) sendResults(status);
    } else {
      status.textContent = 'Cvičný kvíz: výsledok sa nezapisuje do tabuľky.';
    }
  }

  function finishQuiz(timeUp) {
    if (finished) return;
    finished = true;
    clearInterval(timer); timer = null;
    clearTimeout(advanceTimer);
    refreshControls();
    renderResult(timeUp);
  }

  /* CSV – rovnaký formát ako doteraz */
  function exportCSV() {
    if (!isNameValid()) { refreshControls(); alert('Najprv vyplň meno a priezvisko.'); return; }
    const name = readEmployee() || 'Nezadané';
    const s = quizStats();
    const elapsed = quizStarted ? (QUIZ_TIME - timeLeft) : 0;
    const now = new Date();
    const yyyy = now.getFullYear(), mm = pad(now.getMonth() + 1), dd = pad(now.getDate());
    const HH = pad(now.getHours()), MM = pad(now.getMinutes()), SS = pad(now.getSeconds());

    const headerRow = ['Meno Priezvisko', 'Dátum', 'Čas', 'Počet otázok', 'Správne odpovedané',
      'Nesprávne odpovedané', 'Percentuálna úspešnosť', 'Čas trvanie testu', 'Splnený test'];
    const valuesRow = [name, `${dd}.${mm}.${yyyy}`, `${HH}:${MM}:${SS}`, QUIZ_TOTAL, s.correct, s.wrong,
      `${s.percentage}%`, `${elapsed}s`, s.passed ? 'ANO' : 'NIE'];
    const emptyRow = ['', '', '', '', '', '', '', '', ''];
    const detailHeader = ['poradie', 'oblast', 'otazka', 'spravna_odpoved', 'zvolena_odpoved', 'je_spravna'];
    const detailRows = quizPool.map((q, i) => {
      const a = answers[i] || { selected: '', isCorrect: false };
      return [i + 1, q.area, q.q, q.correct, a.selected || '', a.isCorrect ? 'ANO' : 'NIE'];
    });

    const allRows = [headerRow, valuesRow, emptyRow, detailHeader, ...detailRows];
    const esc = (v) => `"${String(v).replaceAll('"', '""')}"`;
    const csv = '﻿' + allRows.map((row) => row.map(esc).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8;' }));
    const nameSlug = name.toLowerCase().replace(/[^\w-]+/g, '-').replace(/-+/g, '-');
    elements.dl.href = url;
    elements.dl.download = `kviz_${nameSlug}_${yyyy}-${mm}-${dd}_${HH}${MM}${SS}.csv`;
    elements.dl.click();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }

  function confetti() {
    const wrap = el('div', 'confetti');
    const colors = ['#892d78', '#c25bb0', '#0c8a5d', '#f5a623', '#4c8dff', '#ff6b7a'];
    for (let i = 0; i < 70; i++) {
      const p = el('i');
      p.style.left = Math.random() * 100 + 'vw';
      p.style.background = colors[i % colors.length];
      p.style.animationDuration = 2.2 + Math.random() * 1.8 + 's';
      p.style.animationDelay = Math.random() * .5 + 's';
      p.style.setProperty('--dx', (Math.random() * 160 - 80) + 'px');
      p.style.setProperty('--rot', (360 + Math.random() * 540) + 'deg');
      wrap.append(p);
    }
    document.body.append(wrap);
    setTimeout(() => wrap.remove(), 5000);
  }

  elements.qNext.addEventListener('click', nextQuestion);
  elements.qPrev.addEventListener('click', prevQuestion);
  elements.qReset.addEventListener('click', resetQuiz);
  elements.qTotal.textContent = QUIZ_TOTAL;

  /* ===== STOPKY (cvičný praktický test) ===== */
  $$('.stopwatch').forEach((box) => {
    const goal = parseInt(box.dataset.goal, 10) || 0;
    const time = el('span', 'time', '0:00');
    const goalEl = el('span', 'goal', goal ? 'cieľ pod ' + fmtTime(goal) : '');
    const toggle = el('button', 'btn', 'Štart');
    const reset = el('button', 'btn ghost', 'Nula');
    toggle.type = reset.type = 'button';
    box.append(time, goalEl, toggle, reset);

    let started = 0, elapsed = 0, tick = null;
    const paint = () => {
      const total = elapsed + (started ? Math.floor((Date.now() - started) / 1000) : 0);
      time.textContent = fmtTime(total);
      box.classList.toggle('over', goal > 0 && total > goal);
    };
    toggle.addEventListener('click', () => {
      if (started) {
        elapsed += Math.floor((Date.now() - started) / 1000);
        started = 0; clearInterval(tick); toggle.textContent = 'Pokračovať';
      } else {
        started = Date.now(); tick = setInterval(paint, 250); toggle.textContent = 'Stop';
      }
      paint();
    });
    reset.addEventListener('click', () => {
      started = 0; elapsed = 0; clearInterval(tick); toggle.textContent = 'Štart'; paint();
    });
  });

  /* ===== PRAKTICKÝ TEST – cvičný checklist ===== */
  const checks = $$('#practice .chk');
  const sections = $$('#practice .section');

  function updateProgress(save) {
    sections.forEach((sec) => {
      const boxes = $$('.chk', sec);
      const done = boxes.filter((c) => c.checked).length;
      $('#' + sec.id + 'done').textContent = done;
      $('#' + sec.id + 'total').textContent = boxes.length;
      $('.bar i', sec).style.width = (boxes.length ? (done / boxes.length) * 100 : 0) + '%';
      sec.classList.toggle('complete', boxes.length > 0 && done === boxes.length);
      boxes.forEach((c) => c.closest('.task-item').classList.toggle('done', c.checked));
    });
    if (save && !CFG.STANDALONE) store.set('practice', checks.map((c) => c.checked));
  }

  sections.forEach((sec) => {
    const bar = el('div', 'bar');
    bar.append(el('i'));
    $('.progress', sec).after(bar);
  });
  const saved = CFG.STANDALONE ? [] : store.get('practice', []);
  checks.forEach((c, i) => { c.checked = !!saved[i]; c.addEventListener('change', () => updateProgress(true)); });
  $$('#practice .task-item').forEach((item) => {
    item.addEventListener('click', (e) => {
      if (e.target.type === 'checkbox') return;
      const c = $('.chk', item);
      c.checked = !c.checked;
      updateProgress(true);
    });
  });
  $('#practiceReset').addEventListener('click', () => {
    if (!confirm('Vynulovať všetky zaškrtnuté úlohy?')) return;
    checks.forEach((c) => { c.checked = false; });
    updateProgress(true);
  });
  updateProgress(false);

  const toggleHints = $('#toggleHints');
  let hintsVisible = false;
  toggleHints.addEventListener('click', () => {
    if (document.body.classList.contains('official-run')) return;
    hintsVisible = !hintsVisible;
    $$('#practice .hint').forEach((hint) => {
      const sc = (hint.parentElement.getAttribute('data-shortcuts') || '').trim();
      if (hintsVisible && sc) {
        hint.textContent = 'skratky: ' + sc.replace(/;/g, ' | ');
        hint.style.display = 'inline-block';
      } else {
        hint.style.display = 'none';
      }
    });
    $('.lbl', toggleHints).textContent = hintsVisible ? 'Skryť nápovedy (skratky)' : 'Zobraziť nápovedy (skratky)';
    wizEqualize();                                              // nápovedy menia výšku riadkov
  });

  function setOfficialRun(on) {
    document.body.classList.toggle('official-run', on);
    toggleHints.disabled = on;
  }

  /* ===== MERANIE NA OSTRO (školiteľ) – praktický aj záverečný test ===== */
  const GATE_MESSAGES = {
    noemp: 'Najprv si hore vyber svoje meno.',
    loading: 'Načítavam stav z tabuľky…',
    unavailable: 'Stav z tabuľky sa nepodarilo načítať, meranie na ostro nie je dostupné.',
    done: 'Splnené ✓',
    exhausted: 'Pokusy na ostro máš vyčerpané. O ďalší pokus sa dohodni so školiteľom.'
  };

  function gateState(kind) {
    if (CFG.STANDALONE) {      // Light: žiadna tabuľka, žiadne zámky, len zadávanie časov
      return employeeValid() ? { state: 'standalone' } : { state: 'noemp', why: 'Najprv zadaj meno a priezvisko na úvodnej obrazovke.' };
    }
    if (!ONLINE) return { state: 'demo' };
    if (!isOfficial()) return { state: 'practice' };
    if (!employeeValid()) return { state: 'noemp' };
    if (empSelect.hidden) {      // meno je napísané ručne, ale zoznam z tabuľky sa nenačítal, takže sa nedá zapisovať
      const old = /starý skript/.test(listError);
      return { state: 'unavailable', why: 'Výsledok sa nedá zapísať do tabuľky: ' + (old
        ? 'skript v Google ešte nie je aktualizovaný (treba nasadiť novú verziu Code.gs).'
        : 'nepodarilo sa spojiť s tabuľkou' + (listError ? ' (' + listError + ')' : '') + '. Skús obnoviť stránku.') };
    }
    if (!S) return { state: statusFailed ? 'unavailable' : 'loading' };
    if (kind === 'practical' && HAS_QUIZ && !S.quiz.passed) return { state: 'locked', why: 'Meranie na ostro sa odomkne po kvíze na 100 %. Dovtedy si môžeš úlohy cvične robiť nižšie.' };
    if (kind === 'final' && !S.practical.passed) return { state: 'locked', why: 'Záverečný test je zamknutý. Odomkne sa po splnení praktického testu pod 8 minút.' };
    const st = S[kind];
    if (st.passed) return { state: 'done' };
    if (st.attempts >= S.max) return { state: 'exhausted' };
    return { state: 'open', attempt: st.attempts + 1 };
  }

  function renderOfficial(kind) {
    const box = kind === 'practical' ? $('#practiceOfficial') : $('#finalGate');
    const title = kind === 'practical' ? 'Meranie na ostro' : 'Záverečný test na ostro';
    const g = gateState(kind);
    const showTasks = g.state === 'demo' || g.state === 'practice' || (g.state === 'open' && unlocked[kind]);
    if (kind === 'final') $('#taskBody').hidden = !showTasks;
    if (g.state !== 'open' || !unlocked[kind]) setOfficialRun(false);

    box.innerHTML = '';
    box.className = 'official';
    const head = el('h3', null, (g.state === 'locked' ? '🔒 ' : '') + title);
    box.append(head);

    if (g.state === 'standalone') {
      head.textContent = 'Výsledok';
      ensureWizard();
      renderWizardResult(box);
      box.hidden = wiz.i !== 5;
    } else if (g.state === 'demo' || g.state === 'practice') {
      box.classList.add('state-locked');
      const why = g.state === 'demo' ? 'Režim bez tabuľky' : 'Cvičný režim';
      box.append(el('p', 'small', kind === 'practical'
        ? why + ': meranie na ostro je vypnuté. Cvič si podľa úloh nižšie a čas si môžeš merať stopkami.'
        : why + ': zadanie je odomknuté na precvičenie, bez zápisu do tabuľky. Čas si môžeš merať stopkami.'));
    } else if (g.state === 'locked') {
      box.classList.add('state-locked');
      box.append(el('p', null, g.why));
    } else if (g.state === 'open') {
      box.append(el('p', 'small', 'Pokus č. ' + g.attempt + ' z ' + S.max + '. ' + (CFG.MANUAL_TIMES
        ? 'Zadaj čas každej aplikácie, výsledný čas sa spočíta sám a zapíše sa do tabuľky.'
        : 'Čas meria školiteľ a výsledok sa zapíše do tabuľky automaticky.')));
      if (!unlocked[kind]) {
        renderPin(box, kind);
      } else {
        buildMeter(box, kind);
      }
    } else {
      box.classList.add(g.state === 'done' ? 'state-done' : 'state-locked');
      box.append(el('p', null, g.why || GATE_MESSAGES[g.state]));
    }
    if (lastNote[kind]) box.append(el('p', 'note', lastNote[kind]));
  }

  function renderPin(box, kind) {
    const row = el('div', 'pin-row');
    const input = el('input');
    input.type = 'password'; input.placeholder = 'PIN školiteľa'; input.autocomplete = 'off';
    const btn = el('button', 'btn amber', kind === 'final' ? 'Odomknúť zadanie' : CFG.MANUAL_TIMES ? 'Zadať časy' : 'Spustiť meranie');
    btn.type = 'button';
    const err = el('p', 'field-hint'); err.hidden = true;
    const submit = async () => {
      btn.disabled = true; err.hidden = true;
      try {
        await api('pin', { pin: input.value });
        trainerPin = input.value;
        unlocked[kind] = true;
        renderOfficial(kind);
      } catch (e) {
        err.textContent = e.message;
        err.hidden = false;
        btn.disabled = false;
        input.select();
      }
    };
    btn.addEventListener('click', submit);
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit(); });
    row.append(input, btn);
    box.append(row, err);
  }

  /* ===== Light: praktický test po jednej aplikácii =====
     Jedna karta naraz: úlohy, na konci karty čas aplikácie. Po zadaní času sa ide na ďalšiu kartu,
     medzi kartami sa dá chodiť aj šípkami. Posledný krok je súhrn s výsledným časom. */
  const wiz = { i: 0, d: [null, null, null, null, null], built: false, secs: [], inputs: [], pills: [], nav: null };

  function wizTotal() { return wiz.d.reduce((a, b) => a + (b || 0), 0); }
  function wizAll() { return wiz.d.every((v) => v != null); }

  function ensureWizard() {
    if (wiz.built) return;
    wiz.built = true;
    wiz.secs = $$('#practice .task-grid .section');
    const names = wiz.secs.map((s) => $('.sec-name', s).firstChild.textContent.trim());

    // horný pruh s krokmi
    const nav = el('nav', 'wiz-steps');
    nav.setAttribute('aria-label', 'Aplikácie');
    names.concat(['Výsledok']).forEach((name, i) => {
      const b = el('button', 'wiz-step');
      b.type = 'button';
      b.append(el('span', 'wn', i < 5 ? String(i + 1) : '✓'), el('span', 'wl', name));
      b.addEventListener('click', () => goStep(i));
      nav.append(b);
      wiz.pills.push(b);
    });
    $('#practice .task-grid').before(nav);
    wiz.nav = nav;

    // pätička každej karty: čas aplikácie a tlačidlá
    wiz.secs.forEach((sec, i) => {
      const input = el('input');
      input.type = 'text'; input.inputMode = 'numeric'; input.placeholder = '0:00'; input.autocomplete = 'off'; input.maxLength = 4;
      input.setAttribute('aria-label', 'Čas aplikácie ' + names[i]);
      input.addEventListener('focus', () => input.select());
      input.addEventListener('input', (e) => onWizTime(i, input, e));
      input.addEventListener('keydown', (e) => onWizTimeKey(i, input, e));
      wiz.inputs.push(input);

      const lab = el('label', 'step-time');
      lab.append(el('span', null, 'Čas aplikácie'), input, el('small', null, 'napr. 145 = 1:45'));
      const prev = el('button', 'btn', '← Späť');
      prev.type = 'button'; prev.disabled = i === 0;
      prev.addEventListener('click', () => goStep(i - 1));
      const next = el('button', 'btn cta', i < 4 ? 'Ďalej →' : 'Výsledok →');
      next.type = 'button';
      next.addEventListener('click', () => goStep(i + 1));
      const foot = el('div', 'step-foot');
      foot.append(lab, el('div', 'step-nav'));
      $('.step-nav', foot).append(prev, next);
      sec.append(foot);
    });

    // šípky vľavo a vpravo
    document.addEventListener('keydown', (e) => {
      if (!wiz.built || $('#practice').hidden || e.altKey || e.ctrlKey || e.metaKey) return;
      if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
      const t = e.target;
      if (wiz.inputs.includes(t)) return;                          // v poli s časom rozhoduje onWizTimeKey
      if (t.matches && t.matches('input[type=text],input[type=password],select,textarea')) return;
      e.preventDefault();
      goStep(wiz.i + (e.key === 'ArrowRight' ? 1 : -1));
    });
    wizSync();
    window.addEventListener('resize', () => { clearTimeout(wizEqTimer); wizEqTimer = setTimeout(wizEqualize, 150); });
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(wizEqualize);
  }

  // čas je M:SS: jedna číslica minút a dve číslice sekúnd (00 až 59), dvojbodka sa doplní sama
  function onWizTime(i, input, e) {
    const digits = input.value.replace(/\D/g, '');
    const deleting = !!(e && e.inputType && e.inputType.indexOf('delete') === 0);
    let min = '', sec = '';
    for (const ch of digits) {
      if (min === '') min = ch;
      else if (sec === '') sec = +ch >= 6 ? '0' + ch : ch;        // 6 až 9 nemôže byť desiatka sekúnd, doplní sa 0
      else if (sec.length === 1) sec += ch;
    }
    const v = min === '' ? '' : (sec === '' ? (deleting ? min : min + ':') : min + ':' + sec);
    if (input.value !== v) input.value = v;
    const m = /^(\d):([0-5]\d)$/.exec(v);
    wiz.d[i] = m ? +m[1] * 60 + +m[2] : null;
    input.classList.remove('invalid');
    wizSync();
    if (!deleting && wiz.d[i] != null) setTimeout(() => { if (wiz.i === i) goStep(i + 1); }, 380);   // po zapísaní času ďalšia karta
  }

  // šípky v poli: vpravo na konci textu = ďalšia karta, vľavo na začiatku = predchádzajúca
  function onWizTimeKey(i, input, e) {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === 'ArrowRight' && input.selectionStart === input.selectionEnd && input.selectionEnd === input.value.length) { e.preventDefault(); goStep(i + 1); }
    else if (e.key === 'ArrowLeft' && input.selectionStart === 0 && input.selectionEnd === 0) { e.preventDefault(); goStep(i - 1); }
    else if (e.key === 'Enter') { e.preventDefault(); goStep(i + 1); }
  }

  function goStep(n) {
    if (!wiz.built) return;
    wiz.i = Math.max(0, Math.min(5, n));
    wizSync();
    wiz.nav.scrollIntoView({ block: 'start' });
    if (wiz.i < 5) wiz.inputs[wiz.i].focus({ preventScroll: true });
  }

  // všetky karty majú rovnakú výšku (podľa najvyššej), takže tlačidlá dole neskáču hore-dole
  let wizEqTimer = null;
  function wizEqualize() {
    if (!wiz.built) return;
    const grid = $('#practice .task-grid');
    if (!grid || $('#practice').hidden) return;
    grid.style.setProperty('--wiz-h', '0px');
    const was = wiz.secs.map((x) => x.hidden);
    const w = grid.clientWidth;
    wiz.secs.forEach((x) => { x.hidden = false; x.style.position = 'absolute'; x.style.visibility = 'hidden'; x.style.width = w + 'px'; });
    const max = Math.max(...wiz.secs.map((x) => x.offsetHeight));
    wiz.secs.forEach((x, i) => { x.hidden = was[i]; x.style.position = ''; x.style.visibility = ''; x.style.width = ''; });
    grid.style.setProperty('--wiz-h', Math.ceil(max) + 'px');
  }

  function wizSync() {
    if (!wiz.built) return;
    wiz.secs.forEach((s, i) => { s.hidden = wiz.i !== i; });
    wiz.pills.forEach((b, i) => {
      b.classList.toggle('current', i === wiz.i);
      const has = i < 5 ? wiz.d[i] != null : wizAll();
      b.classList.toggle('done', has);
      // hotový krok: namiesto čísla sa zobrazí čas (jedna kompaktná pílulka), výsledok ukáže súčet
      const val = i < 5 ? wiz.d[i] : (wizAll() ? wizTotal() : null);
      const wn = $('.wn', b);
      wn.textContent = val != null ? fmtTime(val) : (i < 5 ? String(i + 1) : '✓');
      wn.classList.toggle('time', val != null);
    });
    const res = $('#practiceOfficial');
    if (res) { res.hidden = wiz.i !== 5; if (wiz.i === 5) renderWizardResult(res); }
  }

  function wizReset() {
    wiz.d = [null, null, null, null, null];
    wiz.i = 0;
    wiz.inputs.forEach((inp) => { inp.value = ''; inp.classList.remove('invalid'); });
    checks.forEach((c) => { c.checked = false; });                 // zaškrtnuté úlohy sa vynulujú
    updateProgress(false);
    wizSync();
  }

  // súhrn: päť časov, výsledný čas, splnené / nesplnené
  function renderWizardResult(box) {
    const head = $('h3', box);
    box.innerHTML = '';
    if (head) box.append(head);
    const apps = APPS.practical;
    const list = el('div', 'laps');
    apps.forEach((name, i) => {
      const row = el('div', 'lap-row');
      row.classList.toggle('done', wiz.d[i] != null);
      const t = el('span', 't', wiz.d[i] != null ? fmtTime(wiz.d[i]) : 'chýba');
      const edit = el('button', 'btn', 'Upraviť');
      edit.type = 'button';
      edit.addEventListener('click', () => goStep(i));
      row.append(el('span', 'n', String(i + 1)), el('span', null, name), t, edit);
      list.append(row);
    });
    const all = wizAll();
    const total = wizTotal();
    const pass = total < LIMIT.practical;
    const verdict = el('span', 'verdict' + (all ? (pass ? ' ok' : ' bad') : ''), all ? (pass ? 'Splnené' : 'Nesplnené (limit ' + fmtTime(LIMIT.practical) + ')') : '');
    const totalRow = el('div', 'meter-total');
    totalRow.append(el('span', null, 'Výsledný čas:'), el('b', null, all ? fmtTime(total) : '—'), verdict);
    const back = el('button', 'btn', '← Späť');
    back.type = 'button';
    back.addEventListener('click', () => goStep(4));
    const again = el('button', 'btn ghost', 'Nový test');
    again.type = 'button';
    again.addEventListener('click', () => { if (confirm('Vymazať všetky časy a začať odznova?')) { wizReset(); goStep(0); } });
    const status = el('span', 'send-status' + (all ? (pass ? ' ok' : ' err') : ''), all ? readEmployee() + ': ' + fmtTime(total) + (pass ? ' – splnené' : ' – nesplnené') : 'Chýbajú časy niektorých aplikácií.');
    const acts = el('div', 'meter-total');
    acts.append(back, again, status);
    box.append(list, totalRow, acts);
  }

  /* Školiteľ meria čas po každej aplikácii na vlastných stopkách a časy sem len zapíše. */
  function buildManualMeter(box, kind, local) {
    const apps = APPS[kind];
    const limit = LIMIT[kind];
    const attempt = local ? 0 : S[kind].attempts + 1;
    const rid = newRid();
    const d = apps.map(() => null);

    // čas je vždy M:SS: jedna číslica minút a dve číslice sekúnd (00 až 59)
    function parseTime(v) {
      const m = /^(\d):([0-5]\d)$/.exec(String(v).trim());
      return m ? +m[1] * 60 + +m[2] : null;
    }

    const list = el('div', 'laps');
    const inputs = apps.map((name, i) => {
      const row = el('div', 'lap-row');
      const input = el('input');
      input.type = 'text'; input.inputMode = 'numeric'; input.placeholder = '0:00'; input.autocomplete = 'off';
      input.setAttribute('aria-label', 'Čas: ' + name);
      input.maxLength = 4;
      input.addEventListener('focus', () => input.select());       // nové písanie prepíše starú hodnotu
      input.addEventListener('input', (e) => {
        // píšu sa len číslice: minúta a dve číslice sekúnd, dvojbodka sa doplní sama (145 = 1:45, 045 = 0:45, 107 = 1:07)
        const digits = input.value.replace(/\D/g, '');
        const deleting = !!(e && e.inputType && e.inputType.indexOf('delete') === 0);
        let min = '', sec = '';
        for (const ch of digits) {
          if (min === '') min = ch;
          else if (sec === '') sec = +ch >= 6 ? '0' + ch : ch;      // 6 až 9 nemôže byť desiatka sekúnd, doplní sa 0
          else if (sec.length === 1) sec += ch;
        }
        const v = min === '' ? '' : (sec === '' ? (deleting ? min : min + ':') : min + ':' + sec);
        if (input.value !== v) input.value = v;
        d[i] = parseTime(v);
        input.classList.remove('invalid');
        row.classList.toggle('done', d[i] != null);
        recompute();
        if (!deleting && d[i] != null && inputs[i + 1]) inputs[i + 1].focus();   // po dokončení skočí na ďalšie políčko
      });
      input.addEventListener('change', () => { input.classList.toggle('invalid', input.value !== '' && d[i] == null); });
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { const n = inputs[i + 1]; if (n) n.focus(); else if (!local && !writeBtn.disabled) writeBtn.click(); }
      });
      row.append(el('span', 'n', String(i + 1)), el('span', null, name), input, el('span'));
      list.append(row);
      return input;
    });

    const verdict = el('span', 'verdict');
    const totalEl = el('b', null, '0:00');
    const writeBtn = el('button', 'btn amber', 'Zapísať do tabuľky');
    writeBtn.type = 'button'; writeBtn.disabled = true;
    const clearBtn = el('button', 'btn ghost', 'Vymazať');
    clearBtn.type = 'button';
    const status = el('span', 'send-status');
    const totalRow = el('div', 'meter-total');
    totalRow.append(el('span', null, 'Výsledný čas:'), totalEl, verdict);
    if (!local) totalRow.append(writeBtn);
    totalRow.append(clearBtn, status);
    box.append(list, totalRow);

    function recompute() {
      const all = d.every((v) => v != null);
      const total = d.reduce((a, b) => a + (b || 0), 0);
      totalEl.textContent = all ? fmtTime(total) : '—';
      const pass = total < limit;
      verdict.textContent = all ? (pass ? 'Splnené' : 'Nesplnené (limit ' + fmtTime(limit) + ')') : '';
      verdict.className = 'verdict' + (all ? (pass ? ' ok' : ' bad') : '');
      writeBtn.disabled = !all;
      if (local) {
        status.className = 'send-status' + (all ? (pass ? ' ok' : ' err') : '');
        status.textContent = all ? readEmployee() + ': ' + fmtTime(total) + (pass ? ' – splnené' : ' – nesplnené') : '';
      }
    }
    clearBtn.addEventListener('click', () => {
      inputs.forEach((inp, i) => { inp.value = ''; inp.classList.remove('invalid'); d[i] = null; inp.closest('.lap-row').classList.remove('done'); });
      recompute(); inputs[0].focus();
    });
    writeBtn.addEventListener('click', async () => {
      const total = d.reduce((a, b) => a + b, 0);
      writeBtn.disabled = true;
      status.className = 'send-status'; status.textContent = 'Zapisujem…';
      try {
        await api(kind, { emp: readEmployee(), pin: trainerPin, laps: d, total, rid });
        lastNote[kind] = '✓ Pokus č. ' + attempt + ' zapísaný: ' + fmtTime(total) + (total < limit ? ' – splnené.' : ' – nesplnené (limit ' + fmtTime(limit) + ').');
        unlocked[kind] = false;
        await refreshStatus();
      } catch (err) {
        status.className = 'send-status err';
        status.textContent = 'Zápis zlyhal: ' + err.message;
        if (/PIN/.test(err.message)) { trainerPin = ''; unlocked[kind] = false; renderOfficial(kind); return; }
        writeBtn.disabled = false;
      }
    });
    recompute();
    setTimeout(() => inputs[0].focus(), 50);
  }

  function buildMeter(box, kind) {
    if (CFG.MANUAL_TIMES) { buildManualMeter(box, kind); return; }
    const apps = APPS[kind];
    const limit = LIMIT[kind];
    const attempt = S[kind].attempts + 1;
    let t0 = 0, tick = null, running = false, ended = false;
    const rid = newRid();
    const cum = [];
    const d = apps.map(() => 0);

    const clock = el('div', 'clock', '0:00');
    const startBtn = el('button', 'btn primary', 'Štart');
    const resetBtn = el('button', 'btn ghost', 'Znova');
    startBtn.type = resetBtn.type = 'button';
    const headRow = el('div', 'meter-head');
    headRow.append(clock, el('span', 'small', 'cieľ pod ' + fmtTime(limit)), startBtn, resetBtn);

    const laps = el('div', 'laps');
    const rows = apps.map((name, i) => {
      const row = el('div', 'lap-row');
      const t = el('span', 't', '—');
      const input = el('input'); input.type = 'text'; input.hidden = true; input.inputMode = 'numeric'; input.setAttribute('aria-label', 'Čas ' + name);
      const btn = el('button', 'btn', 'Hotovo'); btn.type = 'button';
      row.append(el('span', 'n', String(i + 1)), el('span', null, name), t, btn);
      laps.append(row);
      btn.addEventListener('click', () => lap(i));
      input.addEventListener('input', () => { recompute(); });
      return { row, t, input, btn };
    });

    const verdict = el('span', 'verdict');
    const totalEl = el('b', null, '0:00');
    const writeBtn = el('button', 'btn amber', 'Zapísať do tabuľky');
    writeBtn.type = 'button'; writeBtn.disabled = true;
    const status = el('span', 'send-status');
    const totalRow = el('div', 'meter-total');
    totalRow.append(el('span', null, 'Výsledný čas:'), totalEl, verdict, writeBtn, status);

    box.append(headRow, laps, totalRow);

    function parseTime(v) {
      const m = /^\s*(\d{1,2}):(\d{2})\s*$/.exec(v);
      return m && +m[2] < 60 ? +m[1] * 60 + +m[2] : null;
    }
    function sync() {
      rows.forEach((r, i) => {
        r.row.classList.toggle('current', running && i === cum.length);
        r.row.classList.toggle('done', i < cum.length);
        r.btn.hidden = ended;
        r.btn.disabled = !running || i !== cum.length;
        if (!ended) { r.t.textContent = i < cum.length ? fmtTime(d[i]) : '—'; }
      });
      startBtn.disabled = running || ended;
    }
    function recompute() {
      let ok = true;
      if (ended) {
        rows.forEach((r, i) => {
          const v = parseTime(r.input.value);
          r.input.classList.toggle('invalid', v == null);
          if (v == null) ok = false; else d[i] = v;
        });
      }
      const total = d.reduce((a, b) => a + b, 0);
      totalEl.textContent = fmtTime(total);
      const pass = total < limit;
      verdict.textContent = ended ? (pass ? 'Splnené' : 'Nesplnené (limit ' + fmtTime(limit) + ')') : '';
      verdict.className = 'verdict' + (ended ? (pass ? ' ok' : ' bad') : '');
      writeBtn.disabled = !(ended && ok);
    }
    function paint() {
      const sec = Math.floor((Date.now() - t0) / 1000);
      clock.textContent = fmtTime(sec);
      clock.classList.toggle('over', sec >= limit);
    }
    function lap(i) {
      if (!running || i !== cum.length) return;
      const sec = Math.round((Date.now() - t0) / 1000);
      cum.push(sec);
      d[i] = sec - (cum[i - 1] || 0);
      if (cum.length === apps.length) {
        running = false; ended = true;
        clearInterval(tick);
        clock.textContent = fmtTime(sec);
        clock.classList.toggle('over', sec >= limit);
        rows.forEach((r, k) => { r.input.value = fmtTime(d[k]); r.input.hidden = false; r.t.replaceWith(r.input); });
      }
      sync(); recompute();
    }
    startBtn.addEventListener('click', () => {
      running = true; t0 = Date.now();
      tick = setInterval(paint, 200);
      setOfficialRun(true);
      sync();
    });
    resetBtn.addEventListener('click', () => {
      clearInterval(tick);
      setOfficialRun(false);
      renderOfficial(kind);
    });
    writeBtn.addEventListener('click', async () => {
      const total = d.reduce((a, b) => a + b, 0);
      if (!confirm('Zapísať pokus č. ' + attempt + ' pre „' + readEmployee() + '“ s časom ' + fmtTime(total) + '?')) return;
      writeBtn.disabled = true;
      status.className = 'send-status'; status.textContent = 'Zapisujem…';
      try {
        await api(kind, { emp: readEmployee(), pin: trainerPin, laps: d, total, rid });
        lastNote[kind] = '✓ Pokus č. ' + attempt + ' zapísaný: ' + fmtTime(total) + (total < limit ? ' – splnené.' : ' – nesplnené (limit ' + fmtTime(limit) + ').');
        unlocked[kind] = false;
        setOfficialRun(false);
        await refreshStatus();
      } catch (err) {
        status.className = 'send-status err';
        status.textContent = 'Zápis zlyhal: ' + err.message;
        if (/PIN/.test(err.message)) { trainerPin = ''; unlocked[kind] = false; setOfficialRun(false); renderOfficial(kind); return; }
        writeBtn.disabled = false;
      }
    });

    sync(); recompute();
  }

  function renderAll() {
    paintSteps();
    paintHome();
    updateQuizModeUI();
    refreshControls();
    renderOfficial('practical');
    if (HAS_FINAL) renderOfficial('final');
  }

  // Enter v poli mena = rovnaké ako kliknutie na tlačidlo na úvode (pokračuje, alebo upozorní, že meno je povinné)
  [empText, empSelect].forEach((f) => f.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && f.type !== 'select-one') { e.preventDefault(); $('#goNext').click(); }
  }));

  /* ===== ŠTART ===== */
  paintMode();
  resetQuiz();
  renderAll();
  {
    let first = location.hash.replace('#', '') || 'home';
    if (CFG.STANDALONE && first !== 'home' && !employeeValid()) first = 'home';   // bez mena sa začína na úvode
    showView(first);
  }
  window.scrollTo(0, 0);
  initEmployees();
})();
