// Kundly — form state machine
// Loads chapters.json, renders one question at a time, persists to localStorage.
// No framework. No build step. Vanilla JS.
//
// SECURITY NOTE: User-entered text is NEVER injected via innerHTML. All user
// values go through textContent or input.value assignment. Static chapter text
// comes from our own chapters.json asset which is trusted.
//
// TRACK D wiring (2026-04-07): The form now ends in a submit-confirmation
// screen (Layer 4 of consent-copy.md). On Submit, the entire state is POSTed
// directly to Supabase via PostgREST using the anon publishable key — RLS
// policies on threadwriter_seekers enforce status='submitted' + no spark_md.
// On INSERT success, we fire-and-forget the spark-generate Edge Function and
// redirect to thanks.html with the inserted row id (so it can subscribe to
// realtime spark updates).
//
// Anonymity-first: nothing leaves localStorage until the seeker clicks the
// final Submit button on the confirmation screen.

(function(){
  'use strict';

  var DRAFT_KEY = 'kundly_draft_v1';
  var SUBMITTED_KEY = 'kundly_submission_v1';
  var CHAPTERS_URL = '/kundly/data/chapters.json';
  var AUTOSAVE_DEBOUNCE_MS = 500;

  // ─── Supabase config (anon publishable key — RLS-protected) ───────────
  var SUPABASE_URL = 'https://swnhmrljpafvaojaytkv.supabase.co';
  var SUPABASE_ANON_KEY = 'sb_publishable_WJtwGO-qPRDnIYJ4ImdK-w_cz9o9xk1';
  var REST_URL = SUPABASE_URL + '/rest/v1/threadwriter_seekers';
  var SPARK_FN_URL = SUPABASE_URL + '/functions/v1/spark-generate';

  // ─── State ────────────────────────────────────────────────────────────
  var state = {
    seeker_code: null,
    consent_version: null,
    chapters: {},
    safety_screen: {},
    current_chapter_idx: 0,
    current_question_idx: 0,
    started_at: null,
    last_saved_at: null
  };

  var chaptersData = null;
  var autosaveTimer = null;
  var formStartTracked = false;

  // ─── Analytics shim ───────────────────────────────────────────────────
  // Defensive — pages embed kundlyTrack() in <head>. If missing (e.g. dev or
  // adblocker preempting the head script), this becomes a no-op.
  function track(name, params){
    try {
      if (typeof window.kundlyTrack === 'function') {
        window.kundlyTrack(name, params || {});
      }
    } catch(e){}
  }
  function bucketMs(ms){
    if (ms < 1000) return 'lt1s';
    if (ms < 3000) return 'lt3s';
    if (ms < 10000) return 'lt10s';
    if (ms < 30000) return 'lt30s';
    return 'gte30s';
  }
  function classifyError(err){
    var msg = (err && err.message) ? String(err.message) : '';
    if (/timed out/i.test(msg)) return 'timeout';
    if (/Network/i.test(msg)) return 'network';
    var m = msg.match(/HTTP (\d{3})/);
    if (m) {
      var code = parseInt(m[1], 10);
      if (code === 401 || code === 403) return 'http_auth';
      if (code === 409) return 'http_conflict';
      if (code >= 500) return 'http_5xx';
      if (code >= 400) return 'http_4xx';
    }
    return 'unknown';
  }

  // ─── DOM refs ─────────────────────────────────────────────────────────
  var $container = document.getElementById('chapter-container');
  var $skcode = document.getElementById('k-skcode-value');
  var $autosave = document.getElementById('k-autosave');

  // ─── Tiny DOM helper ──────────────────────────────────────────────────
  function h(tag, attrs, children){
    var el = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function(k){
        if (k === 'class') el.className = attrs[k];
        else if (k === 'text') el.textContent = attrs[k];
        else if (k === 'html') { /* disallowed */ }
        else if (k === 'value') el.value = attrs[k];
        else if (k.indexOf('on') === 0) el.addEventListener(k.slice(2), attrs[k]);
        else el.setAttribute(k, attrs[k]);
      });
    }
    if (children) {
      children.forEach(function(c){
        if (c == null) return;
        if (typeof c === 'string') el.appendChild(document.createTextNode(c));
        else el.appendChild(c);
      });
    }
    return el;
  }

  function clear(node){
    while (node.firstChild) node.removeChild(node.firstChild);
  }

  // ─── Bootstrap ────────────────────────────────────────────────────────
  function init(){
    state.seeker_code = window.KundlySkCode.getOrCreate();
    if ($skcode) $skcode.textContent = state.seeker_code;

    try {
      var c = JSON.parse(localStorage.getItem('kundly_consent_v1') || 'null');
      if (c) state.consent_version = c.version;
    } catch(e){}

    try {
      var draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null');
      if (draft) {
        state.chapters = draft.chapters || {};
        state.safety_screen = draft.safety_screen || {};
        state.current_chapter_idx = draft.current_chapter_idx || 0;
        state.current_question_idx = draft.current_question_idx || 0;
        state.started_at = draft.started_at;
      }
    } catch(e){
      console.warn('Could not hydrate draft', e);
    }
    if (!state.started_at) state.started_at = new Date().toISOString();

    fetch(CHAPTERS_URL)
      .then(function(r){ return r.json(); })
      .then(function(data){
        chaptersData = data;
        if (!formStartTracked) {
          formStartTracked = true;
          track('kundly_form_start', {
            chapters_total: (data && data.chapters && data.chapters.length) || 0,
            resumed: !!(state.chapters && Object.keys(state.chapters).length)
          });
        }
        render();
      })
      .catch(function(err){
        clear($container);
        $container.appendChild(h('div', { class: 'k-chapter__intro', text: 'Something went wrong loading the questions. Please refresh the page. If the issue persists, write to wilfred.desouza1996@gmail.com.' }));
        console.error(err);
      });
  }

  // ─── Persistence ──────────────────────────────────────────────────────
  function persist(){
    state.last_saved_at = new Date().toISOString();
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(state));
      flashAutosave('saved just now');
    } catch(e){
      flashAutosave('could not save');
      console.warn('localStorage write failed', e);
    }
  }

  function queueAutosave(){
    if ($autosave) {
      clear($autosave);
      $autosave.appendChild(document.createTextNode('saving…'));
      $autosave.classList.add('k-autosave--visible');
    }
    if (autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(persist, AUTOSAVE_DEBOUNCE_MS);
  }

  // Force the pending debounce to fire immediately. Called from beforeunload
  // and pagehide so a fast tab-close in the 500ms debounce window doesn't
  // lose the latest keystrokes.
  function flushAutosave(){
    if (autosaveTimer) {
      clearTimeout(autosaveTimer);
      autosaveTimer = null;
      try { persist(); } catch(e){}
    }
  }
  window.addEventListener('beforeunload', flushAutosave);
  window.addEventListener('pagehide', flushAutosave);

  function flashAutosave(msg){
    if (!$autosave) return;
    clear($autosave);
    var dot = document.createElement('span');
    dot.className = 'k-autosave__dot';
    $autosave.appendChild(dot);
    $autosave.appendChild(document.createTextNode(' ' + msg));
    $autosave.classList.add('k-autosave--visible');
  }

  // ─── Safety sweep ─────────────────────────────────────────────────────
  function checkSafetyOrRedirect(text){
    if (window.KundlySafetySweep && window.KundlySafetySweep.sweepForHardFlags(text)) {
      track('kundly_safety_redirect', { trigger: 'sweep' });
      try {
        localStorage.removeItem(DRAFT_KEY);
        localStorage.removeItem('kundly_sk_code_v1');
      } catch(e){}
      window.location = '/kundly/safety.html';
      return true;
    }
    return false;
  }

  // ─── Helpers ──────────────────────────────────────────────────────────
  function wordCount(s){
    if (!s) return 0;
    var t = s.trim();
    if (!t) return 0;
    return t.split(/\s+/).length;
  }

  function getChapter(idx){ return chaptersData.chapters[idx]; }

  function getAnswer(chapterId, qId){
    return (state.chapters[chapterId] && state.chapters[chapterId][qId]) || '';
  }

  function setAnswer(chapterId, qId, value){
    if (!state.chapters[chapterId]) state.chapters[chapterId] = {};
    state.chapters[chapterId][qId] = value;
  }

  function setSafetyAnswer(qId, value){
    state.safety_screen[qId] = value;
  }

  function findQuestion(ch, qid){
    for (var i = 0; i < ch.questions.length; i++) {
      if (ch.questions[i].q_id === qid) return ch.questions[i];
    }
    return null;
  }

  function narrativeQuestions(ch){
    return ch.questions.filter(function(q){ return q.type === 'prose'; });
  }

  // ─── Rendering ────────────────────────────────────────────────────────
  function render(){
    var ch = getChapter(state.current_chapter_idx);
    if (!ch) { renderDone(); return; }
    if (ch.is_safety_screen) { renderSafetyChapter(ch); return; }
    if (ch.chapter_id === 'chapter_1' && state.current_question_idx === 0) {
      renderChapter1Intro(ch);
      return;
    }
    renderNarrativeQuestion(ch);
  }

  function chapterHeaderNodes(ch){
    var nodes = [];
    nodes.push(h('p', { class: 'k-chapter__progress', text: 'Chapter ' + ch.number + ' of 6 — ' + ch.title }));
    if (ch.intro_card) {
      nodes.push(h('div', { class: 'k-chapter__intro', text: ch.intro_card }));
    }
    return nodes;
  }

  function renderChapter1Intro(ch){
    clear($container);
    chapterHeaderNodes(ch).forEach(function(n){ $container.appendChild(n); });
    $container.appendChild(h('h2', { class: 'k-chapter__title', text: 'A little about you' }));
    $container.appendChild(h('p', { class: 'k-question__helper', text: 'Just the basics. Your first name is the only one we actually need.' }));

    var metaFields = ['c1_first_name','c1_age','c1_gender_pronouns','c1_occupation','c1_location'];
    metaFields.forEach(function(qid){
      var q = findQuestion(ch, qid);
      if (!q) return;
      var val = getAnswer(ch.chapter_id, qid);

      var wrap = h('div', { class: 'k-question' });
      var labelText = q.label || q.text;
      var labelEl = h('label', { class: 'k-question__prompt', for: qid });
      labelEl.style.fontSize = '1rem';
      labelEl.appendChild(document.createTextNode(labelText));
      if (!q.mandatory) {
        var em = h('em', { text: ' (optional)' });
        em.style.color = 'var(--k-muted)';
        em.style.fontWeight = '400';
        em.style.fontSize = '0.875rem';
        labelEl.appendChild(em);
      }
      wrap.appendChild(labelEl);

      if (q.helper) wrap.appendChild(h('p', { class: 'k-question__helper', text: q.helper }));

      var input = document.createElement('input');
      input.type = q.type === 'number' ? 'number' : 'text';
      input.id = qid;
      input.className = 'k-input';
      input.value = val;
      if (q.type === 'number') {
        input.min = q.min || 0;
        input.max = q.max || 120;
      }
      input.addEventListener('input', function(){
        setAnswer(ch.chapter_id, qid, input.value);
        queueAutosave();
      });
      wrap.appendChild(input);

      var err = h('p', { class: 'k-question__helper', id: qid + '-error' });
      err.style.color = 'var(--k-terracotta)';
      err.style.display = 'none';
      err.style.marginTop = '0.5rem';
      wrap.appendChild(err);

      $container.appendChild(wrap);
    });

    $container.appendChild(buildNav({
      showPrev: false,
      nextLabel: 'Continue',
      onNext: function(){
        var firstName = (getAnswer(ch.chapter_id, 'c1_first_name') || '').trim();
        var ageRaw = (getAnswer(ch.chapter_id, 'c1_age') || '').toString().trim();
        var age = parseInt(ageRaw, 10);
        var ok = true;
        if (!firstName) { showFieldError('c1_first_name', 'We just need a first name to write to you by.'); ok = false; }
        if (!ageRaw || isNaN(age)) { showFieldError('c1_age', 'We need your age to make sure you are 18 or over.'); ok = false; }
        else if (age < 18) { showFieldError('c1_age', 'Kundly is for adults 18 and over. If you are under 18 and need support, please visit /kundly/safety.html for help lines you can reach today.'); ok = false; }
        if (!ok) return;
        state.current_question_idx = 1;
        persist();
        render();
      }
    }));
  }

  function showFieldError(qid, msg){
    var el = document.getElementById(qid + '-error');
    if (el) {
      el.textContent = msg;
      el.style.display = 'block';
    }
  }

  function renderNarrativeQuestion(ch){
    var prose = narrativeQuestions(ch);
    var proseIdx;
    if (ch.chapter_id === 'chapter_1') proseIdx = state.current_question_idx - 1;
    else proseIdx = state.current_question_idx;

    if (proseIdx >= prose.length) {
      // Chapter just finished — fire chapter_complete with the just-completed
      // chapter number (1-indexed) before advancing.
      track('kundly_chapter_complete', {
        chapter_number: ch.number,
        chapter_id: ch.chapter_id
      });
      state.current_chapter_idx += 1;
      state.current_question_idx = 0;
      persist();
      render();
      return;
    }

    var q = prose[proseIdx];
    var val = getAnswer(ch.chapter_id, q.q_id);

    clear($container);
    chapterHeaderNodes(ch).forEach(function(n){ $container.appendChild(n); });
    $container.appendChild(h('h2', { class: 'k-chapter__title', text: ch.title }));

    if (q.grounding_before || (proseIdx === 0 && ch.grounding_card_before)) {
      var g = h('div', { class: 'k-grounding' });
      g.appendChild(h('p', { class: 'k-grounding__title', text: 'A small pause' }));
      var gp = h('p');
      gp.appendChild(document.createTextNode('Take a slow breath before you start. You can write as much or as little as you want. You can skip and come back. If anything gets hard, iCall is at '));
      gp.appendChild(h('strong', { text: '9152987821' }));
      gp.appendChild(document.createTextNode('.'));
      g.appendChild(gp);
      $container.appendChild(g);
    }

    var qWrap = h('div', { class: 'k-question' });
    var prompt = h('p', { class: 'k-question__prompt', text: q.text });
    if (!q.mandatory) {
      var em = h('em', { text: ' (optional — skip if you like)' });
      em.style.color = 'var(--k-muted)';
      em.style.fontWeight = '400';
      em.style.fontSize = '0.875rem';
      prompt.appendChild(em);
    }
    qWrap.appendChild(prompt);
    if (q.helper) qWrap.appendChild(h('p', { class: 'k-question__helper', text: q.helper }));
    qWrap.appendChild(h('p', { class: 'k-question__helper', text: chaptersData.hinglish_helper_line }));

    var ta = document.createElement('textarea');
    ta.id = q.q_id;
    ta.className = 'k-textarea';
    ta.rows = 8;
    ta.placeholder = 'Take your time…';
    ta.value = val;
    qWrap.appendChild(ta);

    var wc = h('div', { class: 'k-wordcount' });
    var wcLeft = h('span');
    var wcNum = h('span', { id: q.q_id + '-count', text: String(wordCount(val)) });
    wcLeft.appendChild(wcNum);
    wcLeft.appendChild(document.createTextNode(' words'));
    wc.appendChild(wcLeft);
    if (q.min_words_suggested) {
      wc.appendChild(h('span', { class: 'k-wordcount__target', text: 'a deeper answer is around ' + q.min_words_suggested + ' words' }));
    }
    qWrap.appendChild(wc);

    var softWarn = h('p', { class: 'k-question__helper', id: q.q_id + '-softwarn' });
    softWarn.style.display = 'none';
    softWarn.style.color = 'var(--k-ink-soft)';
    softWarn.style.marginTop = '0.75rem';
    qWrap.appendChild(softWarn);

    $container.appendChild(qWrap);

    ta.addEventListener('input', function(){
      var v = ta.value;
      if (checkSafetyOrRedirect(v)) return;
      setAnswer(ch.chapter_id, q.q_id, v);
      wcNum.textContent = String(wordCount(v));
      queueAutosave();
    });
    ta.focus();

    $container.appendChild(buildNav({
      showPrev: true,
      showSkip: q.skippable && !q.mandatory,
      nextLabel: proseIdx === prose.length - 1 ? 'Next chapter' : 'Continue',
      onPrev: function(){
        if (state.current_question_idx > 0) {
          state.current_question_idx -= 1;
        } else if (state.current_chapter_idx > 0) {
          state.current_chapter_idx -= 1;
          var prevCh = getChapter(state.current_chapter_idx);
          var prevProse = narrativeQuestions(prevCh);
          state.current_question_idx = prevCh.chapter_id === 'chapter_1'
            ? prevProse.length
            : Math.max(0, prevProse.length - 1);
        }
        persist();
        render();
      },
      onSkip: q.skippable ? function(){
        state.current_question_idx += 1;
        persist();
        render();
      } : null,
      onNext: function(){
        var v = ta.value.trim();
        if (q.mandatory && !v) {
          softWarn.textContent = 'This one matters — it helps us see you better. Take a moment if you can.';
          softWarn.style.display = 'block';
          return;
        }
        if (q.min_words_suggested && v && wordCount(v) < q.min_words_suggested) {
          if (softWarn.dataset.acknowledged !== '1') {
            softWarn.textContent = 'You wrote ' + wordCount(v) + ' words. A deeper answer might help us see you better — but if this is what you want to say, that is okay. Tap Continue again to move on.';
            softWarn.style.display = 'block';
            softWarn.dataset.acknowledged = '1';
            return;
          }
        }
        state.current_question_idx += 1;
        persist();
        render();
      }
    }));
  }

  function renderSafetyChapter(ch){
    clear($container);
    chapterHeaderNodes(ch).forEach(function(n){ $container.appendChild(n); });
    $container.appendChild(h('h2', { class: 'k-chapter__title', text: ch.title }));

    ch.questions.forEach(function(q){
      var wrap = h('div', { class: 'k-question' });
      wrap.appendChild(h('p', { class: 'k-question__prompt', text: q.label || q.text }));

      if (q.type === 'select') {
        q.options.forEach(function(opt){
          var optId = q.q_id + '-' + opt.value;
          var lbl = h('label', { class: 'k-checkbox', for: optId });
          lbl.style.marginBottom = '0.75rem';
          var r = document.createElement('input');
          r.type = 'radio';
          r.name = q.q_id;
          r.id = optId;
          r.value = opt.value;
          r.dataset.flag = opt.flag || '';
          if (state.safety_screen[q.q_id] === opt.value) r.checked = true;
          r.addEventListener('change', function(){
            setSafetyAnswer(q.q_id, r.value);
            if (r.dataset.flag === 'hard') {
              track('kundly_safety_redirect', { trigger: 'screen', q_id: q.q_id });
              try {
                localStorage.removeItem(DRAFT_KEY);
                localStorage.removeItem('kundly_sk_code_v1');
              } catch(e){}
              window.location = '/kundly/safety.html';
              return;
            }
            queueAutosave();
          });
          lbl.appendChild(r);
          lbl.appendChild(h('span', { class: 'k-checkbox__label', text: opt.text }));
          wrap.appendChild(lbl);
        });
      } else if (q.type === 'prose') {
        var ta = document.createElement('textarea');
        ta.id = q.q_id;
        ta.className = 'k-textarea';
        ta.rows = 5;
        ta.placeholder = 'Optional — a few lines if anything comes to mind.';
        ta.value = state.safety_screen[q.q_id] || '';
        ta.addEventListener('input', function(){
          if (checkSafetyOrRedirect(ta.value)) return;
          setSafetyAnswer(q.q_id, ta.value);
          queueAutosave();
        });
        wrap.appendChild(ta);
      }
      $container.appendChild(wrap);
    });

    $container.appendChild(buildNav({
      showPrev: true,
      nextLabel: 'Finish and send',
      onPrev: function(){
        state.current_chapter_idx -= 1;
        var prev = getChapter(state.current_chapter_idx);
        var prose = narrativeQuestions(prev);
        state.current_question_idx = prev.chapter_id === 'chapter_1' ? prose.length : Math.max(0, prose.length - 1);
        persist();
        render();
      },
      onNext: function(){
        var missing = false;
        ch.questions.forEach(function(q){
          if (q.mandatory && q.type === 'select' && !state.safety_screen[q.q_id]) missing = true;
        });
        if (missing) {
          alert('A couple of small answers are still needed before you finish.');
          return;
        }
        persist();
        // Layer 4 — submit confirmation screen (delivery contact + final consent)
        renderSubmitConfirmation();
      }
    }));
  }

  function renderDone(){
    clear($container);
    $container.appendChild(h('div', { class: 'k-chapter__intro', text: 'All done. Redirecting…' }));
    setTimeout(function(){ window.location = '/kundly/thanks.html'; }, 500);
  }

  // ─── Layer 4 — Submit confirmation screen ─────────────────────────────
  // From references/consent-copy.md v1.1: "Last check" before the row leaves
  // the device. Collects WhatsApp/email delivery contact (at least one
  // required) and offers an equal-weight delete button.
  function renderSubmitConfirmation(){
    clear($container);

    $container.appendChild(h('p', { class: 'k-chapter__progress', text: 'One last thing' }));
    $container.appendChild(h('h2', { class: 'k-chapter__title', text: 'Last check.' }));

    var intro = h('div', { class: 'k-chapter__intro' });
    var p1 = h('p');
    p1.appendChild(document.createTextNode('You are about to send us what you have written. Until you tap the button below, nothing is stored anywhere except on this device.'));
    intro.appendChild(p1);
    var p2 = h('p');
    p2.appendChild(document.createTextNode('Once you submit, we will read your story carefully, write you a Spark you will see here in about a minute, and your full Reflection Letter will reach you in 2–4 business days.'));
    intro.appendChild(p2);
    var p3 = h('p');
    p3.appendChild(document.createTextNode('You can still go back and edit anything. And you can delete everything, right now, if you have changed your mind — no questions asked.'));
    intro.appendChild(p3);
    $container.appendChild(intro);

    // ─── Delivery contact picker ───
    var deliveryWrap = h('div', { class: 'k-question' });
    deliveryWrap.style.marginTop = '2rem';
    deliveryWrap.appendChild(h('h3', { class: 'k-chapter__title', text: 'How should we send you your Reflection Letter?' }));
    var deliveryHelper = h('p', { class: 'k-question__helper', text: 'Pick one or both. We will use this only for delivery — no newsletters, no follow-up emails ever.' });
    deliveryWrap.appendChild(deliveryHelper);

    // WhatsApp
    var waLabel = h('label', { class: 'k-question__prompt', for: 'delivery_whatsapp' });
    waLabel.style.fontSize = '1rem';
    waLabel.appendChild(document.createTextNode('WhatsApp number '));
    var waEm = h('em', { text: '(recommended for most people in India)' });
    waEm.style.color = 'var(--k-muted)';
    waEm.style.fontWeight = '400';
    waEm.style.fontSize = '0.875rem';
    waLabel.appendChild(waEm);
    deliveryWrap.appendChild(waLabel);

    var waInput = document.createElement('input');
    waInput.type = 'tel';
    waInput.id = 'delivery_whatsapp';
    waInput.className = 'k-input';
    waInput.placeholder = '+91 98765 43210';
    waInput.autocomplete = 'tel';
    waInput.value = state.delivery_whatsapp || '';
    deliveryWrap.appendChild(waInput);

    // Email
    var emLabel = h('label', { class: 'k-question__prompt', for: 'delivery_email' });
    emLabel.style.fontSize = '1rem';
    emLabel.style.marginTop = '1.25rem';
    emLabel.style.display = 'block';
    emLabel.appendChild(document.createTextNode('Email address'));
    deliveryWrap.appendChild(emLabel);

    var emInput = document.createElement('input');
    emInput.type = 'email';
    emInput.id = 'delivery_email';
    emInput.className = 'k-input';
    emInput.placeholder = 'you@example.com';
    emInput.autocomplete = 'email';
    // Pre-fill from consent gate if seeker entered it there
    var consent = null;
    try { consent = JSON.parse(localStorage.getItem('kundly_consent_v1') || 'null'); } catch(e){}
    emInput.value = state.delivery_email || (consent && consent.email) || '';
    deliveryWrap.appendChild(emInput);

    // Validation hint
    var contactHint = h('p', { class: 'k-question__helper', id: 'delivery-hint' });
    contactHint.style.marginTop = '1rem';
    contactHint.style.color = 'var(--k-terracotta)';
    contactHint.style.display = 'none';
    deliveryWrap.appendChild(contactHint);

    $container.appendChild(deliveryWrap);

    // ─── Submit + delete buttons ───
    var statusBox = h('p', { class: 'k-question__helper', id: 'submit-status' });
    statusBox.style.marginTop = '1.5rem';
    statusBox.style.display = 'none';
    $container.appendChild(statusBox);

    var btnRow = h('div', { class: 'k-chapter-nav' });
    btnRow.style.display = 'flex';
    btnRow.style.flexDirection = 'column';
    btnRow.style.gap = '0.875rem';
    btnRow.style.marginTop = '2rem';

    var submitBtn = h('button', { type: 'button', class: 'k-btn k-btn--primary', text: 'Yes, send my story' });
    submitBtn.style.width = '100%';
    btnRow.appendChild(submitBtn);

    var deleteBtn = h('button', { type: 'button', class: 'k-btn k-btn--ghost', text: 'No, delete what I wrote' });
    deleteBtn.style.width = '100%';
    btnRow.appendChild(deleteBtn);

    var backBtn = h('button', { type: 'button', class: 'k-chapter-nav__skip', text: '← Go back and edit' });
    backBtn.style.alignSelf = 'center';
    backBtn.style.marginTop = '0.5rem';
    btnRow.appendChild(backBtn);

    $container.appendChild(btnRow);

    // ─── Wiring ───
    function setStatus(msg, isError){
      statusBox.textContent = msg;
      statusBox.style.color = isError ? 'var(--k-terracotta)' : 'var(--k-ink-soft)';
      statusBox.style.display = 'block';
    }
    function setHint(msg){
      contactHint.textContent = msg;
      contactHint.style.display = 'block';
    }
    function clearHint(){
      contactHint.style.display = 'none';
    }

    submitBtn.addEventListener('click', function(){
      var wa = waInput.value.trim();
      var em = emInput.value.trim();

      track('kundly_submit_attempt', {
        whatsapp_provided: !!wa,
        email_provided: !!em
      });

      if (!wa && !em) {
        setHint('We need at least one — WhatsApp or email — so we can send you your letter.');
        return;
      }
      if (em && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em)) {
        setHint('That email address does not look quite right. Take another look.');
        return;
      }
      if (wa && !/^[+0-9\s()-]{7,20}$/.test(wa)) {
        setHint('That phone number does not look quite right. Include the country code if you can.');
        return;
      }
      clearHint();

      state.delivery_whatsapp = wa;
      state.delivery_email = em;
      persist();

      submitBtn.disabled = true;
      deleteBtn.disabled = true;
      backBtn.disabled = true;
      submitBtn.textContent = 'Sending…';
      setStatus('Sending your story to us. This takes a few seconds.');

      var submitStartedAt = Date.now();
      submitToSupabase().then(function(rowId){
        track('kundly_submit_success', {
          row_id_known: !!rowId,
          duration_bucket: bucketMs(Date.now() - submitStartedAt)
        });
        // Mark as submitted so back-nav doesn't re-submit
        try {
          localStorage.setItem(SUBMITTED_KEY, JSON.stringify({
            row_id: rowId,
            seeker_code: state.seeker_code,
            first_name: (state.chapters.chapter_1 && state.chapters.chapter_1.c1_first_name) || null,
            submitted_at: new Date().toISOString()
          }));
        } catch(e){}

        // Fire-and-forget the spark generator (don't wait for it; thanks.html
        // subscribes via realtime to see when it lands)
        triggerSpark(state.seeker_code);

        setStatus('Sent. Taking you to your Spark…');
        setTimeout(function(){ window.location = '/kundly/thanks.html'; }, 600);
      }).catch(function(err){
        track('kundly_submit_failure', {
          duration_bucket: bucketMs(Date.now() - submitStartedAt),
          error_kind: classifyError(err)
        });
        console.error('Submit failed', err);
        setStatus('Something went wrong sending your story. Please try again in a moment, or write to wilfred.desouza1996@gmail.com if it keeps failing.', true);
        submitBtn.disabled = false;
        deleteBtn.disabled = false;
        backBtn.disabled = false;
        submitBtn.textContent = 'Yes, send my story';
      });
    });

    deleteBtn.addEventListener('click', function(){
      var ok = window.confirm('This will delete everything you wrote, on this device. There is no undo. Continue?');
      if (!ok) return;
      track('kundly_reset', { from: 'submit_confirmation' });
      try {
        localStorage.removeItem(DRAFT_KEY);
        localStorage.removeItem('kundly_sk_code_v1');
        localStorage.removeItem('kundly_consent_v1');
        localStorage.removeItem(SUBMITTED_KEY);
      } catch(e){}
      window.location = '/kundly/';
    });

    backBtn.addEventListener('click', function(){
      // Go back to the safety chapter
      render();
    });

    // Track edits for autosave
    waInput.addEventListener('input', function(){
      state.delivery_whatsapp = waInput.value.trim();
      queueAutosave();
    });
    emInput.addEventListener('input', function(){
      state.delivery_email = emInput.value.trim();
      queueAutosave();
    });
  }

  // ─── Submit to Supabase ───────────────────────────────────────────────
  // Uses the anon publishable key + RLS. Inserts a single row with
  // status='submitted'. Returns the row id on success.
  function submitToSupabase(){
    return new Promise(function(resolve, reject){
      // Build the payload — strip operational metadata, only send what
      // the schema expects + what RLS allows for an anon INSERT.
      var firstName = (state.chapters.chapter_1 && state.chapters.chapter_1.c1_first_name) || null;
      var safetyHardFlag = false;
      // Hard flag would have already redirected, but check defensively
      Object.keys(state.safety_screen || {}).forEach(function(qid){
        // The chaptersData contains the canonical flag mapping
        if (chaptersData) {
          var safetyCh = chaptersData.chapters.find(function(c){ return c.is_safety_screen; });
          if (safetyCh) {
            var q = safetyCh.questions.find(function(qq){ return qq.q_id === qid; });
            if (q && q.options) {
              var opt = q.options.find(function(o){ return o.value === state.safety_screen[qid]; });
              if (opt && opt.flag === 'hard') safetyHardFlag = true;
            }
          }
        }
      });

      var payload = {
        seeker_code: state.seeker_code,
        first_name: firstName,
        language: 'english',
        status: 'submitted',
        consent_version: state.consent_version || 'disclaimers-v1',
        consents: {
          storage: true,
          letter_generation: true,
          no_diagnosis: true,
          supervision: true,
          whatsapp_provided: !!state.delivery_whatsapp,
          email_provided: !!state.delivery_email
        },
        chapters: state.chapters,
        chapter_version: (chaptersData && chaptersData.version) || 'kundly-qb-v1',
        safety_screen: state.safety_screen,
        safety_flagged: safetyHardFlag,
        safety_version: 'safety-screen-v1',
        submitted_at: new Date().toISOString()
      };

      // INSERT with Prefer: return=representation so PostgREST returns the
      // inserted row in one round trip. This eliminates the previous
      // INSERT-then-SELECT-via-public_spark_view race (the view filters by
      // status and could 0-row immediately after insert under load). The
      // anon role has column-level GRANT SELECT on (id, seeker_code, status,
      // spark_md, spark_generated_at, safety_flagged) per the migration —
      // PostgREST will return only those columns even with full
      // representation, satisfying RLS.
      var xhr = new XMLHttpRequest();
      xhr.open('POST', REST_URL, true);
      xhr.setRequestHeader('Content-Type', 'application/json');
      xhr.setRequestHeader('apikey', SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Authorization', 'Bearer ' + SUPABASE_ANON_KEY);
      xhr.setRequestHeader('Prefer', 'return=representation');
      xhr.timeout = 15000;

      xhr.onload = function(){
        if (xhr.status >= 200 && xhr.status < 300) {
          var rowId = null;
          try {
            var parsed = JSON.parse(xhr.responseText || '[]');
            if (Array.isArray(parsed) && parsed.length && parsed[0].id) {
              rowId = parsed[0].id;
            } else if (parsed && parsed.id) {
              rowId = parsed.id;
            }
          } catch(e){
            console.warn('Could not parse insert response', e);
          }
          // Even if parsing fails, the row exists — fall back to null and
          // let thanks.html poll by seeker_code (its primary lookup key).
          resolve(rowId);
        } else {
          reject(new Error('HTTP ' + xhr.status + ': ' + xhr.responseText.slice(0, 300)));
        }
      };
      xhr.onerror = function(){ reject(new Error('Network error')); };
      xhr.ontimeout = function(){ reject(new Error('Request timed out')); };
      xhr.send(JSON.stringify(payload));
    });
  }

  // ─── Trigger Spark generation (fire-and-forget) ───────────────────────
  function triggerSpark(seekerCode){
    try {
      fetch(SPARK_FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': 'Bearer ' + SUPABASE_ANON_KEY
        },
        body: JSON.stringify({ seeker_code: seekerCode })
      }).catch(function(err){
        // Don't surface to user — thanks.html will handle the missing-spark
        // graceful fallback path via its realtime subscription timeout.
        console.warn('Spark trigger failed (non-fatal):', err);
      });
    } catch(e){
      console.warn('Spark trigger threw (non-fatal):', e);
    }
  }

  // ─── Nav buttons ──────────────────────────────────────────────────────
  function buildNav(opts){
    var nav = h('div', { class: 'k-chapter-nav' });
    var left = h('div');
    if (opts.showPrev) {
      var prevBtn = h('button', { type: 'button', class: 'k-btn k-btn--ghost', text: '← Previous' });
      if (opts.onPrev) prevBtn.addEventListener('click', opts.onPrev);
      left.appendChild(prevBtn);
    }
    nav.appendChild(left);

    var right = h('div');
    right.style.display = 'flex';
    right.style.gap = '1rem';
    right.style.alignItems = 'center';
    if (opts.showSkip) {
      var skipBtn = h('button', { type: 'button', class: 'k-chapter-nav__skip', text: 'Skip for now' });
      if (opts.onSkip) skipBtn.addEventListener('click', opts.onSkip);
      right.appendChild(skipBtn);
    }
    var nextBtn = h('button', { type: 'button', class: 'k-btn k-btn--primary', text: opts.nextLabel || 'Continue' });
    if (opts.onNext) nextBtn.addEventListener('click', opts.onNext);
    right.appendChild(nextBtn);
    nav.appendChild(right);
    return nav;
  }

  // Start
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
