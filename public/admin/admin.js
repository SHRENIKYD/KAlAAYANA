/* Content admin. Edits sections and projects in memory, then saves everything
   in one request; the Worker commits it and opens a pull request. */
(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const el = (tag, attrs = {}, ...children) => {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(attrs)) {
      if (k === 'class') node.className = v;
      else if (k.startsWith('on')) node.addEventListener(k.slice(2), v);
      else if (v !== undefined && v !== null) node.setAttribute(k, v);
    }
    for (const c of children.flat()) if (c !== null && c !== undefined) node.append(c);
    return node;
  };

  const state = {
    email: '',
    base: '',
    projects: [],
    sections: {},
    projectFiles: new Set(),
    bannerFiles: new Set(),
    uploads: {},
    banners: {},
    bannerCopies: {},
    previews: {},
    current: null,
    openWork: null,
    editing: null,
    demo: false,
    pending: null,
    tab: 'projects',
    view: 'section',
    dirty: false,
    original: '',
  };
  const snapshot = () =>
    JSON.stringify({
      p: state.projects,
      s: state.sections,
      h: state.home,
      u: Object.keys(state.uploads),
      b: Object.keys(state.banners),
      c: state.bannerCopies,
    });
  const slugify = (s) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  // A work's name is what the homepage calls it; the section page has its own
  // headline. Lists in the admin use the name.
  const workName = (key) =>
    (state.home?.works || []).find((w) => w.section === key)?.title ||
    state.sections[key]?.title ||
    key;
  const imageUrl = (kind, file) => state.previews[file] || `/admin/api/image/${kind}/${file}`;
  // A photograph that shimmers until its bytes arrive, and is only fetched
  // when it is near the screen.
  const pic = (src, attrs = {}) => {
    const img = el('img', { src, alt: '', loading: 'lazy', decoding: 'async', ...attrs });
    img.classList.add('pic');
    const done = () => img.classList.add('loaded');
    img.addEventListener('load', done, { once: true });
    img.addEventListener('error', done, { once: true });
    if (img.complete && img.naturalWidth) done();
    return img;
  };

  // Who is using the account this session. Kept for the hour in this tab.
  const sessionName = () => {
    try {
      return sessionStorage.getItem('admin-name') || '';
    } catch {
      return '';
    }
  };
  // Every request in flight shows the progress line under the header.
  let inflight = 0;
  function busy(delta) {
    inflight = Math.max(0, inflight + delta);
    document.body.classList.toggle('busy', inflight > 0);
    document.body.setAttribute('aria-busy', inflight > 0 ? 'true' : 'false');
  }
  async function api(path, init) {
    busy(1);
    let res;
    try {
      res = await fetch(`/admin/api${path}`, {
        ...init,
        headers: {
          'content-type': 'application/json',
          ...(sessionName() ? { 'x-admin-name': sessionName() } : {}),
          ...(init?.headers || {}),
        },
      });
    } finally {
      busy(-1);
    }
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok) {
      if (res.status === 401 && !path.startsWith('/login') && !path.startsWith('/content')) {
        showSignIn({ demo: data.demo, status: 401, expired: true, email: data.email });
      }
      throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {
        status: res.status,
        problems: data.problems,
        demo: data.demo,
        email: data.email,
        expired: Boolean(data.expired),
      });
    }
    return data;
  }

  const readFile = (file) =>
    new Promise((resolve, reject) => {
      const r = new FileReader();
      r.onload = () => resolve(r.result.split(',')[1]);
      r.onerror = reject;
      r.readAsDataURL(file);
    });

  function markDirty() {
    state.dirty = snapshot() !== state.original;
    const bar = $('#savebar');
    bar.hidden = !state.dirty;
    const n = Object.keys(state.uploads).length + Object.keys(state.banners).length;
    $('#pending-summary').textContent = state.dirty
      ? `Unsaved changes${n ? ` · ${n} new image${n > 1 ? 's' : ''}` : ''}`
      : '';
    renderSections();
  }

  /* ---------- drop-downs ----------
     Browsers draw a <select>'s open list themselves, in the system's colours,
     and most will not let a page style it. So every select in the admin keeps
     its native element for value and change events, hidden, and gets a button
     and a list of the admin's own next to it. */
  function enhanceSelect(sel) {
    if (sel.dataset.dd) return;
    sel.dataset.dd = '1';
    const wrap = el('div', { class: 'dd' });
    const btn = el('button', {
      type: 'button',
      class: 'dd-btn',
      'aria-haspopup': 'listbox',
      'aria-expanded': 'false',
    });
    const list = el('ul', { class: 'dd-list', role: 'listbox', hidden: '', tabindex: '-1' });
    const items = () => [...list.children];
    const close = () => {
      list.hidden = true;
      btn.setAttribute('aria-expanded', 'false');
    };
    const choose = (i) => {
      if (sel.selectedIndex !== i) {
        sel.selectedIndex = i;
        sel.dispatchEvent(new Event('change', { bubbles: true }));
      }
      render();
      close();
      btn.focus();
    };
    const render = () => {
      const current = sel.options[sel.selectedIndex];
      btn.replaceChildren(
        el('span', { class: 'dd-text' }, current ? current.text : ''),
        el('i', { class: 'dd-chev', 'aria-hidden': 'true' }),
      );
      btn.disabled = sel.disabled;
      list.replaceChildren(
        ...[...sel.options].map((o, i) =>
          el(
            'li',
            {
              role: 'option',
              'aria-selected': String(o.selected),
              tabindex: '-1',
              onclick: () => choose(i),
            },
            o.text,
          ),
        ),
      );
    };
    const open = () => {
      render();
      list.hidden = false;
      btn.setAttribute('aria-expanded', 'true');
      const cur = items()[sel.selectedIndex] || items()[0];
      if (cur) cur.focus();
    };
    btn.addEventListener('click', () => (list.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp' || e.key === ' ' || e.key === 'Enter') {
        e.preventDefault();
        open();
      }
    });
    list.addEventListener('keydown', (e) => {
      const all = items();
      const at = all.indexOf(document.activeElement);
      if (e.key === 'ArrowDown') all[Math.min(all.length - 1, at + 1)]?.focus();
      else if (e.key === 'ArrowUp') all[Math.max(0, at - 1)]?.focus();
      else if (e.key === 'Enter' || e.key === ' ') choose(Math.max(0, at));
      else if (e.key === 'Escape' || e.key === 'Tab') {
        close();
        btn.focus();
      } else return;
      e.preventDefault();
    });
    document.addEventListener('pointerdown', (e) => {
      if (!wrap.contains(e.target)) close();
    });
    sel.addEventListener('change', render);
    new MutationObserver(render).observe(sel, { attributes: true, childList: true, subtree: true });
    sel.classList.add('dd-native');
    sel.tabIndex = -1;
    sel.insertAdjacentElement('afterend', wrap);
    wrap.append(btn, list);
    render();
  }
  new MutationObserver(() => {
    document.querySelectorAll('select:not([data-dd])').forEach(enhanceSelect);
  }).observe(document.body, { childList: true, subtree: true });
  document.querySelectorAll('select:not([data-dd])').forEach(enhanceSelect);

  /* ---------- times ----------
     Every time the admin shows is the studio's local time (UTC+05:30), in
     12-hour form: "6 Nov 2026, 1:23 pm". Stored times stay in UTC. */
  const STUDIO_TZ = 'Asia/Kolkata';
  const STUDIO_OFFSET = '+05:30';
  const whenFmt = new Intl.DateTimeFormat('en-IN', {
    timeZone: STUDIO_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
  });
  const whenFmtSec = new Intl.DateTimeFormat('en-IN', {
    timeZone: STUDIO_TZ,
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    second: '2-digit',
    hour12: true,
  });
  function when(iso, seconds = false) {
    if (!iso) return '';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return String(iso);
    return (seconds ? whenFmtSec : whenFmt)
      .format(d)
      .replace(/\s*(am|pm)$/i, (m) => ` ${m.trim().toLowerCase()}`);
  }

  /* ---------- tabs ----------
     The tab, and the open work on the Projects tab, live in the address
     (#projects/murals), so a refresh or the back button lands where you were. */
  const TABS = ['home', 'projects', 'insights', 'log', 'users'];
  function readPlace() {
    const [tab, key] = location.hash.replace(/^#/, '').split('/');
    if (TABS.includes(tab)) state.tab = tab;
    if (tab === 'projects' && key) state.current = decodeURIComponent(key);
  }
  function writePlace() {
    const hash =
      state.tab === 'projects' && state.current
        ? `#projects/${encodeURIComponent(state.current)}`
        : `#${state.tab}`;
    if (location.hash !== hash) history.replaceState(null, '', hash);
  }
  function showTab(tab) {
    state.tab = tab;
    for (const t of TABS) {
      document.body.classList.toggle(`tab-${t}`, tab === t);
      $(`#tab-${t}`).setAttribute('aria-current', tab === t ? 'page' : 'false');
    }
    if (tab === 'home') editHome();
    else if (tab === 'log') showLog();
    else if (tab === 'users') showUsers();
    else if (tab === 'insights') showInsights();
    else
      openSection(
        state.current && state.sections[state.current]
          ? state.current
          : Object.keys(state.sections)[0],
      );
    writePlace();
  }

  /* ---------- insights (everyone) ---------- */
  let insightsResizeBound = false;
  async function showInsights(days) {
    state.view = 'insights';
    state.insightDays = days || state.insightDays || 7;
    renderInsights();
    const want = state.insightDays;
    if (state.insights?.days === want && Date.now() - (state.insightsAt || 0) < 120000) return;
    if (state.insights) renderInsights();
    try {
      const data = await api(`/insights?days=${want}`);
      if (state.insightDays !== want) return;
      state.insights = data;
      state.insightsError = '';
      state.insightsUnconfigured = false;
      state.insightsAt = Date.now();
    } catch (e) {
      state.insights = null;
      state.insightsError = e.message;
      state.insightsUnconfigured = Boolean(e.status === 503);
    }
    if (state.view === 'insights') renderInsights();
    if (!insightsResizeBound) {
      insightsResizeBound = true;
      let t;
      window.addEventListener('resize', () => {
        clearTimeout(t);
        t = setTimeout(() => {
          if (state.view === 'insights' && state.insights) renderInsights();
        }, 150);
      });
    }
  }
  /* The dashboard. Two series share one axis (both are counts): visits in
     gold, page views in blue, validated for colour-vision separation on this
     surface. A period change keeps the previous render dimmed until the new
     figures arrive; the skeleton shows only on the first load. */
  const INS = {
    visits: { label: 'Visits', color: '#a8781a' },
    views: { label: 'Page views', color: '#2a6fa8' },
  };
  const PERMANENT_SUPERADMIN_EMAIL = 'contact@kalaayanastudios.com';
  const svgNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...children) => {
    const node = document.createElementNS(svgNS, tag);
    for (const [k, v] of Object.entries(attrs)) if (v != null) node.setAttribute(k, v);
    for (const c of children.flat()) if (c != null) node.append(c);
    return node;
  };
  const fmt = (x) => {
    const v = Number(x || 0);
    if (v >= 1e6) return `${(v / 1e6).toFixed(v >= 1e7 ? 0 : 1)}M`;
    if (v >= 1e4) return `${(v / 1e3).toFixed(v >= 1e5 ? 0 : 1)}K`;
    return v.toLocaleString('en-IN');
  };
  const niceCeil = (v) => {
    if (v <= 0) return 1;
    const p = 10 ** Math.floor(Math.log10(v));
    for (const m of [1, 2, 2.5, 5, 10]) if (m * p >= v) return m * p;
    return 10 * p;
  };
  const delta = (cur, prev) => {
    if (!prev) return null;
    return (cur - prev) / prev;
  };
  function sparkline(raw, color) {
    const buckets = Math.min(12, raw.length);
    const size = raw.length / buckets;
    const values = Array.from({ length: buckets }, (_, b) =>
      raw.slice(Math.round(b * size), Math.round((b + 1) * size)).reduce((n, v) => n + v, 0),
    );
    const w = 96;
    const h = 28;
    const max = Math.max(1, ...values);
    const step = values.length > 1 ? w / (values.length - 1) : w;
    const pts = values.map(
      (v, i) => `${(i * step).toFixed(1)},${(h - 2 - (v / max) * (h - 4)).toFixed(1)}`,
    );
    return svg(
      'svg',
      { class: 'spark', viewBox: `0 0 ${w} ${h}`, 'aria-hidden': 'true' },
      svg('polyline', {
        points: pts.join(' '),
        fill: 'none',
        stroke: color,
        'stroke-width': '1.5',
        'stroke-linejoin': 'round',
        'stroke-linecap': 'round',
      }),
      svg('circle', {
        cx: pts[pts.length - 1].split(',')[0],
        cy: pts[pts.length - 1].split(',')[1],
        r: '3',
        fill: color,
        stroke: '#fff',
        'stroke-width': '2',
      }),
    );
  }
  function statTile({ label, value, deltaValue, periodLabel, spark, color, upIsGood = true }) {
    let d = null;
    if (deltaValue != null && Number.isFinite(deltaValue)) {
      const up = deltaValue >= 0;
      const good = up === upIsGood;
      d = el(
        'span',
        { class: `delta ${deltaValue === 0 ? '' : good ? 'good' : 'bad'}` },
        el('i', { 'aria-hidden': 'true' }, deltaValue === 0 ? '·' : up ? '▲' : '▼'),
        ` ${Math.abs(Math.round(deltaValue * 100))}% vs previous ${periodLabel}`,
      );
    } else if (deltaValue === null)
      d = el('span', { class: 'delta' }, `No previous ${periodLabel} to compare`);
    return el(
      'div',
      { class: 'tile' },
      el('small', {}, label),
      el('div', { class: 'tile-row' }, el('b', {}, value), spark ? sparkline(spark, color) : null),
      d,
    );
  }
  function lineChart(d, width) {
    const W = Math.max(320, width);
    const H = 260;
    const pad = { t: 18, r: 96, b: 30, l: 44 };
    const iw = W - pad.l - pad.r;
    const ih = H - pad.t - pad.b;
    const n = d.byDay.length;
    const max = niceCeil(Math.max(1, ...d.byDay.map((x) => Math.max(x.visits, x.views))));
    const x = (i) => pad.l + (n > 1 ? (i / (n - 1)) * iw : iw / 2);
    const y = (v) => pad.t + ih - (v / max) * ih;
    const ticks = [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
    const g = svg('svg', {
      class: 'line-chart',
      viewBox: `0 0 ${W} ${H}`,
      width: W,
      height: H,
      role: 'img',
      'aria-label': `Visits and page views per day for the last ${d.days} days`,
    });
    for (const t of ticks) {
      g.append(svg('line', { x1: pad.l, x2: W - pad.r, y1: y(t), y2: y(t), class: 'grid' }));
      g.append(
        svg('text', { x: pad.l - 8, y: y(t) + 4, class: 'tick', 'text-anchor': 'end' }, fmt(t)),
      );
    }
    const every = n > 45 ? 15 : n > 14 ? 7 : 1;
    d.byDay.forEach((p, i) => {
      if (i === n - 1 || (i % every === 0 && n - 1 - i > every / 2))
        g.append(
          svg(
            'text',
            {
              x: x(i),
              y: H - 8,
              class: 'tick',
              'text-anchor': i === 0 ? 'start' : i === n - 1 ? 'end' : 'middle',
            },
            p.date.slice(5).replace('-', '/'),
          ),
        );
    });
    for (const key of ['views', 'visits']) {
      const pts = d.byDay.map((p, i) => [x(i), y(p[key])]);
      const path = pts
        .map((p, i) => `${i ? 'L' : 'M'}${p[0].toFixed(1)},${p[1].toFixed(1)}`)
        .join(' ');
      g.append(
        svg('path', {
          d: `${path} L${pts[n - 1][0].toFixed(1)},${y(0)} L${pts[0][0].toFixed(1)},${y(0)} Z`,
          fill: INS[key].color,
          'fill-opacity': '0.08',
        }),
      );
      g.append(
        svg('path', {
          d: path,
          fill: 'none',
          stroke: INS[key].color,
          'stroke-width': '2',
          'stroke-linejoin': 'round',
          'stroke-linecap': 'round',
        }),
      );
      const last = pts[n - 1];
      g.append(
        svg('circle', {
          cx: last[0],
          cy: last[1],
          r: '4',
          fill: INS[key].color,
          stroke: '#fff',
          'stroke-width': '2',
        }),
      );
      g.append(
        svg(
          'text',
          { x: last[0] + 10, y: last[1] + 4, class: 'end-label' },
          `${fmt(d.byDay[n - 1][key])} ${key === 'views' ? 'views' : 'visits'}`,
        ),
      );
    }
    // crosshair layer
    const cross = svg('line', {
      class: 'crosshair',
      y1: pad.t,
      y2: pad.t + ih,
      x1: 0,
      x2: 0,
      visibility: 'hidden',
    });
    const dots = ['visits', 'views'].map((key) =>
      svg('circle', {
        r: '5',
        fill: INS[key].color,
        stroke: '#fff',
        'stroke-width': '2',
        visibility: 'hidden',
      }),
    );
    g.append(cross, ...dots);
    const hit = svg('rect', {
      x: pad.l,
      y: pad.t,
      width: iw,
      height: ih,
      fill: 'transparent',
      tabindex: '0',
      'aria-label': 'Hover or use arrow keys to read values',
    });
    g.append(hit);
    const wrap = el('div', { class: 'chart-wrap' });
    const tip = el('div', { class: 'chart-tip', hidden: '' });
    wrap.append(g, tip);
    let current = -1;
    const show = (i) => {
      if (i < 0 || i >= n) return;
      current = i;
      const p = d.byDay[i];
      cross.setAttribute('x1', x(i));
      cross.setAttribute('x2', x(i));
      cross.setAttribute('visibility', 'visible');
      ['visits', 'views'].forEach((key, k) => {
        dots[k].setAttribute('cx', x(i));
        dots[k].setAttribute('cy', y(p[key]));
        dots[k].setAttribute('visibility', 'visible');
      });
      tip.replaceChildren(
        el('b', {}, p.date),
        ...['visits', 'views'].map((key) =>
          el(
            'div',
            { class: 'tip-row' },
            el('i', { style: `background:${INS[key].color}` }),
            el('strong', {}, fmt(p[key])),
            el('span', {}, INS[key].label),
          ),
        ),
      );
      tip.hidden = false;
      const left = (x(i) / W) * wrap.clientWidth;
      tip.style.left = `${Math.min(Math.max(left, 90), wrap.clientWidth - 90)}px`;
    };
    const hide = () => {
      cross.setAttribute('visibility', 'hidden');
      dots.forEach((c) => c.setAttribute('visibility', 'hidden'));
      tip.hidden = true;
      current = -1;
    };
    hit.addEventListener('pointermove', (e) => {
      const r = g.getBoundingClientRect();
      const px = ((e.clientX - r.left) / r.width) * W;
      show(Math.round(((px - pad.l) / iw) * (n - 1)));
    });
    hit.addEventListener('pointerleave', hide);
    hit.addEventListener('focus', () => show(n - 1));
    hit.addEventListener('blur', hide);
    hit.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowLeft') show(Math.max(0, (current < 0 ? n - 1 : current) - 1));
      else if (e.key === 'ArrowRight') show(Math.min(n - 1, (current < 0 ? 0 : current) + 1));
      else return;
      e.preventDefault();
    });
    return wrap;
  }
  function barList(title, list, total, color) {
    const max = Math.max(1, ...list.map((r) => r.visits));
    return el(
      'section',
      { class: 'ins-card' },
      el('h2', {}, title),
      list.length
        ? el(
            'ol',
            { class: 'bars' },
            ...list.map((r) =>
              el(
                'li',
                { title: `${r.label}: ${fmt(r.visits)} visits, ${fmt(r.views)} page views` },
                el('span', { class: 'bar-label' }, r.label || '—'),
                el(
                  'span',
                  { class: 'bar-track' },
                  el('i', {
                    style: `width:${Math.max(2, (r.visits / max) * 100)}%;background:${color}`,
                  }),
                ),
                el('span', { class: 'bar-value' }, fmt(r.visits)),
                el(
                  'span',
                  { class: 'bar-share' },
                  total ? `${Math.round((r.visits / total) * 100)}%` : '',
                ),
              ),
            ),
          )
        : el('p', { class: 'muted' }, 'Nothing in this period.'),
    );
  }
  function segmented(title, list, total) {
    const shades = ['#a8781a', '#2a6fa8', '#6b6256', '#b9ab8f'];
    const parts = list.slice(0, 4);
    return el(
      'section',
      { class: 'ins-card' },
      el('h2', {}, title),
      parts.length
        ? el(
            'div',
            {},
            el(
              'div',
              {
                class: 'segments',
                role: 'img',
                'aria-label': parts
                  .map((p) => `${p.label} ${Math.round((p.visits / total) * 100)}%`)
                  .join(', '),
              },
              ...parts.map((p, i) => {
                const share = total ? p.visits / total : 0;
                return el(
                  'span',
                  {
                    style: `flex:${Math.max(share, 0.001)};background:${shades[i]}`,
                    title: `${p.label}: ${fmt(p.visits)} visits (${Math.round(share * 100)}%)`,
                  },
                  share >= 0.12 ? `${Math.round(share * 100)}%` : '',
                );
              }),
            ),
            el(
              'ul',
              { class: 'legend' },
              ...parts.map((p, i) =>
                el('li', {}, el('i', { style: `background:${shades[i]}` }), p.label),
              ),
            ),
          )
        : el('p', { class: 'muted' }, 'Nothing in this period.'),
    );
  }
  function insightTables(d) {
    const t = (title, head, rows) =>
      el(
        'section',
        { class: 'ins-card' },
        el('h2', {}, title),
        el(
          'table',
          { class: 'log-table ins-table' },
          el('thead', {}, el('tr', {}, ...head.map((h) => el('th', {}, h)))),
          el('tbody', {}, ...rows.map((r) => el('tr', {}, ...r.map((c) => el('td', {}, c))))),
        ),
      );
    return el(
      'div',
      { class: 'ins-grid' },
      t(
        'Per day',
        ['Date', 'Visits', 'Page views'],
        d.byDay.map((x) => [x.date, fmt(x.visits), fmt(x.views)]),
      ),
      t(
        'Pages',
        ['Page', 'Visits', 'Page views'],
        d.pages.map((x) => [x.label, fmt(x.visits), fmt(x.views)]),
      ),
      t(
        'Sources',
        ['Site', 'Visits'],
        d.referrers.map((x) => [x.label, fmt(x.visits)]),
      ),
      t(
        'Countries',
        ['Country', 'Visits'],
        d.countries.map((x) => [x.label, fmt(x.visits)]),
      ),
      t(
        'Devices',
        ['Device', 'Visits'],
        d.devices.map((x) => [x.label, fmt(x.visits)]),
      ),
    );
  }
  function renderInsights() {
    const d = state.insights;
    const stale = d && d.days !== state.insightDays;
    const loading = !d && !state.insightsError;
    const periodLabel = `${state.insightDays} days`;
    const range = el(
      'div',
      { class: 'range', role: 'group', 'aria-label': 'Period' },
      ...[7, 30, 90].map((k) =>
        el(
          'button',
          {
            type: 'button',
            'aria-pressed': String(state.insightDays === k),
            onclick: () => showInsights(k),
          },
          `${k} days`,
        ),
      ),
    );
    const view = el(
      'div',
      { class: 'range', role: 'group', 'aria-label': 'View' },
      ...[
        ['chart', 'Charts'],
        ['table', 'Table'],
      ].map(([k, label]) =>
        el(
          'button',
          {
            type: 'button',
            'aria-pressed': String((state.insightsView || 'chart') === k),
            onclick: () => {
              state.insightsView = k;
              renderInsights();
            },
          },
          label,
        ),
      ),
    );
    let body;
    if (loading) {
      body = el(
        'div',
        { 'aria-hidden': 'true' },
        el(
          'div',
          { class: 'tiles' },
          ...[0, 1, 2, 3].map(() =>
            el(
              'div',
              { class: 'tile' },
              el('span', { class: 'skel skel-line', style: 'width:40%' }),
              el('span', { class: 'skel skel-title' }),
            ),
          ),
        ),
        el('span', { class: 'skel', style: 'display:block;height:260px' }),
      );
    } else if (!d) {
      body = el(
        'div',
        { class: 'insight-note' },
        el(
          'p',
          {},
          state.insightsUnconfigured
            ? 'Insights are not switched on yet.'
            : 'Insights could not be loaded.',
        ),
        el('p', { class: 'muted' }, state.insightsError),
        state.insightsUnconfigured
          ? el(
              'p',
              { class: 'muted' },
              'A superadmin sets this up once: a Cloudflare Web Analytics site for the domain, its token in the site data, its site tag and an analytics-reading API token on the Worker. The steps are in docs/ADMIN-SETUP.md.',
            )
          : null,
      );
    } else {
      const perVisit = d.totals.visits ? d.totals.views / d.totals.visits : 0;
      const tiles = el(
        'div',
        { class: 'tiles' },
        statTile({
          label: 'Visits',
          value: fmt(d.totals.visits),
          deltaValue: delta(d.totals.visits, d.previous?.visits),
          periodLabel,
          spark: d.byDay.map((x) => x.visits),
          color: INS.visits.color,
        }),
        statTile({
          label: 'Page views',
          value: fmt(d.totals.views),
          deltaValue: delta(d.totals.views, d.previous?.views),
          periodLabel,
          spark: d.byDay.map((x) => x.views),
          color: INS.views.color,
        }),
        statTile({ label: 'Pages per visit', value: perVisit.toFixed(1) }),
        statTile({ label: 'Visits a day', value: fmt(Math.round(d.totals.visits / d.days)) }),
      );
      const legend = el(
        'ul',
        { class: 'legend' },
        ...['visits', 'views'].map((k) =>
          el(
            'li',
            {},
            el('i', { class: 'key-line', style: `background:${INS[k].color}` }),
            INS[k].label,
          ),
        ),
      );
      const chartCard = el(
        'section',
        { class: 'ins-card ins-main' },
        el('div', { class: 'card-head' }, el('h2', {}, 'Per day'), legend),
        el('div', { class: 'chart-slot' }),
      );
      const grid = el(
        'div',
        { class: 'ins-grid' },
        barList('Pages', d.pages, d.totals.visits, INS.visits.color),
        barList('Sources', d.referrers, d.totals.visits, INS.views.color),
        barList('Countries', d.countries, d.totals.visits, INS.visits.color),
        segmented(
          'Devices',
          d.devices,
          d.devices.reduce((n, x) => n + x.visits, 0),
        ),
      );
      body = el(
        'div',
        { class: stale ? 'refetching' : '' },
        tiles,
        (state.insightsView || 'chart') === 'table'
          ? insightTables(d)
          : el('div', {}, chartCard, grid),
      );
      requestAnimationFrame(() => {
        const slot = $('.chart-slot');
        if (slot) slot.replaceChildren(lineChart(d, slot.clientWidth));
      });
    }
    $('#main').replaceChildren(
      el(
        'div',
        { class: 'head' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, 'Website'),
          el('h1', {}, 'Insights'),
          el(
            'p',
            { class: 'muted' },
            d
              ? `${d.from.slice(0, 10)} to ${d.to.slice(0, 10)} · measured without cookies by Cloudflare Web Analytics · bots left out`
              : 'Who is reading the site, measured without cookies by Cloudflare Web Analytics. Bots are left out.',
          ),
        ),
        el('div', { class: 'actions' }, range, view),
      ),
      body,
    );
    renderSections();
  }

  /* ---------- log (superadmin) ---------- */
  // Log and users come with the content; a tab switch within twenty seconds
  // of the last fetch reuses it rather than asking GitHub again.
  const FRESH_MS = 20000;
  async function refreshAdminData(force = false) {
    if (!force && state.adminFetchedAt && Date.now() - state.adminFetchedAt < FRESH_MS) return;
    const data = await api('/content');
    state.users = data.users || [];
    state.log = data.log || '';
    state.decisions = data.decisions || [];
    state.adminFetchedAt = Date.now();
  }
  async function showLog() {
    state.view = 'log';
    renderLog();
    try {
      await refreshAdminData();
    } catch {
      return;
    }
    if (state.view === 'log') renderLog();
  }
  function renderLog() {
    const all = (Array.isArray(state.log) ? state.log : []).slice().reverse();
    const filters =
      state.logFilters ||
      (state.logFilters = { from: '', to: '', user: '', category: 'all', text: '' });
    const main = $('#main');
    const list = el('div', { class: 'log-block' });
    const count = el('p', { class: 'muted' });

    const apply = () => {
      const from = filters.from ? new Date(`${filters.from}T00:00:00${STUDIO_OFFSET}`) : null;
      const to = filters.to ? new Date(`${filters.to}T23:59:59.999${STUDIO_OFFSET}`) : null;
      const user = filters.user.trim().toLowerCase();
      const text = filters.text.trim().toLowerCase();
      const rows = all.filter((e) => {
        const at = new Date(e.at);
        if (from && at < from) return false;
        if (to && at > to) return false;
        if (filters.category !== 'all' && e.category !== filters.category) return false;
        if (user && !`${e.name || ''} ${e.email}`.toLowerCase().includes(user)) return false;
        if (text && !`${e.action} ${e.details || ''}`.toLowerCase().includes(text)) return false;
        return true;
      });
      count.textContent = `${rows.length} of ${all.length} entries`;
      list.replaceChildren(
        rows.length
          ? el(
              'ol',
              { class: 'log-list' },
              ...rows.map((e) =>
                el(
                  'li',
                  { class: `log-${e.category}` },
                  el('time', { datetime: e.at }, when(e.at, true)),
                  el('span', { class: `pill pill-${e.category}` }, e.category),
                  el('b', {}, e.name ? `${e.name} (${e.email})` : e.email),
                  el('span', {}, `${e.action}${e.details ? ` · ${e.details}` : ''}`),
                  e.photo
                    ? el(
                        'a',
                        {
                          class: 'log-photo',
                          href: `/admin/api/photo/${e.photo}`,
                          target: '_blank',
                          rel: 'noopener noreferrer',
                        },
                        el('img', {
                          src: `/admin/api/photo/${e.photo}`,
                          alt: `Photograph of ${e.name || e.email} at sign-in`,
                        }),
                      )
                    : null,
                ),
              ),
            )
          : el('p', { class: 'muted' }, 'Nothing matches.'),
      );
    };
    const f = (label, input) => el('div', { class: 'f' }, el('label', {}, label), input);
    const date = (key) => {
      const i = el('input', { type: 'date', value: filters[key] });
      i.addEventListener('input', () => {
        filters[key] = i.value;
        apply();
      });
      return i;
    };
    const user = el('input', { type: 'search', value: filters.user, placeholder: 'name or email' });
    user.addEventListener('input', () => {
      filters.user = user.value;
      apply();
    });
    const cat = el(
      'select',
      {},
      ...[
        ['all', 'All'],
        ['content', 'Site content'],
        ['admin', 'Admin (users)'],
        ['session', 'Sign-ins'],
        ['error', 'Errors'],
      ].map(([v, l]) => {
        const o = el('option', { value: v }, l);
        if (v === filters.category) o.selected = true;
        return o;
      }),
    );
    cat.addEventListener('change', () => {
      filters.category = cat.value;
      apply();
    });
    const text = el('input', {
      type: 'search',
      value: filters.text,
      placeholder: 'action or details',
    });
    text.addEventListener('input', () => {
      filters.text = text.value;
      apply();
    });
    const clear = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Clear');
    clear.addEventListener('click', () => {
      Object.assign(filters, { from: '', to: '', user: '', category: 'all', text: '' });
      renderLog();
    });

    main.replaceChildren(
      el(
        'div',
        { class: 'head' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, 'Superadmin'),
          el('h1', {}, 'Log'),
          el(
            'p',
            { class: 'muted' },
            'Every sign-in, change and error, with who and when. Entries can only be added, never removed.',
          ),
        ),
      ),
      el(
        'div',
        { class: 'log-filters' },
        f('From', date('from')),
        f('To', date('to')),
        f('User', user),
        f('Type', cat),
        f('Search', text),
        el('div', { class: 'f log-filters-tools' }, clear, count),
      ),
      list,
      ...[
        state.decisions?.length
          ? el(
              'div',
              { class: 'log-block' },
              el('h2', {}, 'Proposed changes on staging'),
              el(
                'table',
                { class: 'log-table' },
                el(
                  'thead',
                  {},
                  el(
                    'tr',
                    {},
                    el('th', {}, '#'),
                    el('th', {}, 'Change'),
                    el('th', {}, 'Proposed'),
                    el('th', {}, 'State'),
                    el('th', {}, 'Decided'),
                  ),
                ),
                el(
                  'tbody',
                  {},
                  ...state.decisions.map((d) =>
                    el(
                      'tr',
                      {},
                      el(
                        'td',
                        {},
                        el(
                          'a',
                          { href: d.url, target: '_blank', rel: 'noopener noreferrer' },
                          `#${d.number}`,
                        ),
                      ),
                      el('td', {}, d.title),
                      el('td', {}, when(d.at)),
                      el('td', {}, el('span', { class: `pill pill-${d.state}` }, d.state)),
                      el('td', {}, d.decidedAt ? when(d.decidedAt) : '—'),
                    ),
                  ),
                ),
              ),
            )
          : null,
      ].filter(Boolean),
    );
    apply();
    renderSections();
  }

  /* ---------- who is using this account ----------
     Accounts can be shared, so every session states a name and, when the
     device has a camera, takes a photograph. Both go to the log. */
  /* The sign-in photograph must show a face. pico (MIT) runs a small
     cascade on the captured frame, entirely in the browser from the admin's
     own files; nothing leaves the device before the photograph is accepted. */
  let faceFinder = null;
  async function loadFaceFinder() {
    if (faceFinder) return faceFinder;
    faceFinder = (async () => {
      if (!window.pico) {
        await new Promise((ok, fail) => {
          const sc = el('script', { src: '/admin/vendor/pico.js' });
          sc.onload = ok;
          sc.onerror = () => fail(new Error('face check script'));
          document.head.append(sc);
        });
      }
      const res = await fetch('/admin/vendor/facefinder');
      if (!res.ok) throw new Error('face check model');
      return window.pico.unpack_cascade(new Int8Array(await res.arrayBuffer()));
    })();
    faceFinder.catch(() => {
      faceFinder = null;
    });
    return faceFinder;
  }
  async function faceIn(canvas) {
    const classify = await loadFaceFinder();
    const ctx2d = canvas.getContext('2d');
    const { data, width, height } = ctx2d.getImageData(0, 0, canvas.width, canvas.height);
    const gray = new Uint8Array(width * height);
    for (let i = 0; i < gray.length; i += 1)
      gray[i] = (2 * data[i * 4] + 7 * data[i * 4 + 1] + data[i * 4 + 2]) / 10;
    const dets = window.pico.cluster_detections(
      window.pico.run_cascade(
        { pixels: gray, nrows: height, ncols: width, ldim: width },
        classify,
        {
          shiftfactor: 0.1,
          minsize: Math.round(Math.min(width, height) * 0.18),
          maxsize: 1000,
          scalefactor: 1.1,
        },
      ),
      0.2,
    );
    return dets.some((d) => d[3] >= 8);
  }

  function askWhoIsHere() {
    return new Promise((resolve) => {
      const name = el('input', {
        type: 'text',
        id: 'who-name',
        placeholder: 'Your name',
        autocomplete: 'name',
        maxlength: '60',
        required: '',
      });
      const note = el('p', { class: 'signin-error', role: 'alert' });
      const video = el('video', { autoplay: '', playsinline: '', muted: '' });
      const canvas = el('canvas', { hidden: '' });
      const shot = el('img', { alt: 'Your photograph', hidden: '' });
      const cam = el('div', { class: 'cam' }, video, shot, canvas);
      const take = el(
        'button',
        { class: 'btn btn-ghost btn-sm', type: 'button' },
        'Take photograph',
      );
      const retake = el(
        'button',
        { class: 'btn btn-ghost btn-sm', type: 'button', hidden: '' },
        'Retake',
      );
      const camNote = el('small', { class: 'muted' }, 'Starting the camera…');
      const go = el('button', { class: 'btn', type: 'submit' }, 'Continue');
      let stream = null;
      let photo = null;
      const stop = () => {
        if (stream) stream.getTracks().forEach((t) => t.stop());
        stream = null;
      };
      (async () => {
        try {
          stream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: false,
          });
          video.srcObject = stream;
          loadFaceFinder().catch(() => {});
          take.disabled = true;
          video.addEventListener(
            'playing',
            () => {
              take.disabled = false;
              camNote.textContent =
                'Take a photograph to continue; it is kept in the log with your name.';
            },
            { once: true },
          );
        } catch {
          cam.hidden = true;
          take.hidden = true;
          if (state.photoRequired) {
            camNote.textContent =
              'This account must be photographed at sign-in and this device has no camera. Open the admin on a phone or a laptop with a camera.';
            go.disabled = true;
            go.hidden = true;
            form.append(
              el(
                'button',
                { class: 'btn btn-ghost', type: 'button', onclick: () => signOut('manual') },
                'Sign out',
              ),
            );
          } else
            camNote.textContent = 'No camera available on this device; your name alone is logged.';
        }
      })();
      take.addEventListener('click', () => {
        if (!stream || video.readyState < 2) {
          note.textContent = 'The camera is still starting; try again in a moment.';
          return;
        }
        canvas.width = 320;
        canvas.height = Math.round((320 * (video.videoHeight || 480)) / (video.videoWidth || 640));
        const ctx2d = canvas.getContext('2d');
        ctx2d.drawImage(video, 0, 0, canvas.width, canvas.height);
        // A frame the camera has not exposed yet is black: refuse it.
        const px = ctx2d.getImageData(0, 0, canvas.width, canvas.height).data;
        let sum = 0;
        for (let i = 0; i < px.length; i += 16) sum += px[i] + px[i + 1] + px[i + 2];
        if (sum / ((px.length / 16) * 3) < 8) {
          note.textContent = 'That frame came out black. Give the camera a second and try again.';
          return;
        }
        note.textContent = '';
        take.disabled = true;
        take.classList.add('is-busy');
        faceIn(canvas)
          .then((ok) => {
            if (!ok) {
              note.textContent = 'No face in the frame. Look at the camera and try again.';
              return;
            }
            photo = canvas.toDataURL('image/jpeg', 0.8);
            shot.src = photo;
            shot.hidden = false;
            video.hidden = true;
            take.hidden = true;
            retake.hidden = false;
          })
          .catch(() => {
            note.textContent = 'The face check could not load. Reload the page and try again.';
          })
          .finally(() => {
            take.disabled = false;
            take.classList.remove('is-busy');
          });
      });
      retake.addEventListener('click', () => {
        photo = null;
        shot.hidden = true;
        video.hidden = false;
        take.hidden = false;
        retake.hidden = true;
      });
      const form = el(
        'form',
        { class: 'signin-form' },
        el('div', { class: 'f' }, el('label', { for: 'who-name' }, 'Name'), name),
        cam,
        el('div', { class: 'cam-tools' }, take, retake, camNote),
        go,
        note,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        if (go.disabled) return;
        const who = name.value.trim();
        if (!who) {
          note.textContent = 'Enter your name.';
          name.focus();
          return;
        }
        // With a camera, the photograph is part of the record: no photo, no entry.
        if (stream && !photo) {
          note.textContent = 'Take your photograph first.';
          take.focus();
          return;
        }
        note.textContent = '';
        go.disabled = true;
        go.classList.add('is-busy');
        go.textContent = 'Signing in…';
        try {
          await api('/session', { method: 'POST', body: JSON.stringify({ name: who, photo }) });
          try {
            sessionStorage.setItem('admin-name', who);
          } catch {
            /* no storage: the name is still on this request's log line */
          }
          stop();
          closeDialog();
          resolve();
        } catch (x) {
          note.textContent = x.message;
          go.disabled = false;
          go.classList.remove('is-busy');
          go.textContent = 'Continue';
        }
      });
      $('#result-body').replaceChildren(
        el('h2', {}, 'Who is using this account?'),
        el(
          'p',
          { class: 'muted' },
          `Signed in as ${state.email}. Your name goes on everything you do this session.`,
        ),
        form,
      );
      $('#result-close').hidden = true;
      $('#result-x').hidden = true;
      state.dialogLocked = true;
      $('#result').showModal();
      name.focus();
    });
  }

  /* ---------- errors go to the log ---------- */
  let errorsReported = 0;
  function reportError(action, details) {
    if (errorsReported >= 5 || !state.email) return;
    errorsReported += 1;
    api('/log', {
      method: 'POST',
      body: JSON.stringify({
        category: 'error',
        action,
        details: String(details || '').slice(0, 600),
      }),
    }).catch(() => {});
  }
  window.addEventListener('error', (e) =>
    reportError('admin page error', `${e.message} @ ${e.filename}:${e.lineno}`),
  );
  window.addEventListener('unhandledrejection', (e) =>
    reportError('admin page error', e.reason?.message || String(e.reason)),
  );

  /* ---------- users (superadmin) ---------- */
  // The table changes the moment you act; the server's answer then confirms
  // it, or the previous list comes back with the reason.
  async function changeUser(body) {
    const before = state.users;
    const email = String(body.email || '')
      .trim()
      .toLowerCase();
    if (body.action === 'remove') state.users = before.filter((u) => u.email !== email);
    else if (body.action === 'role')
      state.users = before.map((u) => (u.email === email ? { ...u, role: body.role } : u));
    else if (body.action === 'photo')
      state.users = before.map((u) => (u.email === email ? { ...u, photo: body.photo } : u));
    else if (body.action === 'invite')
      state.users = [
        ...before,
        { email, role: body.role, invitedBy: state.email, invitedAt: new Date().toISOString() },
      ];
    state.usersBusy =
      body.action === 'remove'
        ? `Removing ${email}…`
        : body.action === 'invite'
          ? `Inviting ${email}…`
          : `Saving ${email}…`;
    state.usersError = '';
    state.usersPending = '';
    renderUsers();
    try {
      const r = await api('/users', { method: 'POST', body: JSON.stringify(body) });
      if (Array.isArray(r.users)) state.users = r.users;
      state.adminFetchedAt = Date.now();
      state.usersPending = [
        r.pr ? `Recorded in pull request #${r.pr}; it takes effect once that merges.` : '',
        r.access || '',
      ]
        .filter(Boolean)
        .join(' ');
    } catch (e) {
      state.users = before;
      state.usersError = e.message;
    }
    state.usersBusy = '';
    if (state.view === 'users') renderUsers();
  }
  async function showUsers() {
    state.view = 'users';
    renderUsers();
    try {
      await refreshAdminData();
    } catch {
      return;
    }
    if (state.view === 'users') renderUsers();
  }
  function renderUsers() {
    const note = el('p', { class: 'signin-error', role: 'alert' }, state.usersError || '');
    const busy = Boolean(state.usersBusy);
    const email = el('input', {
      type: 'email',
      id: 'invite-email',
      placeholder: 'name@example.com',
      autocomplete: 'off',
    });
    const role = el(
      'select',
      { id: 'invite-role' },
      el('option', { value: 'admin' }, 'Admin — add and update projects'),
      el('option', { value: 'superadmin' }, 'Superadmin — everything, including users and the log'),
    );
    const inviteBtn = el(
      'button',
      { class: 'btn', type: 'submit', disabled: busy ? '' : null },
      'Invite',
    );
    const form = el(
      'form',
      { class: 'invite' },
      el(
        'div',
        { class: 'row' },
        el('div', { class: 'f' }, el('label', { for: 'invite-email' }, 'Email'), email),
        el('div', { class: 'f' }, el('label', { for: 'invite-role' }, 'Role'), role),
      ),
      inviteBtn,
      el(
        'small',
        { class: 'muted' },
        state.demo
          ? 'Locally: the person signs in with this email on the sign-in page.'
          : 'They sign in at the staging address with this email; Cloudflare Access emails them a one-time code. The Access policy is updated to match this list.',
      ),
      note,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      changeUser({ action: 'invite', email: email.value.trim(), role: role.value });
    });
    const main = $('#main');
    main.replaceChildren(
      el(
        'div',
        { class: 'head' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, 'Superadmin'),
          el('h1', {}, 'Users'),
          el(
            'p',
            { class: 'muted' },
            'Who can sign in to the admin, and what they may do. Admins add and update projects; superadmins can do everything, see the log and manage users.',
          ),
          busy ? el('p', { class: 'pending-note' }, state.usersBusy) : null,
          state.usersPending ? el('p', { class: 'pending-note' }, state.usersPending) : null,
        ),
      ),
      el(
        'table',
        { class: 'log-table' },
        el(
          'thead',
          {},
          el(
            'tr',
            {},
            el('th', {}, 'Email'),
            el('th', {}, 'Role'),
            state.canSetPhoto ? el('th', {}, 'Photo at sign-in') : null,
            el('th', {}, 'Invited'),
            el('th', {}, ''),
          ),
        ),
        el(
          'tbody',
          {},
          ...state.users.map((u) => {
            const sel = el(
              'select',
              {},
              ...['admin', 'superadmin'].map((r) => {
                const o = el('option', { value: r }, r);
                if (r === u.role) o.selected = true;
                return o;
              }),
            );
            sel.disabled = busy;
            sel.addEventListener('change', () =>
              changeUser({ action: 'role', email: u.email, role: sel.value }),
            );
            let photoSel = null;
            if (state.canSetPhoto) {
              if (u.email === PERMANENT_SUPERADMIN_EMAIL)
                photoSel = el('span', { class: 'muted' }, 'Always');
              else {
                photoSel = el(
                  'select',
                  { disabled: busy ? '' : null },
                  ...[
                    ['required', 'Required'],
                    ['optional', 'Optional'],
                  ].map(([v, label]) => {
                    const o = el('option', { value: v }, label);
                    if ((u.photo || 'required') === v) o.selected = true;
                    return o;
                  }),
                );
                photoSel.addEventListener('change', () =>
                  changeUser({ action: 'photo', email: u.email, photo: photoSel.value }),
                );
              }
            }
            return el(
              'tr',
              {},
              el(
                'td',
                {},
                u.email,
                u.email === state.email ? el('small', { class: 'muted' }, ' (you)') : null,
              ),
              el('td', {}, sel),
              state.canSetPhoto ? el('td', {}, photoSel) : null,
              el(
                'td',
                {},
                u.invitedAt
                  ? `${when(u.invitedAt)}${u.invitedBy ? ` by ${u.invitedBy}` : ''}`
                  : '—',
              ),
              el(
                'td',
                {},
                u.email === state.email
                  ? null
                  : el(
                      'button',
                      {
                        class: 'btn btn-danger btn-sm',
                        type: 'button',
                        disabled: busy ? '' : null,
                        onclick: () =>
                          confirmBox(
                            `Remove ${u.email}?`,
                            'They can no longer sign in to the admin.',
                            () => changeUser({ action: 'remove', email: u.email }),
                          ),
                      },
                      'Remove',
                    ),
              ),
            );
          }),
        ),
      ),
      el('h2', { class: 'invite-heading' }, 'Invite someone'),
      form,
    );
    renderSections();
  }

  /* ---------- sections sidebar ---------- */ /* ---------- sections sidebar ---------- */
  function renderSections() {
    const nav = $('#sections');
    nav.replaceChildren(
      ...Object.entries(state.sections).map(([key, s]) =>
        el(
          'button',
          {
            type: 'button',
            'aria-current': String(state.view === 'section' && state.current === key),
            onclick: () => openSection(key),
          },
          el('span', {}, workName(key)),
          el('b', {}, String(state.projects.filter((p) => p.group === key).length)),
        ),
      ),
    );
  }

  /* ---------- section view ---------- */
  function openSection(key) {
    state.view = 'section';
    state.editing = key;
    state.current = key;
    if (state.tab === 'projects') writePlace();
    const s = state.sections[key];
    const items = state.projects.filter((p) => p.group === key);
    const main = $('#main');
    main.replaceChildren(
      el(
        'div',
        { class: 'head' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, s.eyebrow),
          el('h1', {}, workName(key)),
          el('p', { class: 'muted' }, `${s.title} — ${s.lede}`),
        ),
        el(
          'div',
          { class: 'actions' },
          state.role === 'superadmin'
            ? el(
                'button',
                { class: 'btn btn-ghost', type: 'button', onclick: () => editSection(key) },
                'Edit work',
              )
            : null,
          el(
            'button',
            { class: 'btn', type: 'button', onclick: () => newProject(key) },
            '+ New project',
          ),
        ),
      ),
      items.length
        ? el('div', { class: 'grid' }, items.map(projectCard))
        : el('p', { class: 'empty' }, 'No projects in this section yet.'),
    );
    renderSections();
  }

  function projectCard(p) {
    const node = $('#tpl-project-card').content.firstElementChild.cloneNode(true);
    const slot = $('.card-thumb', node);
    if (p.images[0]) {
      const img = pic(imageUrl('projects', p.images[0].file), {
        class: 'card-thumb',
        alt: p.images[0].alt,
      });
      slot.replaceWith(img);
    }
    $('.card-title', node).textContent = p.title;
    $('.card-meta', node).textContent =
      `${p.scale} · ${p.images.length} image${p.images.length === 1 ? '' : 's'}`;
    node.tabIndex = 0;
    node.addEventListener('click', () => editProject(p.slug));
    node.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') editProject(p.slug);
    });
    return node;
  }

  /* ---------- field helpers ---------- */
  function field(label, props, hint) {
    const input = props.multiline
      ? el('textarea', { rows: props.rows || 3 })
      : el('input', { type: props.type || 'text' });
    input.value = props.value ?? '';
    if (props.placeholder) input.placeholder = props.placeholder;
    input.addEventListener('input', () => {
      props.oninput(input.value);
      wrap.classList.toggle('invalid', props.required && !input.value.trim());
    });
    const wrap = el(
      'div',
      { class: 'f' },
      el('label', {}, label),
      input,
      hint ? el('small', {}, hint) : null,
    );
    // A required field that is already empty is shown as such from the start,
    // so "Take me there" lands on a marked field.
    if (props.required && !String(props.value ?? '').trim()) wrap.classList.add('invalid');
    return wrap;
  }

  function dropZone(label, onFiles, multiple) {
    const input = el('input', {
      type: 'file',
      accept: 'image/jpeg,image/png',
      multiple: multiple ? '' : null,
    });
    input.addEventListener('change', () => {
      onFiles([...input.files]);
      input.value = '';
    });
    const zone = el('div', { class: 'drop' }, label, input);
    zone.addEventListener('click', () => input.click());
    zone.addEventListener('dragover', (e) => {
      e.preventDefault();
      zone.classList.add('over');
    });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => {
      e.preventDefault();
      zone.classList.remove('over');
      onFiles([...e.dataTransfer.files].filter((f) => /image\/(jpeg|png)/.test(f.type)));
    });
    return zone;
  }

  async function stageUpload(file, name, store) {
    const b64 = await readFile(file);
    store[name] = b64;
    state.previews[name] = URL.createObjectURL(file);
  }
  const nextImageName = (slug, ext) => {
    const taken = new Set([
      ...state.projectFiles,
      ...Object.keys(state.uploads),
      ...state.projects.flatMap((p) => p.images.map((i) => i.file)),
    ]);
    let n = 1;
    while (taken.has(`${slug}-${n}.${ext}`)) n += 1;
    return `${slug}-${n}.${ext}`;
  };

  /* ---------- project editor ---------- */
  function newProject(group) {
    const p = { slug: '', group, title: '', scale: '', description: '', images: [] };
    state.projects.push(p);
    editProject(p, true);
  }

  function editProject(ref, isNew = false) {
    const p = typeof ref === 'string' ? state.projects.find((x) => x.slug === ref) : ref;
    state.view = 'project';
    state.editing = p;
    state.current = p.group;
    let slugLocked = !isNew;
    let slugField;
    const main = $('#main');
    const imagesBox = el('div', { class: 'images photos' });

    const renderImages = () => {
      imagesBox.replaceChildren(
        ...p.images.map((img, i) =>
          el(
            'div',
            { class: `image photo${img.file in state.uploads ? ' new' : ''}` },
            pic(imageUrl('projects', img.file)),
            el(
              'div',
              {},
              el('p', { class: 'image-name' }, img.file),
              field(
                'Alt text',
                {
                  value: img.alt,
                  required: true,
                  oninput: (v) => {
                    img.alt = v;
                    markDirty();
                  },
                },
                'Describe the photograph for people who cannot see it.',
              ),
            ),
            el(
              'div',
              { class: 'image-tools' },
              el(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  disabled: i === 0 ? '' : null,
                  onclick: () => {
                    [p.images[i - 1], p.images[i]] = [p.images[i], p.images[i - 1]];
                    renderImages();
                    markDirty();
                  },
                },
                '↑',
              ),
              el(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  disabled: i === p.images.length - 1 ? '' : null,
                  onclick: () => {
                    [p.images[i + 1], p.images[i]] = [p.images[i], p.images[i + 1]];
                    renderImages();
                    markDirty();
                  },
                },
                '↓',
              ),
              i === 0
                ? el('span', { class: 'cover-badge' }, 'Cover')
                : el(
                    'button',
                    {
                      class: 'btn btn-ghost btn-sm',
                      type: 'button',
                      title: 'Use this photograph as the project cover',
                      onclick: () => {
                        p.images.unshift(...p.images.splice(i, 1));
                        renderImages();
                        markDirty();
                      },
                    },
                    'Set as cover',
                  ),
              el(
                'button',
                {
                  class: 'btn btn-danger btn-sm',
                  type: 'button',
                  onclick: () => {
                    p.images.splice(i, 1);
                    delete state.uploads[img.file];
                    renderImages();
                    markDirty();
                  },
                },
                'Remove',
              ),
            ),
          ),
        ),
      );
    };

    const addImages = async (files) => {
      if (!p.slug) {
        alertBox(
          'Give the project a title first',
          'The image file names are derived from its slug.',
        );
        return;
      }
      for (const f of files) {
        const ext = f.type === 'image/png' ? 'png' : 'jpg';
        const name = nextImageName(p.slug, ext);
        await stageUpload(f, name, state.uploads);
        p.images.push({ file: name, alt: '' });
      }
      renderImages();
      markDirty();
    };

    main.replaceChildren(
      el(
        'div',
        { class: 'head' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, workName(p.group)),
          el('h1', {}, isNew ? 'New project' : p.title),
        ),
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            {
              class: 'btn btn-ghost',
              type: 'button',
              onclick: () => {
                if (isNew && !p.title) state.projects.splice(state.projects.indexOf(p), 1);
                openSection(p.group);
              },
            },
            '← Back',
          ),
          isNew || state.role !== 'superadmin'
            ? null
            : el(
                'button',
                {
                  class: 'btn btn-danger',
                  type: 'button',
                  onclick: () =>
                    confirmBox(
                      `Delete “${p.title}”?`,
                      'Its page and photographs are removed from the site on save.',
                      () => {
                        state.projects.splice(state.projects.indexOf(p), 1);
                        p.images.forEach((i) => delete state.uploads[i.file]);
                        markDirty();
                        openSection(p.group);
                      },
                    ),
                },
                'Delete project',
              ),
        ),
      ),
      el(
        'div',
        { class: 'form' },
        el(
          'div',
          { class: 'row' },
          field('Title', {
            value: p.title,
            required: true,
            oninput: (v) => {
              p.title = v;
              if (!slugLocked) {
                p.slug = slugify(v);
                slugField.querySelector('input').value = p.slug;
              }
              markDirty();
            },
          }),
          (() => {
            const w = field(
              'Slug (URL)',
              {
                value: p.slug,
                required: true,
                oninput: (v) => {
                  slugLocked = true;
                  p.slug = slugify(v);
                  markDirty();
                },
              },
              `/${p.group}/<slug>/ — lowercase letters, digits, hyphens`,
            );
            return (slugField = w);
          })(),
        ),
        el(
          'div',
          { class: 'row' },
          field('Scale', {
            value: p.scale,
            required: true,
            placeholder: 'e.g. 85 ft',
            oninput: (v) => {
              p.scale = v;
              markDirty();
            },
          }),
          (() => {
            const w = el(
              'div',
              { class: 'f' },
              el('label', {}, 'Section'),
              el(
                'select',
                {},
                ...Object.entries(state.sections).map(([k, s]) => {
                  const o = el('option', { value: k }, workName(k));
                  if (k === p.group) o.selected = true;
                  return o;
                }),
              ),
            );
            w.querySelector('select').addEventListener('change', (e) => {
              p.group = e.target.value;
              markDirty();
            });
            return w;
          })(),
        ),
        field(
          'Description',
          {
            value: p.description,
            required: true,
            multiline: true,
            oninput: (v) => {
              p.description = v;
              markDirty();
            },
          },
          'Material, place, year — one or two sentences.',
        ),
        el(
          'div',
          { class: 'f' },
          el('label', {}, 'Photographs'),
          imagesBox,
          dropZone('Drop JPG or PNG photographs here, or click to choose', addImages, true),
        ),
      ),
    );
    renderImages();
    renderSections();
  }

  /* ---------- fit: crop to fill, or show the whole photograph ----------
     A cut-out on a plain ground (a bronze on beige) should not be cropped.
     "Show whole" letterboxes it on a background sampled from the
     photograph's own edges, so the tile reads as one continuous surface. */
  function sampleEdge(src) {
    return new Promise((resolve) => {
      const img = new Image();
      img.crossOrigin = 'anonymous';
      img.onload = () => {
        try {
          const c = document.createElement('canvas');
          c.width = 48;
          c.height = 48;
          const g = c.getContext('2d');
          g.drawImage(img, 0, 0, 48, 48);
          const d = g.getImageData(0, 0, 48, 48).data;
          let r = 0,
            gg = 0,
            b = 0,
            n = 0;
          for (let y = 0; y < 48; y += 1)
            for (let x = 0; x < 48; x += 1) {
              if (x > 2 && x < 45 && y > 2 && y < 45) continue;
              const i = (y * 48 + x) * 4;
              r += d[i];
              gg += d[i + 1];
              b += d[i + 2];
              n += 1;
            }
          const hex = (v) =>
            Math.round(v / n)
              .toString(16)
              .padStart(2, '0');
          resolve(`#${hex(r)}${hex(gg)}${hex(b)}`);
        } catch {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = src;
    });
  }

  function fitControl(w, rerender) {
    const seg = el('div', { class: 'frame-tabs', role: 'tablist' });
    const mk = (label, value) => {
      const t = el(
        'button',
        {
          type: 'button',
          role: 'tab',
          'aria-selected': String((w.image.fit || 'cover') === value),
        },
        label,
      );
      t.addEventListener('click', async () => {
        if ((w.image.fit || 'cover') === value) return;
        if (value === 'contain') {
          w.image.fit = 'contain';
          if (!w.image.background)
            w.image.background =
              (await sampleEdge(imageUrl(w.image.from, w.image.file))) || '#29251f';
        } else {
          delete w.image.fit;
        }
        markDirty();
        rerender();
      });
      return t;
    };
    seg.append(mk('Crop to fill', 'cover'), mk('Show whole', 'contain'));
    const swatchPreview = el(
      'div',
      { class: 'fit-preview' },
      pic(imageUrl(w.image.from, w.image.file)),
    );
    swatchPreview.style.background = w.image.background || '#29251f';
    const colour = el('input', {
      type: 'color',
      value: w.image.background || '#29251f',
      'aria-label': 'Background colour',
    });
    colour.addEventListener('input', () => {
      w.image.background = colour.value;
      swatchPreview.style.background = colour.value;
      markDirty();
    });
    const resample = el(
      'button',
      { class: 'btn btn-ghost btn-sm', type: 'button' },
      'Match photograph',
    );
    resample.addEventListener('click', async () => {
      const hex = await sampleEdge(imageUrl(w.image.from, w.image.file));
      if (!hex) return;
      w.image.background = hex;
      colour.value = hex;
      swatchPreview.style.background = hex;
      markDirty();
    });
    return el(
      'div',
      { class: 'f' },
      el('label', {}, 'How the photograph fills the tile'),
      el('div', { class: 'frame-bar' }, seg),
      w.image.fit === 'contain'
        ? el(
            'div',
            { class: 'fit-row' },
            swatchPreview,
            el(
              'div',
              { class: 'fit-tools' },
              el('label', { class: 'fit-label' }, 'Background', colour),
              resample,
              el(
                'small',
                {},
                'Sampled from the photograph’s edges so the tile looks like one surface. Adjust if needed.',
              ),
            ),
          )
        : el(
            'small',
            {},
            'Crop to fill is the usual choice. Use Show whole for a cut-out on a plain background.',
          ),
    );
  }

  /* ---------- framing ----------
     The photograph is shown whole, with the crop the site will use drawn over
     it. Drag the frame to the part that should show. One frame per layout
     (desktop, phone); the position is saved as the image's focus point. */
  function focusPicker({ src, get, set, crops, getZoom, setZoom }) {
    const img = el('img', { src, alt: '', draggable: 'false' });
    const frame = el(
      'div',
      { class: 'frame' },
      el('span', { class: 'frame-hint' }, 'Drag to reposition'),
    );
    const shade = el('div', { class: 'frame-shade' });
    const stage = el('div', { class: 'frame-stage' }, img, shade, frame);
    const tabs = el('div', { class: 'frame-tabs', role: 'tablist' });
    const value = el('span', { class: 'focus-value' });
    let active = 0;
    let natural = null;

    const ratioOf = (r) => {
      const [w, h] = String(r)
        .split('/')
        .map((n) => parseFloat(n));
      return w / h;
    };
    const parse = () => {
      const [x, y] = (get() || '50% 50%').split(' ').map((v) => parseFloat(v));
      return { x: Number.isFinite(x) ? x : 50, y: Number.isFinite(y) ? y : 50 };
    };
    // The cover crop spans the full width or the full height of the photo;
    // only the other axis moves. Geometry in displayed pixels.
    const geometry = () => {
      const W = img.clientWidth;
      const H = img.clientHeight;
      const r = ratioOf(crops[active][1]);
      const z = getZoom ? Number(getZoom()) || 1 : 1;
      const fw = Math.min(W, H * r) / z;
      const fh = fw / r;
      const f = parse();
      return { W, H, fw, fh, left: ((W - fw) * f.x) / 100, top: ((H - fh) * f.y) / 100 };
    };
    const paint = () => {
      if (!img.clientWidth) return;
      const g = geometry();
      frame.style.width = `${g.fw}px`;
      frame.style.height = `${g.fh}px`;
      frame.style.left = `${g.left}px`;
      frame.style.top = `${g.top}px`;
      shade.style.clipPath = `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${g.top}px, ${g.left}px ${g.top}px, ${g.left}px ${g.top + g.fh}px, ${g.left + g.fw}px ${g.top + g.fh}px, ${g.left + g.fw}px ${g.top}px, 0 ${g.top}px)`;
      value.textContent = `Position ${get() || '50% 50%'}`;
    };
    const commit = (left, top) => {
      const g = geometry();
      const x =
        g.W - g.fw > 1
          ? Math.round((Math.min(Math.max(left, 0), g.W - g.fw) / (g.W - g.fw)) * 100)
          : 50;
      const y =
        g.H - g.fh > 1
          ? Math.round((Math.min(Math.max(top, 0), g.H - g.fh) / (g.H - g.fh)) * 100)
          : 50;
      set(`${x}% ${y}%`);
      paint();
    };

    let drag = null;
    const down = (e) => {
      if (!img.clientWidth) return;
      const g = geometry();
      const r = stage.getBoundingClientRect();
      const px = e.clientX - r.left;
      const py = e.clientY - r.top;
      const inside = px >= g.left && px <= g.left + g.fw && py >= g.top && py <= g.top + g.fh;
      // Grab the frame where it is, or jump it to the click and grab its centre.
      drag = inside ? { dx: px - g.left, dy: py - g.top } : { dx: g.fw / 2, dy: g.fh / 2 };
      stage.setPointerCapture(e.pointerId);
      stage.classList.add('dragging');
      commit(px - drag.dx, py - drag.dy);
      e.preventDefault();
    };
    const move = (e) => {
      if (!drag) return;
      const r = stage.getBoundingClientRect();
      commit(e.clientX - r.left - drag.dx, e.clientY - r.top - drag.dy);
    };
    const up = () => {
      if (!drag) return;
      drag = null;
      stage.classList.remove('dragging');
      markDirty();
    };
    stage.addEventListener('pointerdown', down);
    stage.addEventListener('pointermove', move);
    stage.addEventListener('pointerup', up);
    stage.addEventListener('pointercancel', up);
    // Keyboard: arrows nudge the frame.
    stage.tabIndex = 0;
    stage.setAttribute('role', 'slider');
    stage.setAttribute('aria-label', 'Framing: drag the frame, or use the arrow keys');
    stage.addEventListener('keydown', (e) => {
      const f = parse();
      const step = e.shiftKey ? 10 : 2;
      const map = {
        ArrowLeft: [-step, 0],
        ArrowRight: [step, 0],
        ArrowUp: [0, -step],
        ArrowDown: [0, step],
      };
      if (!map[e.key]) return;
      e.preventDefault();
      set(
        `${Math.min(100, Math.max(0, f.x + map[e.key][0]))}% ${Math.min(100, Math.max(0, f.y + map[e.key][1]))}%`,
      );
      paint();
      markDirty();
    });

    crops.forEach(([label], i) => {
      const t = el(
        'button',
        { type: 'button', role: 'tab', 'aria-selected': String(i === active) },
        label,
      );
      t.addEventListener('click', () => {
        active = i;
        [...tabs.children].forEach((c, j) => c.setAttribute('aria-selected', String(j === active)));
        paint();
      });
      tabs.append(t);
    });
    const reset = el('button', { class: 'btn btn-ghost btn-sm', type: 'button' }, 'Centre');
    reset.addEventListener('click', () => {
      set('50% 50%');
      if (setZoom) {
        setZoom(1);
        zoom.value = '1';
        zoomOut.textContent = '1.0×';
      }
      paint();
      markDirty();
    });
    // Zoom: the photograph is scaled up inside the frame, so the frame covers
    // less of it and can move left and right as well as up and down.
    const zoom = el('input', {
      type: 'range',
      min: '1',
      max: '2.5',
      step: '0.05',
      value: String(getZoom ? getZoom() || 1 : 1),
      'aria-label': 'Zoom',
    });
    const zoomOut = el('span', { class: 'focus-value' }, `${Number(zoom.value).toFixed(1)}×`);
    zoom.addEventListener('input', () => {
      if (setZoom) setZoom(Number(zoom.value));
      zoomOut.textContent = `${Number(zoom.value).toFixed(1)}×`;
      paint();
    });
    zoom.addEventListener('change', () => markDirty());
    const zoomBar = setZoom
      ? el(
          'label',
          { class: 'zoom-bar' },
          el('span', { class: 'fit-label' }, 'Zoom'),
          zoom,
          zoomOut,
          el('small', {}, 'Zoom in to move the frame left and right too.'),
        )
      : null;

    img.addEventListener('load', paint);
    if (img.complete) queueMicrotask(paint);
    new ResizeObserver(paint).observe(stage);
    return el(
      'div',
      { class: 'f' },
      el('label', {}, 'Framing'),
      el(
        'div',
        { class: 'focus' },
        el('div', { class: 'frame-bar' }, tabs, reset, value),
        zoomBar,
        stage,
        el(
          'small',
          {},
          'What is inside the frame is what the site shows. Drag it to the part of the photograph that matters.',
        ),
      ),
    );
  }

  /* ---------- homepage works ---------- */
  function imageChoices() {
    const choices = [];
    for (const p of state.projects)
      for (const img of p.images)
        choices.push({
          from: 'projects',
          file: img.file,
          label: `${p.title} — ${img.file}`,
          alt: img.alt,
        });
    for (const [key, sec] of Object.entries(state.sections))
      if (sec.banner)
        choices.push({
          from: 'sections',
          file: sec.banner,
          label: `${workName(key)} banner — ${sec.banner}`,
          alt: sec.bannerAlt,
        });
    return choices;
  }

  function editHome() {
    state.view = 'home';
    state.current = null;
    const works = (state.home.works ||= []);
    const main = $('#main');
    const list = el('div', { class: 'images' });

    const render = () => {
      list.replaceChildren(
        ...works.map((w, i) =>
          el(
            'div',
            {
              class: `image work${w.image.file in state.uploads ? ' new' : ''}${state.openWork === i ? ' open' : ''}`,
            },
            el(
              'button',
              {
                class: 'work-head',
                type: 'button',
                'aria-expanded': String(state.openWork === i),
                onclick: () => {
                  state.openWork = state.openWork === i ? null : i;
                  render();
                },
              },
              pic(imageUrl(w.image.from, w.image.file)),
              el('span', { class: 'work-head-num' }, String(i + 1).padStart(2, '0')),
              el(
                'span',
                { class: 'work-head-text' },
                el('b', {}, w.title || 'Untitled work'),
                el(
                  'small',
                  {},
                  [
                    w.eyebrow,
                    w.section
                      ? `${state.projects.filter((p) => p.group === w.section).length} projects`
                      : w.href,
                  ]
                    .filter(Boolean)
                    .join(' · '),
                ),
              ),
              el('span', { class: 'work-head-chevron', 'aria-hidden': 'true' }, '⌄'),
            ),
            pic(imageUrl(w.image.from, w.image.file)),
            el(
              'div',
              { class: 'form work-form' },
              el(
                'p',
                { class: 'image-name' },
                `${String(i + 1).padStart(2, '0')} · ${w.image.from}/${w.image.file}`,
              ),
              el(
                'div',
                { class: 'row' },
                field('Eyebrow', {
                  value: w.eyebrow,
                  required: true,
                  placeholder: 'Sacred spaces',
                  oninput: (v) => {
                    w.eyebrow = v;
                    markDirty();
                  },
                }),
                field('Title', {
                  value: w.title,
                  required: true,
                  oninput: (v) => {
                    w.title = v;
                    markDirty();
                  },
                }),
              ),
              el(
                'div',
                { class: 'row' },
                (() => {
                  const sel = el('select', {});
                  const options = [
                    ...Object.entries(state.sections).map(([k]) => [`/${k}/`, workName(k)]),
                    ['/collectables/', 'Collectables'],
                  ];
                  if (!options.some(([h]) => h === w.href)) options.push([w.href, w.href]);
                  for (const [h, label] of options) {
                    const o = el('option', { value: h }, label);
                    if (h === w.href) o.selected = true;
                    sel.append(o);
                  }
                  sel.addEventListener('change', () => {
                    w.href = sel.value;
                    const key = sel.value.replace(/^\/|\/$/g, '');
                    if (state.sections[key]) w.section = key;
                    else delete w.section;
                    markDirty();
                  });
                  return el('div', { class: 'f' }, el('label', {}, 'Links to'), sel);
                })(),
                field('Link text', {
                  value: w.link,
                  required: true,
                  placeholder: 'Discover collection',
                  oninput: (v) => {
                    w.link = v;
                    markDirty();
                  },
                }),
              ),
              (() => {
                const sel = el('select', {});
                for (const c of imageChoices()) {
                  const o = el('option', { value: `${c.from}/${c.file}` }, c.label);
                  if (c.from === w.image.from && c.file === w.image.file) o.selected = true;
                  sel.append(o);
                }
                if (!sel.value || sel.value !== `${w.image.from}/${w.image.file}`) {
                  const o = el(
                    'option',
                    { value: `${w.image.from}/${w.image.file}` },
                    `${w.image.from}/${w.image.file}`,
                  );
                  o.selected = true;
                  sel.append(o);
                }
                sel.addEventListener('change', () => {
                  const [from, file] = sel.value.split('/');
                  const choice = imageChoices().find((c) => c.from === from && c.file === file);
                  w.image = { from, file, alt: choice?.alt || w.image.alt };
                  render();
                  markDirty();
                });
                return el(
                  'div',
                  { class: 'f' },
                  el('label', {}, 'Photograph'),
                  sel,
                  el(
                    'small',
                    {},
                    'Any project photograph or section banner, or drop a new one below.',
                  ),
                );
              })(),
              field('Alt text', {
                value: w.image.alt,
                required: true,
                oninput: (v) => {
                  w.image.alt = v;
                  markDirty();
                },
              }),
              fitControl(w, () => render()),
              w.image.fit === 'contain'
                ? null
                : focusPicker({
                    src: imageUrl(w.image.from, w.image.file),
                    get: () => w.image.focus || '50% 48%',
                    set: (v) => {
                      w.image.focus = v;
                    },
                    getZoom: () => w.image.zoom || 1,
                    setZoom: (z) => {
                      if (z > 1) w.image.zoom = Math.round(z * 100) / 100;
                      else delete w.image.zoom;
                    },
                    crops: [
                      ['Desktop', '2 / 1'],
                      ['Phone', '4 / 3'],
                    ],
                  }),
              dropZone(
                'Drop a new photograph for this work',
                async (files) => {
                  if (!files[0]) return;
                  const ext = files[0].type === 'image/png' ? 'png' : 'jpg';
                  const name = nextImageName(`home-${slugify(w.title || 'work') || 'work'}`, ext);
                  await stageUpload(files[0], name, state.uploads);
                  w.image = { from: 'projects', file: name, alt: w.image.alt };
                  render();
                  markDirty();
                },
                false,
              ),
            ),
            el(
              'div',
              { class: 'image-tools' },
              el(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  disabled: i === 0 ? '' : null,
                  onclick: () => {
                    [works[i - 1], works[i]] = [works[i], works[i - 1]];
                    render();
                    markDirty();
                  },
                },
                '↑',
              ),
              el(
                'button',
                {
                  class: 'btn btn-ghost btn-sm',
                  type: 'button',
                  disabled: i === works.length - 1 ? '' : null,
                  onclick: () => {
                    [works[i + 1], works[i]] = [works[i], works[i + 1]];
                    render();
                    markDirty();
                  },
                },
                '↓',
              ),
              el(
                'button',
                {
                  class: 'btn btn-danger btn-sm',
                  type: 'button',
                  onclick: () => {
                    if (
                      w.image.from === 'projects' &&
                      w.image.file in state.uploads &&
                      !state.projects.some((p) => p.images.some((x) => x.file === w.image.file))
                    )
                      delete state.uploads[w.image.file];
                    works.splice(i, 1);
                    render();
                    markDirty();
                  },
                },
                w.section ? 'Remove from homepage' : 'Remove',
              ),
              w.section && state.sections[w.section]
                ? el(
                    'button',
                    {
                      class: 'work-link',
                      type: 'button',
                      onclick: () => {
                        state.current = w.section;
                        showTab('projects');
                      },
                    },
                    `Projects in this work (${state.projects.filter((p) => p.group === w.section).length}) →`,
                  )
                : null,
            ),
          ),
        ),
      );
    };

    main.replaceChildren(
      el(
        'div',
        { class: 'head' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, 'Homepage'),
          el('h1', {}, 'Works'),
          el(
            'p',
            { class: 'muted' },
            'The works shown under WORKS on the homepage, in this order. Each work holds its projects in the Projects tab. Adding a work here creates it there too.',
          ),
        ),
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            { class: 'btn btn-ghost', type: 'button', onclick: newProjectAnywhere },
            '+ New project',
          ),
          el('button', { class: 'btn', type: 'button', onclick: newWork }, '+ Add a work'),
        ),
      ),
      list,
    );
    render();
    renderSections();
  }

  /* ---------- section editor ---------- */
  function editSection(key, isNew = false) {
    const s =
      state.sections[key] ||
      (state.sections[key] = {
        eyebrow: '',
        title: '',
        lede: '',
        banner: `${key}.jpg`,
        bannerAlt: '',
        href: `/${key}/`,
        bannerFocus: '50% 50%',
      });
    state.view = 'section-edit';
    state.editing = key;
    state.current = key;
    const bannerBox = el('div', { class: 'images' });
    const bannerSrc = () =>
      s.banner in state.bannerCopies
        ? imageUrl('projects', state.bannerCopies[s.banner])
        : imageUrl('sections', s.banner);
    const renderBanner = () => {
      const have =
        state.bannerFiles.has(s.banner) ||
        s.banner in state.banners ||
        s.banner in state.bannerCopies;
      bannerBox.replaceChildren(
        have
          ? el(
              'div',
              {
                class: `image${s.banner in state.banners || s.banner in state.bannerCopies ? ' new' : ''}`,
              },
              pic(bannerSrc()),
              el(
                'div',
                {},
                el('p', { class: 'image-name' }, s.banner),
                field('Banner alt text', {
                  value: s.bannerAlt,
                  required: true,
                  oninput: (v) => {
                    s.bannerAlt = v;
                    markDirty();
                  },
                }),
                focusPicker({
                  src: bannerSrc(),
                  get: () => s.bannerFocus,
                  set: (v) => {
                    s.bannerFocus = v;
                  },
                  crops: [
                    ['Section banner', '16 / 6'],
                    ['Phone', '4 / 5'],
                  ],
                }),
              ),
            )
          : el('p', { class: 'muted' }, 'No banner yet.'),
      );
    };
    const main = $('#main');
    main.replaceChildren(
      el(
        'div',
        { class: 'head' },
        el(
          'div',
          {},
          el('p', { class: 'eyebrow' }, isNew ? 'New section' : 'Edit work'),
          el('h1', {}, s.title || key),
        ),
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            {
              class: 'btn btn-ghost',
              type: 'button',
              onclick: () => {
                if (isNew && !s.title) delete state.sections[key];
                Object.keys(state.sections).length
                  ? openSection(state.sections[key] ? key : Object.keys(state.sections)[0])
                  : main.replaceChildren();
                markDirty();
              },
            },
            '← Back',
          ),
          isNew || state.projects.some((p) => p.group === key)
            ? null
            : el(
                'button',
                {
                  class: 'btn btn-danger',
                  type: 'button',
                  onclick: () =>
                    confirmBox(
                      `Delete work “${s.title}”?`,
                      'Its page and its homepage tile are removed from the site on save.',
                      () => {
                        delete state.sections[key];
                        delete state.banners[s.banner];
                        state.home.works = state.home.works.filter((w) => w.section !== key);
                        markDirty();
                        openSection(Object.keys(state.sections)[0]);
                      },
                    ),
                },
                'Delete work',
              ),
        ),
      ),
      el(
        'div',
        { class: 'form' },
        el(
          'div',
          { class: 'row' },
          field(
            'Eyebrow',
            {
              value: s.eyebrow,
              required: true,
              placeholder: 'Monumental',
              oninput: (v) => {
                s.eyebrow = v;
                markDirty();
              },
            },
            'Small label above the title.',
          ),
          field(
            'Page headline',
            {
              value: s.title,
              required: true,
              oninput: (v) => {
                s.title = v;
                markDirty();
              },
            },
            `Shown at the top of /${key}/. The work's name on the homepage is edited in the Homepage tab.`,
          ),
        ),
        field(
          'Lede',
          {
            value: s.lede,
            required: true,
            multiline: true,
            rows: 2,
            oninput: (v) => {
              s.lede = v;
              markDirty();
            },
          },
          'One sentence under the title.',
        ),
        el(
          'div',
          { class: 'f' },
          el('label', {}, `Banner · page at /${key}/`),
          bannerBox,
          (() => {
            const sel = el('select', {});
            sel.append(el('option', { value: '' }, 'Choose a project photograph as the banner…'));
            for (const p of state.projects)
              for (const img of p.images) {
                const o = el('option', { value: img.file }, `${p.title} — ${img.file}`);
                if (state.bannerCopies[s.banner] === img.file) o.selected = true;
                sel.append(o);
              }
            sel.addEventListener('change', () => {
              if (!sel.value) return;
              delete state.banners[s.banner];
              delete state.bannerCopies[s.banner];
              s.banner = `${key}.${sel.value.split('.').pop()}`;
              state.bannerCopies[s.banner] = sel.value;
              const source = state.projects
                .flatMap((p) => p.images)
                .find((i) => i.file === sel.value);
              if (source && !s.bannerAlt) s.bannerAlt = source.alt;
              renderBanner();
              markDirty();
            });
            return el('div', { class: 'f' }, el('label', {}, 'Use an existing photograph'), sel);
          })(),
          dropZone(
            'Or drop a new banner photograph here, or click to choose',
            async (files) => {
              if (!files[0]) return;
              const ext = files[0].type === 'image/png' ? 'png' : 'jpg';
              delete state.banners[s.banner];
              delete state.bannerCopies[s.banner];
              s.banner = `${key}.${ext}`;
              await stageUpload(files[0], s.banner, state.banners);
              renderBanner();
              markDirty();
            },
            false,
          ),
        ),
      ),
    );
    renderBanner();
    renderSections();
  }

  function newProjectAnywhere() {
    const keys = Object.keys(state.sections);
    if (!keys.length)
      return alertBox('Create a section first', 'A project lives inside a section.');
    const sel = el(
      'select',
      { id: 'np-section' },
      ...keys.map((k) => el('option', { value: k }, workName(k))),
    );
    $('#result-body').replaceChildren(
      el('h2', {}, 'New project'),
      el('p', { class: 'muted' }, 'Which section does this work belong to?'),
      el('div', { class: 'f' }, el('label', { for: 'np-section' }, 'Section'), sel),
    );
    $('#result-close').textContent = 'Create';
    $('#result-close').onclick = () => {
      $('#result').close();
      $('#result-close').textContent = 'Close';
      $('#result-close').onclick = () => $('#result').close();
      newProject(sel.value);
    };
    $('#result').showModal();
  }

  function newWork() {
    const draft = { title: '', eyebrow: '', lede: '', file: null };
    const dlg = $('#result');
    const picked = el('p', { class: 'muted' }, 'No photograph yet.');
    const note = el('p', { class: 'signin-error', role: 'alert' });
    $('#result-body').replaceChildren(
      el('h2', {}, 'New work'),
      el(
        'p',
        { class: 'muted' },
        'A work is a collection on the homepage, with its own page and its projects in the Projects tab.',
      ),
      el(
        'div',
        { class: 'form' },
        field(
          'Name',
          {
            value: '',
            required: true,
            placeholder: 'Garden sculpture',
            oninput: (v) => (draft.title = v),
          },
          'Shown on the homepage and as the page title. The address becomes /<name>/.',
        ),
        field(
          'Eyebrow',
          {
            value: '',
            required: true,
            placeholder: 'Outdoor works',
            oninput: (v) => (draft.eyebrow = v),
          },
          'The small label above the name.',
        ),
        field('One line about it', {
          value: '',
          required: true,
          multiline: true,
          rows: 2,
          oninput: (v) => (draft.lede = v),
        }),
        el(
          'div',
          { class: 'f' },
          el('label', {}, 'Cover photograph'),
          picked,
          dropZone(
            'Drop the photograph that represents this work, or click to choose',
            (files) => {
              if (!files[0]) return;
              draft.file = files[0];
              picked.textContent = files[0].name;
            },
            false,
          ),
        ),
        note,
      ),
    );
    $('#result-close').textContent = 'Create work';
    $('#result-close').onclick = async () => {
      const key = slugify(draft.title);
      if (!key) return (note.textContent = 'Give the work a name.');
      if (state.sections[key]) return (note.textContent = `“${draft.title}” already exists.`);
      if (!draft.eyebrow.trim() || !draft.lede.trim())
        return (note.textContent = 'Fill in the eyebrow and the line about it.');
      if (!draft.file) return (note.textContent = 'Add a cover photograph.');
      const ext = draft.file.type === 'image/png' ? 'png' : 'jpg';
      const banner = `${key}.${ext}`;
      await stageUpload(draft.file, banner, state.banners);
      state.sections[key] = {
        eyebrow: draft.eyebrow.trim(),
        title: draft.title.trim(),
        lede: draft.lede.trim(),
        banner,
        bannerAlt: draft.title.trim(),
        href: `/${key}/`,
        bannerFocus: '50% 50%',
      };
      state.openWork = (state.home.works ||= []).length;
      state.home.works.push({
        section: key,
        href: `/${key}/`,
        eyebrow: draft.eyebrow.trim(),
        title: draft.title.trim(),
        link: 'Discover collection',
        image: { from: 'sections', file: banner, alt: draft.title.trim(), focus: '50% 50%' },
      });
      dlg.close();
      $('#result-close').textContent = 'Close';
      $('#result-close').onclick = () => dlg.close();
      markDirty();
      state.current = key;
      showTab('projects');
    };
    dlg.showModal();
  }

  /* ---------- preview, then accept, then save ----------
     Nothing is saved until the editor has looked at the page as the site
     will show it and accepted it. In the demo the real site is built from
     the current edits; accepting writes the files and a line in
     CONTENT-LOG.md with who, when and what. On staging the save opens a
     pull request that does not merge by itself; Cloudflare builds it; the
     editor accepts (recorded on the PR by email and time, then merged) or
     rejects (closed, branch deleted). */
  function previewPath() {
    if (state.view === 'home') return '/#works';
    if (state.view === 'project' && state.editing?.slug)
      return `/${state.editing.group}/${state.editing.slug}/`;
    if ((state.view === 'section' || state.view === 'section-edit') && state.editing)
      return `/${state.editing}/`;
    return '/';
  }
  /* ---------- what the server would refuse, caught here first ----------
     Mirrors the Worker's rules for the things an editor can fix in the form,
     so a missing alt text is pointed at, not reported after a round trip. */
  const SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
  function localProblems() {
    const out = [];
    const need = (ok, text, go) => {
      if (!ok) out.push({ text, go });
    };
    Object.entries(state.sections).forEach(([key, sec]) => {
      const go = () => editSection(key);
      for (const f of ['eyebrow', 'title', 'lede'])
        need(String(sec?.[f] ?? '').trim(), `Work "${workName(key)}" is missing its ${f}`, go);
      need(sec?.banner, `Work "${workName(key)}" has no banner photograph`, go);
    });
    (state.home?.works || []).forEach((w, i) => {
      const go = () => {
        state.openWork = i;
        showTab('home');
      };
      need(String(w?.title ?? '').trim(), `Homepage work ${i + 1} is missing its title`, go);
      need(String(w?.eyebrow ?? '').trim(), `Homepage work ${i + 1} is missing its eyebrow`, go);
      need(
        String(w?.image?.alt ?? '').trim(),
        `Homepage work ${i + 1} (${w?.title || 'untitled'}) needs alt text for its image`,
        go,
      );
    });
    const slugs = new Set();
    state.projects.forEach((pr, i) => {
      const name = pr?.title || pr?.slug || `#${i + 1}`;
      const go = () => editProject(pr);
      for (const f of ['title', 'slug', 'scale', 'description'])
        need(String(pr?.[f] ?? '').trim(), `Project "${name}" is missing its ${f}`, go);
      need(
        !pr?.slug || SLUG_RE.test(pr.slug),
        `Project "${name}": the slug must be lowercase letters, digits and hyphens`,
        go,
      );
      need(!slugs.has(pr?.slug), `Project "${name}": the slug ${pr?.slug} is already used`, go);
      slugs.add(pr?.slug);
      need(pr?.images?.length, `Project "${name}" needs at least one photograph`, go);
      (pr?.images || []).forEach((img, j) =>
        need(
          String(img?.alt ?? '').trim(),
          `Project "${name}": photograph ${j + 1} needs alt text`,
          go,
        ),
      );
    });
    return out;
  }
  function showProblems(problems, verb) {
    const first = problems[0];
    $('#result-body').replaceChildren(
      el('h2', {}, `Finish these before ${verb}`),
      el('p', { class: 'muted' }, 'The site needs every field below. Nothing has been sent.'),
      el(
        'ul',
        {},
        ...problems.slice(0, 12).map((pr) => el('li', {}, pr.text)),
        problems.length > 12 ? el('li', {}, `and ${problems.length - 12} more`) : null,
      ),
    );
    $('#result-close').hidden = false;
    $('#result-close').disabled = false;
    $('#result-close').textContent = 'Take me there';
    $('#result-close').onclick = () => {
      closeDialog();
      if (first.go) first.go();
      setTimeout(() => {
        const bad = $('.f.invalid input, .f.invalid textarea');
        if (bad) {
          bad.scrollIntoView({ block: 'center' });
          bad.focus();
        }
      }, 50);
    };
    if (!$('#result').open) $('#result').showModal();
  }

  function payload() {
    return {
      projects: state.projects,
      sections: state.sections,
      home: state.home,
      uploads: state.uploads,
      banners: state.banners,
      bannerCopies: state.bannerCopies,
      message: $('#message').value,
    };
  }
  let waitTimer = null;
  let waitType = null;
  function stopWaiting() {
    clearInterval(waitTimer);
    clearTimeout(waitType);
    clearInterval(waitType);
    waitTimer = null;
    waitType = null;
  }
  const openTab = () => {
    const tab = window.open('', '_blank');
    waiting(tab, 'Preparing your changes…');
    return tab;
  };
  const sendTo = (tab, url) => {
    stopWaiting();
    if (tab) tab.location.replace(url);
    else window.location.assign(url);
  };
  // The tab that will show the preview, while it is being built: the mark,
  // a moving bar, the time so far, and a line of what the studio might be up
  // to, drawn from a shuffled list so no line comes round twice in a row.
  const WAIT_LINES = [
    'Preparing the clay…',
    'Mixing the colours…',
    'Sharpening the chisels…',
    'Warming the kiln…',
    'Polishing the bronze…',
    'Measuring twice…',
    'Setting the stones…',
    'Hanging the frames…',
    'Dusting the gallery…',
    'Lighting the lamps…',
    'Rolling out the carpet…',
    'Tuning the scaffolding…',
    'Sweeping the workshop floor…',
    'Sketching the outline…',
    'Carving the details…',
    'Letting the plaster set…',
  ];
  // The preview tab's page: drawn the moment the tab opens, so it is never
  // blank, then only its message changes as the work moves on. The studio
  // lines are typed out, held, erased and replaced, from a shuffled list.
  const waiting = (tab, text) => {
    if (!tab || tab.closed) return;
    let doc;
    try {
      doc = tab.document;
    } catch {
      return;
    }
    const existing = doc.getElementById('text');
    if (existing) {
      existing.textContent = text;
      return;
    }
    stopWaiting();
    const origin = window.location.origin;
    doc.open();
    doc.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1"><title>Building the preview</title>
<style>
html,body{height:100%;margin:0}
body{display:grid;place-items:center;background:#f5f1ea;color:#1a1816;font:300 16px/1.6 "DM Sans",system-ui,sans-serif;-webkit-font-smoothing:antialiased}
.card{width:min(440px,calc(100% - 48px));text-align:center}
.mark{width:120px;aspect-ratio:2856/1479;margin:0 auto 28px;background:#1a1816;-webkit-mask:url(${origin}/assets/img/logo.svg) no-repeat center/contain;mask:url(${origin}/assets/img/logo.svg) no-repeat center/contain}
h1{font:400 1.6rem/1.2 Georgia,serif;margin:0 0 10px}
p{margin:0 0 22px;color:#6d665c}
.bar{height:3px;background:#e6e0d6;overflow:hidden;border-radius:2px}
.bar i{display:block;height:100%;width:40%;background:linear-gradient(90deg,#b08d3f,#d6b35a,#b08d3f);animation:slide 1.3s ease-in-out infinite}
@keyframes slide{from{transform:translateX(-120%)}to{transform:translateX(300%)}}
.line{margin:18px 0 6px;min-height:1.6em;color:#1a1816;white-space:pre}
.caret{display:inline-block;width:1px;height:1.05em;margin-left:2px;vertical-align:-.15em;background:#1a1816;animation:blink 1s steps(1) infinite}
@keyframes blink{50%{opacity:0}}
.time{font-size:.8rem;letter-spacing:.14em;text-transform:uppercase;color:#a99c7d;font-variant-numeric:tabular-nums}
@media(prefers-reduced-motion:reduce){.bar i{animation:none;width:100%}.caret{animation:none}}
</style></head><body><div class="card"><div class="mark"></div>
<h1>Building the preview</h1><p id="text"></p>
<div class="bar"><i></i></div><div class="line"><span id="line"></span><span class="caret"></span></div><div class="time" id="time">0:00</div>
</div></body></html>`);
    doc.close();
    doc.getElementById('text').textContent = text;
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    const started = Date.now();
    let queue = [];
    let last = '';
    const next = () => {
      if (!queue.length) {
        queue = WAIT_LINES.slice();
        for (let i = queue.length - 1; i > 0; i -= 1) {
          const j = Math.floor(Math.random() * (i + 1));
          [queue[i], queue[j]] = [queue[j], queue[i]];
        }
        if (queue[0] === last) queue.push(queue.shift());
      }
      last = queue.shift();
      return last;
    };
    const line = doc.getElementById('line');
    const time = doc.getElementById('time');
    const alive = () => !tab.closed && tab.document.getElementById('time') === time;
    waitTimer = setInterval(() => {
      if (!alive()) return stopWaiting();
      const s = Math.floor((Date.now() - started) / 1000);
      time.textContent = `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
    }, 1000);
    const later = (fn, ms) => {
      waitType = setTimeout(() => (alive() ? fn() : stopWaiting()), ms);
    };
    const type = (word, i = 0) => {
      line.textContent = word.slice(0, i);
      if (i < word.length) later(() => type(word, i + 1), 45 + Math.random() * 40);
      else later(() => erase(word), 1700);
    };
    const erase = (word, i = word.length) => {
      line.textContent = word.slice(0, i);
      if (i > 0) later(() => erase(word, i - 1), 18);
      else later(() => type(next()), 250);
    };
    if (reduced) {
      line.textContent = next();
      waitType = setInterval(() => (alive() ? (line.textContent = next()) : stopWaiting()), 3000);
    } else type(next());
  };

  const sleep = (ms) => new Promise((ok) => setTimeout(ok, ms));

  async function demoPreviewUrl(tab) {
    waiting(
      tab,
      'Building the site with your current edits — about a minute the first time, a few seconds after…',
    );
    const r = await api('/preview', { method: 'POST', body: JSON.stringify(payload()) });
    return r.url.replace(/\/$/, '') + previewPath();
  }
  async function cloudflarePreviewUrl(pending, tab) {
    waiting(
      tab,
      'Your proposed change is being built. The preview opens here as soon as it is ready, usually within two to three minutes.',
    );
    const q = `branch=${encodeURIComponent(pending.branch)}&commit=${encodeURIComponent(pending.commit)}`;
    for (let i = 0; i < 40; i += 1) {
      const r = await api(`/preview-ready?${q}`);
      if (r.ready && r.url) return r.url.replace(/\/$/, '') + previewPath();
      if (r.failed) return null;
      await sleep(10000);
    }
    return null;
  }

  /* Look only: the top-bar button. */
  async function previewCurrent() {
    const btn = $('#preview-btn');
    if (state.dirty) {
      const problems = localProblems();
      if (problems.length) return showProblems(problems, 'previewing');
    }
    const tab = openTab();
    btn.disabled = true;
    try {
      if (state.demo) {
        btn.textContent = 'Building preview…';
        sendTo(tab, await demoPreviewUrl(tab));
        return;
      }
      if (!state.pending) {
        if (tab) tab.close();
        return alertBox(
          'Nothing proposed yet',
          'On staging a preview is built from a proposed change: press Preview & publish, and the preview opens when Cloudflare has built it.',
        );
      }
      btn.textContent = 'Waiting for Cloudflare…';
      const url = await cloudflarePreviewUrl(state.pending, tab);
      if (url) sendTo(tab, url);
      else {
        if (tab) tab.close();
        alertBox(
          'Preview not ready',
          'Cloudflare has not finished building the preview of your proposal yet.',
        );
      }
    } catch (e) {
      if (tab) tab.close();
      alertBox('Preview failed', e.problems ? e.problems.join('\n') : e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Preview this page ↗';
    }
  }

  function decisionDialog({
    title,
    text,
    previewUrl,
    acceptLabel,
    onAccept,
    rejectLabel,
    onReject,
  }) {
    const note = el('p', { class: 'signin-error', role: 'alert' });
    const accept = el('button', { class: 'btn', type: 'button' }, acceptLabel);
    const reject = el('button', { class: 'btn btn-ghost', type: 'button' }, rejectLabel);
    accept.addEventListener('click', decide(accept, [reject], onAccept, note));
    reject.addEventListener('click', decide(reject, [accept], onReject, note));
    $('#result-body').replaceChildren(
      el('h2', {}, title),
      el('p', {}, text),
      previewUrl
        ? el(
            'p',
            {},
            el(
              'a',
              { href: previewUrl, target: '_blank', rel: 'noopener noreferrer' },
              'Open the preview again ↗',
            ),
          )
        : null,
      el('div', { class: 'signin-form' }, accept, reject),
      note,
    );
    $('#result-close').hidden = true;
    $('#result').showModal();
  }
  // A decision button spins and holds the other one until the server answers.
  function decide(button, others, run, note) {
    return async () => {
      if (button.disabled) return;
      note.textContent = '';
      button.disabled = true;
      button.classList.add('is-busy');
      for (const o of others) o.disabled = true;
      try {
        await run(note);
      } finally {
        button.disabled = false;
        button.classList.remove('is-busy');
        for (const o of others) o.disabled = false;
      }
    };
  }
  function closeDialog() {
    state.dialogLocked = false;
    $('#result').close();
    $('#result-close').hidden = false;
    $('#result-x').hidden = false;
    $('#result-close').textContent = 'Close';
    $('#result-close').onclick = () => $('#result').close();
  }
  function doneDialog(title, lines) {
    $('#result-close').hidden = false;
    $('#result-close').disabled = false;
    $('#result-body').replaceChildren(el('h2', {}, title), ...lines.map((l) => el('p', {}, l)));
    $('#result-close').textContent = 'Close';
    $('#result-close').onclick = () => $('#result').close();
    if (!$('#result').open) $('#result').showModal();
  }

  /* ---------- sign-in ----------
     On staging, Cloudflare Access shows its own sign-in page before this one
     loads; the Worker then checks the signed-in email against the editor
     list. This screen covers the two cases the page itself can see: a
     signed-in account that is not an editor, and the local demo's sign-in. */
  function showSignIn(err) {
    stopSessionClock();
    document.body.classList.add('signin');
    const main = $('#main');
    const brand = el(
      'div',
      { class: 'signin-brand' },
      el('div', { class: 'mark', role: 'img', 'aria-label': 'Kalaayana Studios' }),
    );
    const box = el('div', { class: 'signin-card' }, brand);
    const expired = Boolean(err.expired);
    if (err.demo) {
      const input = el('input', {
        type: 'email',
        id: 'signin-email',
        autocomplete: 'email',
        placeholder: 'Email',
        required: '',
        'aria-label': 'Email',
      });
      const note = el(
        'p',
        { class: 'signin-error', role: 'alert' },
        expired ? 'Your session ended. Sign in again.' : '',
      );
      const form = el(
        'form',
        { class: 'signin-form' },
        el('div', { class: 'f' }, input),
        el('button', { class: 'btn', type: 'submit' }, 'Sign in'),
        note,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        note.textContent = '';
        try {
          await api('/login', {
            method: 'POST',
            body: JSON.stringify({ email: input.value.trim() }),
          });
          document.body.classList.remove('signin');
          await load();
        } catch (x) {
          note.textContent = x.message;
        }
      });
      box.append(el('div', { class: 'signin-body' }, el('h1', {}, 'Content admin'), form));
    } else {
      box.append(
        el(
          'div',
          { class: 'signin-body' },
          el('h1', {}, err.status === 403 ? 'Not authorised' : 'Content admin'),
          el(
            'p',
            { class: 'muted' },
            expired
              ? 'Your session ended. Sign in again.'
              : err.email
                ? `${err.email} does not have access.`
                : 'Sign in with your studio email.',
          ),
          el(
            'div',
            { class: 'signin-form' },
            el(
              'button',
              { class: 'btn', type: 'button', onclick: () => accessSignOut() },
              err.status === 403 ? 'Sign in with another account' : 'Sign in',
            ),
          ),
        ),
      );
    }
    main.replaceChildren(box);
    $('#who').textContent = '';
  }

  /* ---------- session clock: one hour, then automatic sign-out ---------- */
  let clockTimer = null;
  function stopSessionClock() {
    if (clockTimer) clearInterval(clockTimer);
    clockTimer = null;
    $('#session').textContent = '';
  }
  async function signOut(reason) {
    stopSessionClock();
    try {
      sessionStorage.removeItem('admin-name');
    } catch {
      /* nothing stored */
    }
    if (state.demo) {
      try {
        await api('/logout', { method: 'POST' });
      } catch {
        /* the cookie expires on its own */
      }
      showSignIn({ demo: true, status: 401, expired: reason === 'expired' });
    } else {
      await accessSignOut();
    }
  }
  // Access's logout drops the browser on the site root. Clear the session
  // without following its redirect, then go to the admin, where Access asks
  // for a fresh sign-in and returns here afterwards.
  async function accessSignOut() {
    try {
      await fetch('/cdn-cgi/access/logout', { credentials: 'include', redirect: 'manual' });
    } catch {
      /* the cookie is cleared by the response even when the redirect is opaque */
    }
    window.location.replace('/admin/');
  }
  function startSessionClock(ends) {
    stopSessionClock();
    const out = $('#session');
    const tick = () => {
      const left = Math.max(0, ends - Date.now());
      if (left === 0) {
        signOut('expired');
        return;
      }
      const m = Math.floor(left / 60000);
      const s = Math.floor((left % 60000) / 1000);
      out.textContent = `Signs out in ${m}:${String(s).padStart(2, '0')}`;
      out.classList.toggle('soon', left < 5 * 60000);
    };
    tick();
    clockTimer = setInterval(tick, 1000);
  }

  /* ---------- dialogs ---------- */
  function alertBox(title, text) {
    $('#result-body').replaceChildren(el('h2', {}, title), el('p', {}, text));
    $('#result-close').textContent = 'Close';
    $('#result-close').onclick = () => $('#result').close();
    $('#result').showModal();
  }
  function confirmBox(title, text, onYes) {
    $('#result-body').replaceChildren(
      el('h2', {}, title),
      el('p', {}, text),
      el(
        'button',
        {
          class: 'btn btn-danger',
          type: 'button',
          onclick: () => {
            $('#result').close();
            onYes();
          },
        },
        'Yes, delete',
      ),
    );
    $('#result-close').textContent = 'Cancel';
    $('#result-close').onclick = () => $('#result').close();
    $('#result').showModal();
  }

  /* ---------- Preview & publish ---------- */
  async function publish() {
    const btn = $('#save');
    const problems = localProblems();
    if (problems.length) return showProblems(problems, 'previewing');
    if (!$('#message').value.trim()) {
      $('#message').focus();
      return alertBox('Say what changed', 'One line, for the log and the commit.');
    }
    btn.disabled = true;
    const tab = openTab();
    try {
      if (state.demo) {
        btn.textContent = 'Building preview…';
        const previewUrl = await demoPreviewUrl(tab);
        sendTo(tab, previewUrl);
        decisionDialog({
          title: 'Does the preview look right?',
          text: 'The page opened in a new tab exactly as the site will show it. Accept to save these changes; keep editing to change them first. Nothing is saved until you accept.',
          previewUrl,
          acceptLabel: 'Accept & save',
          onAccept: async (note) => {
            try {
              const result = await api('/save', {
                method: 'POST',
                body: JSON.stringify({
                  ...payload(),
                  accepted: { at: new Date().toISOString(), previewUrl },
                }),
              });
              doneDialog('Saved', [
                `Saved to the project files (${result.added} photograph(s) added, ${result.removed} deleted), accepted by ${state.email}.`,
                'Logged in CONTENT-LOG.md. The changes are now in git: commit and push to publish.',
              ]);
              await load();
            } catch (e) {
              note.textContent = e.problems ? e.problems.join(' · ') : e.message;
            }
          },
          rejectLabel: 'Keep editing',
          onReject: () => closeDialog(),
        });
        return;
      }
      // Staging: the edit goes to a branch (no pull request yet), Cloudflare
      // builds it, the editor looks, and only Accept opens and merges a pull
      // request. Reject drops the branch and nothing else ever existed.
      btn.textContent = 'Proposing…';
      const proposed = await api('/save', { method: 'POST', body: JSON.stringify(payload()) });
      state.pending = proposed;
      btn.textContent = 'Waiting for Cloudflare…';
      const previewUrl = await cloudflarePreviewUrl(proposed, tab);
      if (previewUrl) sendTo(tab, previewUrl);
      else if (tab) tab.close();
      decisionDialog({
        title: previewUrl ? 'Does the preview look right?' : 'Preview not ready yet',
        text: previewUrl
          ? 'The preview opened in a new tab exactly as staging will show it. Accept to publish it; reject to discard it. Nothing is recorded until you accept.'
          : 'Cloudflare has not finished building the preview. Keep editing and try again in a minute, or reject to discard the proposal.',
        previewUrl,
        acceptLabel: 'Accept & publish',
        onAccept: async (note) => {
          try {
            const r = await api('/accept', {
              method: 'POST',
              body: JSON.stringify({
                branch: proposed.branch,
                title: proposed.title,
                body: proposed.body,
                previewUrl,
              }),
            });
            state.pending = null;
            doneDialog('Accepted', [
              `Accepted by ${r.email} on ${when(r.at)}, recorded on pull request #${r.number}.`,
              r.merged
                ? 'Merged. Staging rebuilds in three or four minutes.'
                : 'It merges itself as soon as the checks pass; staging rebuilds after that.',
            ]);
            await load();
          } catch (e) {
            note.textContent = e.message;
          }
        },
        rejectLabel: 'Reject',
        onReject: async (note) => {
          try {
            const r = await api('/reject', {
              method: 'POST',
              body: JSON.stringify({ branch: proposed.branch, previewUrl }),
            });
            state.pending = null;
            doneDialog('Rejected', [
              `Rejected by ${r.email} on ${when(r.at)}. The proposal is discarded and nothing was published.`,
              'Your edits are still here to change and propose again.',
            ]);
          } catch (e) {
            note.textContent = e.message;
          }
        },
      });
    } catch (e) {
      if (tab) tab.close();
      doneDialog('Not published', [e.message, ...(e.problems || [])]);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Preview & publish';
    }
  }

  /* ---------- boot ---------- */
  /* ---------- skeleton while the content loads ---------- */
  /* The first-load skeleton takes the shape of the tab in the address. */
  function skeleton() {
    readPlace();
    const tab = state.tab;
    for (const t of TABS) document.body.classList.toggle(`tab-${t}`, tab === t);
    const line = (w) => el('span', { class: 'skel skel-line', style: `width:${w}` });
    const card = (h) =>
      el(
        'div',
        { class: 'skel-card' },
        el('span', { class: 'skel skel-thumb', style: `height:${h}px` }),
        line('70%'),
        line('40%'),
      );
    const row = (cols) => el('div', { class: 'skel-trow' }, ...cols.map((w) => line(w)));
    const head = [line('120px'), el('span', { class: 'skel skel-title' }), line('60%')];
    let body;
    if (tab === 'home')
      body = [
        ...head,
        el(
          'div',
          { class: 'skel-works' },
          ...[1, 2, 3, 4, 5].map(() =>
            el(
              'div',
              { class: 'skel-work' },
              el('span', { class: 'skel skel-sq' }),
              el('span', { class: 'skel-lines' }, line('40%'), line('28%')),
            ),
          ),
        ),
      ];
    else if (tab === 'users')
      body = [
        ...head,
        el(
          'div',
          { class: 'skel-table' },
          ...[1, 2, 3].map(() => row(['34%', '18%', '18%', '22%'])),
        ),
        el('span', { class: 'skel skel-title', style: 'width:200px;height:28px;margin-top:36px' }),
        row(['40%', '40%']),
      ];
    else if (tab === 'log')
      body = [
        ...head,
        row(['14%', '14%', '14%', '14%', '14%']),
        el(
          'div',
          { class: 'skel-table' },
          ...[1, 2, 3, 4, 5, 6].map(() => row(['16%', '10%', '26%', '40%'])),
        ),
      ];
    else if (tab === 'insights')
      body = [
        ...head,
        el(
          'div',
          { class: 'tiles' },
          ...[0, 1, 2, 3].map(() =>
            el('div', { class: 'tile' }, line('40%'), el('span', { class: 'skel skel-title' })),
          ),
        ),
        el('span', { class: 'skel', style: 'display:block;height:260px' }),
      ];
    else {
      $('#sections').replaceChildren(
        ...[72, 58, 64, 48, 66].map((w) =>
          el('div', { class: 'skel-row' }, line(`${w}%`), line('14px')),
        ),
      );
      body = [...head, el('div', { class: 'grid' }, ...[260, 180, 220, 300, 200, 240].map(card))];
    }
    $('#main').replaceChildren(
      el('div', { class: 'skel-page', 'aria-hidden': 'true' }, ...body),
      el('p', { class: 'sr-only', role: 'status' }, 'Loading…'),
    );
  }

  async function load() {
    skeleton();
    const data = await api('/content');
    Object.assign(state, {
      email: data.email,
      base: data.base,
      demo: Boolean(data.demo),
      role: data.role || 'admin',
      photoRequired: data.photoRequired !== false,
      canSetPhoto: Boolean(data.canSetPhoto),
      users: data.users || [],
      log: data.log || '',
      decisions: data.decisions || [],
      projects: data.projects,
      sections: data.sections,
      home: data.home || { works: [] },
      projectFiles: new Set(data.projectFiles),
      bannerFiles: new Set(data.bannerFiles),
      uploads: {},
      banners: {},
      bannerCopies: {},
      previews: {},
      dirty: false,
    });
    state.original = snapshot();
    state.adminFetchedAt = Date.now();
    readPlace();
    $('#who').textContent = `${data.email} · ${data.role || 'admin'}`;
    if (data.sessionEnds) startSessionClock(Number(data.sessionEnds));
    document.body.classList.toggle('role-admin', data.role !== 'superadmin');
    document.body.classList.toggle('role-superadmin', data.role === 'superadmin');
    if (data.role !== 'superadmin' && ['home', 'log', 'users'].includes(state.tab))
      state.tab = 'projects';
    $('#base-note').textContent =
      `Editing the ${data.base} branch. Nothing is recorded until you preview and accept; accepting opens and merges a pull request, and staging updates after that.`;
    $('#message').value = '';
    markDirty();
    showTab(state.tab);
    // The page is drawn behind the prompt, so the skeleton never lingers.
    if (!sessionName()) await askWhoIsHere();
    $('#who').textContent = `${sessionName()} · ${data.email} · ${data.role || 'admin'}`;
  }

  $('#result-x').addEventListener('click', closeDialog);
  // Escape closes any dialog except the one asking who is here.
  $('#result').addEventListener('cancel', (e) => {
    e.preventDefault();
    if (!state.dialogLocked) closeDialog();
  });
  $('#new-section').addEventListener('click', newWork);
  $('#preview-btn').addEventListener('click', previewCurrent);
  $('#signout').addEventListener('click', () => signOut('manual'));
  window.addEventListener('hashchange', () => {
    if (!state.email) return;
    readPlace();
    showTab(state.tab);
  });
  $('#tab-home').addEventListener('click', () => showTab('home'));
  $('#tab-log').addEventListener('click', () => showTab('log'));
  $('#tab-users').addEventListener('click', () => showTab('users'));
  $('#tab-insights').addEventListener('click', () => showTab('insights'));
  $('#tab-projects').addEventListener('click', () => showTab('projects'));
  $('#new-project').addEventListener('click', newProjectAnywhere);
  $('#save').addEventListener('click', publish);
  $('#discard').addEventListener('click', () =>
    confirmBox('Discard all unsaved changes?', 'Everything since the last save is lost.', load),
  );
  $('#result-close').addEventListener('click', () => $('#result').close());
  window.addEventListener('beforeunload', (e) => {
    if (state.dirty) e.preventDefault();
  });
  load().catch((e) => {
    if (e.status === 401 || e.status === 403) showSignIn(e);
    else $('#loading').textContent = `Could not load content: ${e.message}`;
  });
})();
