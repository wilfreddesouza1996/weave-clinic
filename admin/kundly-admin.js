/* ═══════════════════════════════════════════════════════════════════════
   Kundly Admin — Wilfred-only queue dashboard logic
   v2 (2026-04-07): refactored to call kundly-admin-proxy Edge Function
   instead of direct PostgREST. Supabase blocks secret keys in browser
   origins, so all admin queries route through a server-side proxy that
   holds service_role internally and checks a shared admin password.
   ═══════════════════════════════════════════════════════════════════════ */

(function () {
  'use strict';

  // ─── Proxy config ─────────────────────────────────────────────────
  const PROXY_URL = 'https://swnhmrljpafvaojaytkv.supabase.co/functions/v1/kundly-admin-proxy';
  const ADMIN_SECRET_KEY = 'kundly_admin_password_v2';

  // ─── Setup gate: prompt for admin password on first use ──────────
  // The password is a shared secret between this browser and the edge
  // function (INLINE_ADMIN_SECRET there). It lives in localStorage only.
  // Rotate by clearing localStorage + redeploying the function with a
  // new INLINE_ADMIN_SECRET.
  let adminPassword = null;
  try { adminPassword = localStorage.getItem(ADMIN_SECRET_KEY); } catch(e){}

  if (!adminPassword) {
    showSetupForm();
    return;
  }

  // ─── Proxy helper: all DB operations route through this ─────────
  async function callProxy(action, params = {}) {
    const res = await fetch(PROXY_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Admin-Secret': adminPassword,
      },
      body: JSON.stringify({ action, params }),
    });

    if (res.status === 401) {
      // Password is wrong or was rotated — force re-setup
      try { localStorage.removeItem(ADMIN_SECRET_KEY); } catch(e){}
      throw new Error('Admin password rejected. Please reload and re-enter.');
    }

    const json = await res.json().catch(() => ({ error: 'invalid_response' }));
    if (!res.ok || json.error) {
      throw new Error(json.error || `HTTP ${res.status}`);
    }
    return json;
  }

  // ─── Shim: mimic just enough of the Supabase-JS client interface
  // so the existing call-sites (loadQueue, loadDetail, etc.) don't need
  // to be rewritten individually. Each .from(table) returns a builder
  // that maps to a proxy action when awaited. ──────────────────────
  const supabase = {
    from(table) {
      const state = {
        table,
        op: null,            // 'select' | 'update' | 'insert'
        selectCols: null,
        filters: [],         // [{col, op, val}]
        orderBy: null,       // {col, asc}
        limitN: null,
        updatePayload: null,
        insertPayload: null,
        countMode: null,     // 'exact' if head count
        isHead: false,
      };
      const builder = {
        select(cols, opts) {
          state.op = 'select';
          state.selectCols = cols;
          if (opts && opts.count) state.countMode = opts.count;
          if (opts && opts.head) state.isHead = true;
          return builder;
        },
        update(payload) { state.op = 'update'; state.updatePayload = payload; return builder; },
        insert(payload) { state.op = 'insert'; state.insertPayload = payload; return builder; },
        eq(col, val) { state.filters.push({ col, op: 'eq', val }); return builder; },
        not(col, op, val) { state.filters.push({ col, op: 'not_' + op, val }); return builder; },
        gte(col, val) { state.filters.push({ col, op: 'gte', val }); return builder; },
        is(col, val) { state.filters.push({ col, op: 'is', val }); return builder; },
        order(col, opts) { state.orderBy = { col, asc: opts && opts.ascending }; return builder; },
        limit(n) { state.limitN = n; return builder; },
        single() { state._single = true; return builder; },
        then(resolve, reject) {
          // Route by (table, op, filters) to the appropriate proxy action
          return routeProxy(state).then(resolve, reject);
        },
      };
      return builder;
    },
  };

  // ─── Route the shim state to concrete proxy actions ──────────────
  async function routeProxy(state) {
    try {
      // === Queue listing ===
      if (state.table === 'threadwriter_seekers' && state.op === 'select' && !state._single && !state.countMode) {
        // Heuristic: if there's an eq filter on seeker_code, it's a get_seeker
        const codeFilter = state.filters.find(f => f.col === 'seeker_code' && f.op === 'eq');
        if (codeFilter) {
          const r = await callProxy('get_seeker', { seeker_code: codeFilter.val });
          if (r.seeker && Array.isArray(r.letters)) r.seeker.__letters = r.letters;
          return { data: r.seeker, error: null };
        }
        // Special-case: turnaround query (loadStats fetches submitted_at +
        // delivered_at to compute average). The proxy bundles this into
        // list_stats, so we synthesise the rows shape from the stats result.
        const isDeliveredQuery =
          state.filters.some(f => f.col === 'delivered_at' && f.op === 'not_is') &&
          state.filters.some(f => f.col === 'delivered_at' && f.op === 'gte');
        if (isDeliveredQuery) {
          const r = await callProxy('list_stats', {});
          const avgH = (r.stats && r.stats.turnaround_hours_7d) || 0;
          const n = (r.stats && r.stats.turnaround_sample_size) || 0;
          // Synthesise N identical rows so loadStats's reduce/avg lands on avgH.
          const synth = [];
          if (n > 0) {
            const now = Date.now();
            for (let i = 0; i < n; i++) {
              synth.push({
                submitted_at: new Date(now - avgH * 3600 * 1000).toISOString(),
                delivered_at: new Date(now).toISOString(),
              });
            }
          }
          return { data: synth, error: null };
        }
        // Otherwise it's a list_queue
        const sort = state.orderBy && state.orderBy.asc === true ? 'oldest' : 'newest';
        const r = await callProxy('list_queue', { sort });
        return { data: r.rows || [], error: null };
      }

      // === Single seeker lookup ===
      if (state.table === 'threadwriter_seekers' && state.op === 'select' && state._single) {
        const codeFilter = state.filters.find(f => f.col === 'seeker_code' && f.op === 'eq');
        if (codeFilter) {
          const r = await callProxy('get_seeker', { seeker_code: codeFilter.val });
          // Stash letters on the seeker so loadLetterMeta can read them without
          // a second proxy round-trip (proxy bundles them).
          if (r.seeker && Array.isArray(r.letters)) {
            r.seeker.__letters = r.letters;
          }
          return { data: r.seeker, error: null };
        }
      }

      // === Stats counts (head:true) ===
      if (state.table === 'threadwriter_seekers' && state.isHead && state.countMode === 'exact') {
        // Delegate all four stat counts in one proxy call via list_stats
        // and pick the right field based on the filter shape
        const r = await callProxy('list_stats', {});
        const s = r.stats || {};
        // Inspect filters to decide which count to return
        if (state.filters.some(f => f.col === 'submitted_at' && f.op === 'gte')) {
          return { count: s.today, data: null, error: null };
        }
        if (state.filters.some(f => f.col === 'status' && f.op === 'eq' && f.val === 'awaiting_signoff')) {
          return { count: s.awaiting_signoff, data: null, error: null };
        }
        if (state.filters.some(f => f.col === 'status' && f.op === 'eq' && f.val === 'crisis_escalated')) {
          return { count: s.crisis_escalated, data: null, error: null };
        }
        if (state.filters.some(f => f.col === 'promoted_to_pt' && f.op === 'not_is')) {
          return { count: s.converted, data: null, error: null };
        }
        // Probe call (no filters) — return 0 to let probe() succeed
        return { count: 0, data: null, error: null };
      }

      // === Status update ===
      // The transition() and decline call sites filter by `id`; the queue
      // detail fetch filters by `seeker_code`. Forward whichever was provided
      // and pass the FULL update payload (status + timestamp extras) to the
      // proxy — previously only `status` was forwarded and timestamp updates
      // were silently dropped.
      if (state.table === 'threadwriter_seekers' && state.op === 'update') {
        const codeFilter = state.filters.find(f => f.col === 'seeker_code' && f.op === 'eq');
        const idFilter = state.filters.find(f => f.col === 'id' && f.op === 'eq');
        if ((codeFilter || idFilter) && state.updatePayload && state.updatePayload.status) {
          const { status, ...extra } = state.updatePayload;
          await callProxy('update_status', {
            seeker_code: codeFilter ? codeFilter.val : undefined,
            id: idFilter ? idFilter.val : undefined,
            status,
            extra,
          });
          return { data: null, error: null };
        }
      }

      // === Pipeline events list ===
      if (state.table === 'threadwriter_pipeline_events' && state.op === 'select') {
        const limit = state.limitN || 50;
        const r = await callProxy('list_events', { limit });
        return { data: r.events || [], error: null };
      }

      // === Pipeline event insert (decline notes, manual audit entries) ===
      if (state.table === 'threadwriter_pipeline_events' && state.op === 'insert') {
        const p = state.insertPayload || {};
        await callProxy('insert_event', {
          seeker_id: p.seeker_id,
          from_status: p.from_status ?? null,
          to_status: p.to_status,
          actor: p.actor,
          notes: p.notes ?? null,
        });
        return { data: null, error: null };
      }

      // === Letters table (for loadLetterMeta) ===
      if (state.table === 'threadwriter_letters' && state.op === 'select') {
        // Letters are bundled with get_seeker (stashed on currentSeeker.__letters).
        // loadLetterMeta reads them from there now; this path is a defensive no-op.
        return { data: [], error: null };
      }

      // Unrecognized pattern
      return { data: null, error: { message: `Unrouted proxy shim call: ${state.table}.${state.op}` } };
    } catch (e) {
      return { data: null, error: { message: e.message } };
    }
  }

  // ─── First-run setup form (admin password only, no Supabase key) ──
  function showSetupForm() {
    const main = document.querySelector('.admin-main') || document.body;
    main.innerHTML = '';
    const wrap = document.createElement('div');
    wrap.style.maxWidth = '560px';
    wrap.style.margin = '4rem auto';
    wrap.style.padding = '2.5rem 2rem';
    wrap.style.background = '#fff';
    wrap.style.border = '1px solid #e8ded2';
    wrap.style.borderRadius = '8px';
    wrap.style.fontFamily = 'Inter, -apple-system, sans-serif';

    const h = document.createElement('h2');
    h.textContent = 'Kundly admin — first-time setup';
    h.style.marginTop = '0';
    h.style.fontFamily = 'Source Serif 4, Georgia, serif';
    h.style.fontWeight = '500';
    h.style.fontSize = '1.5rem';
    h.style.color = '#3a2e26';
    wrap.appendChild(h);

    const p1 = document.createElement('p');
    p1.style.color = '#5a4a3f';
    p1.style.lineHeight = '1.65';
    p1.style.fontSize = '0.9375rem';
    p1.textContent = 'This page needs a shared admin password to read the seeker queue. The password is stored only in this browser (localStorage) — it is never written to any file you could accidentally commit. It gates access to a server-side proxy that holds the Supabase service_role key internally, so your secret key never touches the browser.';
    wrap.appendChild(p1);

    const p2 = document.createElement('p');
    p2.style.color = '#8a7a6f';
    p2.style.fontSize = '0.8125rem';
    p2.style.lineHeight = '1.55';
    p2.textContent = 'Get the password from wherever Wilfred kept it — it was generated when the kundly-admin-proxy Edge Function was deployed. It starts with "kadm_" and is a random token. To rotate, redeploy the proxy function with a new INLINE_ADMIN_SECRET and clear localStorage here.';
    wrap.appendChild(p2);

    const label = document.createElement('label');
    label.textContent = 'Admin password';
    label.style.display = 'block';
    label.style.marginTop = '1.5rem';
    label.style.marginBottom = '0.5rem';
    label.style.fontSize = '0.875rem';
    label.style.fontWeight = '500';
    label.style.color = '#3a2e26';
    wrap.appendChild(label);

    const input = document.createElement('input');
    input.type = 'password';
    input.placeholder = 'kadm_...';
    input.style.width = '100%';
    input.style.padding = '0.875rem 1rem';
    input.style.fontSize = '0.875rem';
    input.style.fontFamily = 'monospace';
    input.style.border = '1px solid #e8ded2';
    input.style.borderRadius = '6px';
    input.style.boxSizing = 'border-box';
    wrap.appendChild(input);

    const btn = document.createElement('button');
    btn.textContent = 'Save and connect';
    btn.style.marginTop = '1.25rem';
    btn.style.padding = '0.875rem 1.5rem';
    btn.style.background = '#C75B39';
    btn.style.color = '#fff';
    btn.style.border = 'none';
    btn.style.borderRadius = '6px';
    btn.style.fontSize = '0.9375rem';
    btn.style.fontWeight = '500';
    btn.style.cursor = 'pointer';
    btn.style.fontFamily = 'inherit';
    btn.addEventListener('click', async () => {
      const k = input.value.trim();
      if (!k || k.length < 10) {
        alert('Please paste the admin password. It should be at least 10 characters long.');
        return;
      }
      // Verify the password by pinging the proxy before saving
      btn.disabled = true;
      btn.textContent = 'Verifying…';
      try {
        const res = await fetch(PROXY_URL, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'X-Admin-Secret': k },
          body: JSON.stringify({ action: 'ping' }),
        });
        if (res.status === 401) {
          alert('That password was rejected by the server. Double-check it and try again.');
          btn.disabled = false;
          btn.textContent = 'Save and connect';
          return;
        }
        if (!res.ok) {
          alert('Server error while verifying. HTTP ' + res.status);
          btn.disabled = false;
          btn.textContent = 'Save and connect';
          return;
        }
        localStorage.setItem(ADMIN_SECRET_KEY, k);
        window.location.reload();
      } catch (e) {
        alert('Network error verifying password: ' + e.message);
        btn.disabled = false;
        btn.textContent = 'Save and connect';
      }
    });
    wrap.appendChild(btn);

    const note = document.createElement('p');
    note.style.marginTop = '1.5rem';
    note.style.fontSize = '0.75rem';
    note.style.color = '#8a7a6f';
    note.style.fontStyle = 'italic';
    note.textContent = 'This password grants full read/write on the Kundly seeker data via a server-side proxy. The proxy gates access and holds the Supabase service_role key internally. Do not share this password or leave it loaded on a shared device.';
    wrap.appendChild(note);

    main.appendChild(wrap);
  }

  let currentSeeker = null;
  let currentSort = 'newest';

  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => document.querySelectorAll(sel);

  // ─── Routing ──────────────────────────────────────────────────────
  function route() {
    const hash = window.location.hash || '#queue';
    if (hash.startsWith('#sk/')) {
      const code = hash.replace('#sk/', '');
      showView('detail');
      loadDetail(code);
    } else if (hash === '#events') {
      showView('events');
      setActiveTab('events');
      loadEvents();
    } else {
      showView('queue');
      setActiveTab('queue');
      loadQueue();
      loadStats();
    }
  }

  function showView(name) {
    $$('.view').forEach((v) => v.classList.remove('is-active'));
    const el = $('#view-' + name);
    if (el) el.classList.add('is-active');
  }

  function setActiveTab(name) {
    $$('.admin-tab').forEach((t) => {
      t.classList.toggle('is-active', t.dataset.view === name);
    });
  }

  $$('.admin-tab').forEach((tab) => {
    tab.addEventListener('click', () => setActiveTab(tab.dataset.view));
  });

  $('#backToQueue').addEventListener('click', () => {
    window.location.hash = '#queue';
  });

  $('#refreshBtn').addEventListener('click', () => {
    loadQueue();
    loadStats();
  });

  $('#sortSelect').addEventListener('change', (e) => {
    currentSort = e.target.value;
    loadQueue();
  });

  window.addEventListener('hashchange', route);

  // ─── Connection probe ─────────────────────────────────────────────
  // v2: pings the proxy directly with the admin secret. The previous v1
  // shape (testing service_role via direct PostgREST) is gone.
  async function probe() {
    try {
      await callProxy('ping');
      setConn('ok', 'connected');
    } catch (e) {
      setConn('err', 'auth fail');
      showBanner('Admin proxy connection failed: ' + e.message);
    }
  }

  function setConn(state, label) {
    const pill = $('#connStatus');
    pill.className = 'conn-pill conn-pill--' + state;
    pill.textContent = label;
  }

  // ─── Stats ────────────────────────────────────────────────────────
  async function loadStats() {
    try {
      const since = new Date();
      since.setHours(0, 0, 0, 0);
      const { count: todayCount } = await supabase
        .from('threadwriter_seekers')
        .select('id', { count: 'exact', head: true })
        .gte('submitted_at', since.toISOString());
      $('#statToday').textContent = todayCount ?? 0;

      const { count: signoffCount } = await supabase
        .from('threadwriter_seekers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'awaiting_signoff');
      $('#statSignoff').textContent = signoffCount ?? 0;

      const { count: crisisCount } = await supabase
        .from('threadwriter_seekers')
        .select('id', { count: 'exact', head: true })
        .eq('status', 'crisis_escalated');
      $('#statCrisis').textContent = crisisCount ?? 0;
      if ((crisisCount ?? 0) > 0) {
        document.querySelector('.stat-card--alert').classList.add('has-alert');
      }

      const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const { data: turnaroundRows } = await supabase
        .from('threadwriter_seekers')
        .select('submitted_at, delivered_at')
        .not('delivered_at', 'is', null)
        .gte('delivered_at', sevenDaysAgo);

      const turnaroundEl = $('#statTurnaround');
      turnaroundEl.textContent = '';
      const valSpan = document.createElement('span');
      const unitSpan = document.createElement('span');
      unitSpan.className = 'stat-card__unit';
      unitSpan.textContent = 'h';
      if (turnaroundRows && turnaroundRows.length) {
        const totalH = turnaroundRows.reduce((acc, r) => {
          const dt = new Date(r.delivered_at) - new Date(r.submitted_at);
          return acc + dt / (1000 * 60 * 60);
        }, 0);
        valSpan.textContent = (totalH / turnaroundRows.length).toFixed(1);
      } else {
        valSpan.textContent = '0';
      }
      turnaroundEl.appendChild(valSpan);
      turnaroundEl.appendChild(unitSpan);

      const { count: convertedCount } = await supabase
        .from('threadwriter_seekers')
        .select('id', { count: 'exact', head: true })
        .not('promoted_to_pt', 'is', null);
      $('#statConverted').textContent = convertedCount ?? 0;
    } catch (e) {
      console.error('stats error', e);
    }
  }

  // ─── Queue ────────────────────────────────────────────────────────
  async function loadQueue() {
    const stateEl = $('#queueState');
    const wrap = $('#queueTableWrap');
    stateEl.className = 'state state--loading';
    stateEl.textContent = 'Loading queue…';
    stateEl.style.display = '';
    wrap.hidden = true;

    try {
      const { data, error } = await supabase
        .from('threadwriter_seekers')
        .select('id, seeker_code, first_name, status, submitted_at, safety_flagged')
        .not('status', 'in', '(delivered,declined_gently,withdrawn)')
        .order('submitted_at', { ascending: currentSort === 'oldest', nullsFirst: false })
        .limit(200);

      if (error) throw error;

      if (!data || data.length === 0) {
        stateEl.className = 'state state--empty';
        stateEl.textContent = 'No seekers in queue. Empty queue is a good queue.';
        return;
      }

      const tbody = $('#queueBody');
      tbody.textContent = '';

      for (const row of data) {
        const tr = document.createElement('tr');
        if (row.status === 'awaiting_signoff') tr.classList.add('row--awaiting');
        if (row.status === 'crisis_escalated') tr.classList.add('row--crisis');

        const submitted = row.submitted_at ? new Date(row.submitted_at) : null;

        appendCell(tr, 'col-code', row.seeker_code || '—');
        appendCell(tr, '', row.first_name || '—');
        appendCell(tr, 'col-time', submitted ? relTime(submitted) : '—');

        const tdStatus = document.createElement('td');
        tdStatus.appendChild(buildStatusChip(row.status));
        tr.appendChild(tdStatus);

        const tdFlag = document.createElement('td');
        const flagNode = buildFlagCell(row);
        if (flagNode) tdFlag.appendChild(flagNode);
        tr.appendChild(tdFlag);

        appendCell(tr, 'col-time', submitted ? businessHours(submitted) + 'h' : '—');

        const tdAct = document.createElement('td');
        const openBtn = document.createElement('button');
        openBtn.className = 'btn btn--ghost btn--small';
        openBtn.textContent = 'Open';
        openBtn.addEventListener('click', () => {
          window.location.hash = '#sk/' + row.seeker_code;
        });
        tdAct.appendChild(openBtn);
        tr.appendChild(tdAct);

        tbody.appendChild(tr);
      }

      stateEl.style.display = 'none';
      wrap.hidden = false;
    } catch (e) {
      console.error('queue error', e);
      stateEl.className = 'state state--err';
      stateEl.textContent = 'Failed to load queue: ' + e.message;
    }
  }

  function appendCell(tr, cls, text) {
    const td = document.createElement('td');
    if (cls) td.className = cls;
    td.textContent = text;
    tr.appendChild(td);
  }

  // ─── Detail ───────────────────────────────────────────────────────
  async function loadDetail(code) {
    const stateEl = $('#detailState');
    const layout = $('#detailLayout');
    stateEl.className = 'state state--loading';
    stateEl.textContent = 'Loading ' + code + '…';
    stateEl.style.display = '';
    layout.hidden = true;

    try {
      const { data, error } = await supabase
        .from('threadwriter_seekers')
        .select('*')
        .eq('seeker_code', code)
        .single();

      if (error) throw error;
      if (!data) {
        stateEl.className = 'state state--err';
        stateEl.textContent = 'Seeker ' + code + ' not found.';
        return;
      }

      currentSeeker = data;
      renderDetail(data);
      stateEl.style.display = 'none';
      layout.hidden = false;
    } catch (e) {
      console.error('detail error', e);
      stateEl.className = 'state state--err';
      stateEl.textContent = 'Failed to load: ' + e.message;
    }
  }

  function renderDetail(s) {
    $('#detailCode').textContent = s.seeker_code;
    const statusEl = $('#detailStatus');
    statusEl.className = 'status-chip status-chip--' + s.status;
    statusEl.textContent = humanStatus(s.status);

    const flag = $('#detailFlag');
    if (s.status === 'crisis_escalated') {
      flag.hidden = false;
      flag.className = 'flag-pill flag-pill--crisis';
      flag.textContent = 'crisis escalated';
    } else if (s.safety_flagged) {
      flag.hidden = false;
      flag.className = 'flag-pill';
      flag.textContent = 'safety flagged';
    } else {
      flag.hidden = true;
    }

    // Meta grid
    const meta = $('#detailMeta');
    meta.textContent = '';
    const metaItems = [
      ['First name', s.first_name],
      ['Language', s.language],
      ['Submitted', s.submitted_at ? new Date(s.submitted_at).toLocaleString() : '—'],
      ['Picked up', s.picked_up_at ? new Date(s.picked_up_at).toLocaleString() : '—'],
      ['Letter generated', s.letter_generated_at ? new Date(s.letter_generated_at).toLocaleString() : '—'],
      ['Signed off', s.signed_off_at ? new Date(s.signed_off_at).toLocaleString() : '—'],
      ['Delivered', s.delivered_at ? new Date(s.delivered_at).toLocaleString() : '—'],
      ['Promoted to', s.promoted_to_pt || '—']
    ];
    for (const [k, v] of metaItems) {
      const span = document.createElement('span');
      const strong = document.createElement('strong');
      strong.textContent = k;
      span.appendChild(strong);
      span.appendChild(document.createTextNode(String(v ?? '—')));
      meta.appendChild(span);
    }

    // Consent
    const consents = s.consents || {};
    const consentEl = $('#detailConsent');
    consentEl.textContent = '';
    consentEl.appendChild(buildKvRow('Version', s.consent_version || '—'));
    if (Object.keys(consents).length === 0) {
      consentEl.appendChild(buildKvRow('(no consents recorded)', ''));
    } else {
      for (const [k, v] of Object.entries(consents)) {
        consentEl.appendChild(buildKvRow(k, v === true ? '✓ ticked' : String(v)));
      }
    }

    // Safety
    const safety = s.safety_screen || {};
    const safetyEl = $('#detailSafety');
    safetyEl.textContent = '';
    safetyEl.appendChild(buildKvRow('Version', s.safety_version || '—'));
    safetyEl.appendChild(buildKvRow('Flagged', s.safety_flagged ? 'YES' : 'no'));
    if (Object.keys(safety).length === 0) {
      safetyEl.appendChild(buildKvRow('(no safety screen data)', ''));
    } else {
      for (const [k, v] of Object.entries(safety)) {
        safetyEl.appendChild(buildKvRow(k, typeof v === 'object' ? JSON.stringify(v) : String(v)));
      }
    }

    // Chapters
    const chaptersEl = $('#detailChapters');
    chaptersEl.textContent = '';
    const chapters = s.chapters || {};
    const chapterKeys = Object.keys(chapters).sort();
    if (chapterKeys.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'chapter__empty';
      empty.textContent = 'No chapter content recorded.';
      chaptersEl.appendChild(empty);
    } else {
      for (const ck of chapterKeys) {
        const ch = document.createElement('div');
        ch.className = 'chapter';
        const title = document.createElement('div');
        title.className = 'chapter__title';
        title.textContent = ck.replace(/_/g, ' ');
        ch.appendChild(title);

        const qa = chapters[ck] || {};
        if (typeof qa === 'string') {
          const blk = document.createElement('blockquote');
          blk.className = 'chapter__a';
          blk.textContent = qa;
          ch.appendChild(blk);
        } else {
          for (const [qid, ans] of Object.entries(qa)) {
            const wrap = document.createElement('div');
            wrap.className = 'chapter__qa';
            const q = document.createElement('div');
            q.className = 'chapter__q';
            q.textContent = qid;
            const a = document.createElement('blockquote');
            a.className = 'chapter__a';
            a.textContent = ans || '(left blank)';
            wrap.appendChild(q);
            wrap.appendChild(a);
            ch.appendChild(wrap);
          }
        }
        chaptersEl.appendChild(ch);
      }
    }

    // Spark
    if (s.spark_md) {
      $('#sparkSection').hidden = false;
      $('#detailSpark').textContent = s.spark_md;
    } else {
      $('#sparkSection').hidden = true;
    }

    loadLetterMeta(s.id);
    renderActions(s);
  }

  async function loadLetterMeta(seekerId) {
    try {
      // Letters are bundled with the seeker fetch by the proxy and stashed
      // on currentSeeker.__letters (sorted version DESC). Read from there
      // instead of issuing a separate proxy round-trip.
      const data = (currentSeeker && Array.isArray(currentSeeker.__letters))
        ? currentSeeker.__letters
        : [];
      const sec = $('#letterSection');
      const el = $('#detailLetter');
      el.textContent = '';
      if (data && data.length) {
        const l = data[0];
        sec.hidden = false;
        const rows = [
          ['Version', 'v' + l.version],
          ['PDF path', l.pdf_path || '—'],
          ['Markdown path', l.md_path || '—'],
          ['Loupe passed', l.loupe_passed === null ? '—' : l.loupe_passed ? 'yes' : 'no'],
          ['Signed off at', l.signed_off_at ? new Date(l.signed_off_at).toLocaleString() : '—'],
          ['Delivered via', l.delivered_via || '—']
        ];
        for (const [k, v] of rows) {
          const row = document.createElement('div');
          row.className = 'letter-card__row';
          const strong = document.createElement('strong');
          strong.textContent = k;
          const span = document.createElement('span');
          span.textContent = String(v);
          row.appendChild(strong);
          row.appendChild(span);
          el.appendChild(row);
        }
      } else {
        sec.hidden = true;
      }
    } catch (e) {
      console.warn('letter meta', e);
      const sec2 = document.querySelector('#letterSection');
      if (sec2) sec2.hidden = true;
    }
  }

  function renderActions(s) {
    const panel = $('#actionPanel');
    const hint = $('#commandHint');
    hint.hidden = true;
    panel.textContent = '';

    const buttons = [];

    if (s.status === 'submitted') {
      buttons.push({
        label: 'Pick up',
        cls: 'btn',
        onClick: async () => {
          await transition(s, 'picked_up', { picked_up_at: new Date().toISOString() });
          showCommand('python3 ~/.claude/skills/kundly/scripts/ingest-seeker.py ' + s.seeker_code);
        }
      });
    }

    if (['picked_up', 'warp_drafting', 'weave_running', 'letter_drafted', 'loupe_passed'].includes(s.status)) {
      buttons.push({
        label: 'Mark awaiting sign-off',
        cls: 'btn btn--gold',
        onClick: () => transition(s, 'awaiting_signoff', { letter_generated_at: new Date().toISOString() })
      });
    }

    if (s.status === 'awaiting_signoff') {
      buttons.push({
        label: 'Sign off',
        cls: 'btn btn--success',
        onClick: () => transition(s, 'signed_off', { signed_off_at: new Date().toISOString() })
      });
    }

    if (s.status === 'signed_off') {
      buttons.push({
        label: 'Mark delivered',
        cls: 'btn btn--success',
        onClick: () => transition(s, 'delivered', { delivered_at: new Date().toISOString() })
      });
    }

    buttons.push({
      label: 'Decline gently',
      cls: 'btn btn--danger',
      onClick: () => openDeclineModal(s)
    });

    for (const b of buttons) {
      const btn = document.createElement('button');
      btn.className = b.cls;
      btn.textContent = b.label;
      btn.addEventListener('click', b.onClick);
      panel.appendChild(btn);
    }

    const hintNote = document.createElement('div');
    hintNote.className = 'action-panel__hint';
    hintNote.textContent = 'Status changes write to threadwriter_pipeline_events automatically.';
    panel.appendChild(hintNote);
  }

  async function transition(s, newStatus, extra) {
    try {
      const patch = Object.assign({ status: newStatus }, extra || {});
      const { error } = await supabase
        .from('threadwriter_seekers')
        .update(patch)
        .eq('id', s.id);
      if (error) throw error;
      await loadDetail(s.seeker_code);
    } catch (e) {
      alert('Status update failed: ' + e.message);
    }
  }

  function showCommand(cmd) {
    $('#commandHintCode').textContent = cmd;
    $('#commandHint').hidden = false;
  }

  $('#copyCmd').addEventListener('click', () => {
    const txt = $('#commandHintCode').textContent;
    navigator.clipboard.writeText(txt).then(() => {
      $('#copyCmd').textContent = 'Copied';
      setTimeout(() => ($('#copyCmd').textContent = 'Copy'), 1500);
    });
  });

  // ─── Decline modal ────────────────────────────────────────────────
  function openDeclineModal(s) {
    $('#declineReason').value = '';
    $('#declineModal').hidden = false;
    $('#declineModal').dataset.seekerId = s.id;
    $('#declineModal').dataset.seekerCode = s.seeker_code;
  }

  $$('[data-close]').forEach((el) =>
    el.addEventListener('click', () => ($('#declineModal').hidden = true))
  );

  $('#confirmDecline').addEventListener('click', async () => {
    const modal = $('#declineModal');
    const reason = $('#declineReason').value.trim();
    if (!reason) {
      alert('Please write a short reason.');
      return;
    }
    try {
      const id = modal.dataset.seekerId;
      const { error } = await supabase
        .from('threadwriter_seekers')
        .update({ status: 'declined_gently' })
        .eq('id', id);
      if (error) throw error;

      await supabase.from('threadwriter_pipeline_events').insert({
        seeker_id: id,
        from_status: currentSeeker ? currentSeeker.status : null,
        to_status: 'declined_gently',
        actor: 'wilfred',
        notes: reason
      });

      modal.hidden = true;
      await loadDetail(modal.dataset.seekerCode);
    } catch (e) {
      alert('Decline failed: ' + e.message);
    }
  });

  // ─── Pipeline events view ─────────────────────────────────────────
  async function loadEvents() {
    const stateEl = $('#eventsState');
    const wrap = $('#eventsTableWrap');
    stateEl.className = 'state state--loading';
    stateEl.textContent = 'Loading events…';
    stateEl.style.display = '';
    wrap.hidden = true;

    try {
      const { data, error } = await supabase
        .from('threadwriter_pipeline_events')
        .select('id, created_at, from_status, to_status, actor, notes, seeker_id, threadwriter_seekers(seeker_code)')
        .order('created_at', { ascending: false })
        .limit(50);
      if (error) throw error;

      const tbody = $('#eventsBody');
      tbody.textContent = '';

      if (!data || !data.length) {
        stateEl.className = 'state state--empty';
        stateEl.textContent = 'No pipeline events yet.';
        return;
      }

      for (const ev of data) {
        const code = (ev.threadwriter_seekers && ev.threadwriter_seekers.seeker_code) || '—';
        const tr = document.createElement('tr');

        appendCell(tr, 'col-time', new Date(ev.created_at).toLocaleString());
        appendCell(tr, 'col-code', code);

        const tdTrans = document.createElement('td');
        tdTrans.appendChild(buildStatusChip(ev.from_status));
        tdTrans.appendChild(document.createTextNode(' → '));
        tdTrans.appendChild(buildStatusChip(ev.to_status));
        tr.appendChild(tdTrans);

        appendCell(tr, '', ev.actor || '—');
        appendCell(tr, '', ev.notes || '');

        tbody.appendChild(tr);
      }

      stateEl.style.display = 'none';
      wrap.hidden = false;
    } catch (e) {
      console.error('events error', e);
      stateEl.className = 'state state--err';
      stateEl.textContent = 'Failed to load events: ' + e.message;
    }
  }

  // ─── Builders ─────────────────────────────────────────────────────
  function buildStatusChip(status) {
    const span = document.createElement('span');
    if (!status) {
      span.className = 'status-chip';
      span.textContent = '—';
      return span;
    }
    span.className = 'status-chip status-chip--' + status;
    span.textContent = humanStatus(status);
    return span;
  }

  function buildFlagCell(row) {
    if (row.status === 'crisis_escalated') {
      const s = document.createElement('span');
      s.className = 'flag-icon flag-icon--crisis';
      s.title = 'Crisis escalated';
      s.textContent = '●';
      return s;
    }
    if (row.safety_flagged) {
      const s = document.createElement('span');
      s.className = 'flag-icon flag-icon--warn';
      s.title = 'Safety flagged';
      s.textContent = '▲';
      return s;
    }
    return null;
  }

  function buildKvRow(k, v) {
    const row = document.createElement('div');
    row.className = 'kv-row';
    const kEl = document.createElement('div');
    kEl.className = 'kv-row__k';
    kEl.textContent = k;
    const vEl = document.createElement('div');
    vEl.className = 'kv-row__v';
    vEl.textContent = String(v ?? '');
    row.appendChild(kEl);
    row.appendChild(vEl);
    return row;
  }

  // ─── Helpers ──────────────────────────────────────────────────────
  function relTime(d) {
    const diff = (Date.now() - d.getTime()) / 1000;
    if (diff < 60) return Math.floor(diff) + 's ago';
    if (diff < 3600) return Math.floor(diff / 60) + 'm ago';
    if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
    if (diff < 86400 * 7) return Math.floor(diff / 86400) + 'd ago';
    return d.toLocaleDateString();
  }

  function businessHours(start) {
    // Sample business-hour calc: counts only Mon-Fri 09:00-18:00, capped at 96.
    const end = new Date();
    const totalDaysSpan = (end - start) / (1000 * 60 * 60 * 24);
    if (totalDaysSpan > 14) return 96;
    let total = 0;
    const cur = new Date(start);
    while (cur < end && total < 96) {
      const day = cur.getDay();
      const hr = cur.getHours();
      if (day >= 1 && day <= 5 && hr >= 9 && hr < 18) total += 1;
      cur.setHours(cur.getHours() + 1);
    }
    return Math.min(96, total);
  }

  function humanStatus(status) {
    return (status || '').replace(/_/g, ' ');
  }

  function showFatal(msg) {
    const wrap = document.createElement('div');
    wrap.style.cssText = 'padding:3rem;font-family:Inter,sans-serif;color:#B0392B;';
    const h = document.createElement('h1');
    h.textContent = 'Kundly admin failed to start';
    const p = document.createElement('p');
    p.textContent = msg;
    wrap.appendChild(h);
    wrap.appendChild(p);
    document.body.textContent = '';
    document.body.appendChild(wrap);
  }

  function showBanner(text) {
    const b = document.createElement('div');
    b.style.cssText =
      'background:#F7E6BA;color:#8a6418;padding:0.75rem 1.25rem;border-bottom:1px solid #C28A2A;font-size:13px;text-align:center;';
    b.textContent = text;
    document.body.insertBefore(b, document.body.firstChild);
  }

  // ─── Boot ─────────────────────────────────────────────────────────
  probe();
  route();
})();
