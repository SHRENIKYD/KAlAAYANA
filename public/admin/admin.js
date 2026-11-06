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

  /* ---------- tabs ---------- */
  const TABS = ['home', 'projects', 'log', 'users'];
  function showTab(tab) {
    state.tab = tab;
    for (const t of TABS) {
      document.body.classList.toggle(`tab-${t}`, tab === t);
      $(`#tab-${t}`).setAttribute('aria-current', tab === t ? 'page' : 'false');
    }
    if (tab === 'home') editHome();
    else if (tab === 'log') showLog();
    else if (tab === 'users') showUsers();
    else
      openSection(
        state.current && state.sections[state.current]
          ? state.current
          : Object.keys(state.sections)[0],
      );
  }

  /* ---------- log (superadmin) ---------- */
  async function refreshAdminData() {
    const data = await api('/content');
    state.users = data.users || [];
    state.log = data.log || '';
    state.decisions = data.decisions || [];
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
      const from = filters.from ? new Date(filters.from + 'T00:00:00') : null;
      const to = filters.to ? new Date(filters.to + 'T23:59:59.999') : null;
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
                  el('time', {}, e.at.replace('T', ' ').slice(0, 19)),
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
                      el('td', {}, d.at?.replace('T', ' ').slice(0, 16) || ''),
                      el('td', {}, el('span', { class: `pill pill-${d.state}` }, d.state)),
                      el('td', {}, d.decidedAt?.replace('T', ' ').slice(0, 16) || '—'),
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
          camNote.textContent = 'A photograph is kept in the log with your name.';
        } catch {
          cam.hidden = true;
          take.hidden = true;
          camNote.textContent = 'No camera available on this device; your name alone is logged.';
        }
      })();
      take.addEventListener('click', () => {
        if (!stream) return;
        canvas.width = 320;
        canvas.height = Math.round((320 * (video.videoHeight || 480)) / (video.videoWidth || 640));
        canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
        photo = canvas.toDataURL('image/jpeg', 0.8);
        shot.src = photo;
        shot.hidden = false;
        video.hidden = true;
        take.hidden = true;
        retake.hidden = false;
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
        el('button', { class: 'btn', type: 'submit' }, 'Continue'),
        note,
      );
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const who = name.value.trim();
        if (!who) return (note.textContent = 'Enter your name.');
        if (stream && !photo) {
          take.click();
        }
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
      $('#result').showModal();
      $('#result').addEventListener('cancel', (e) => e.preventDefault(), { once: true });
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
  async function changeUser(body, note, button) {
    note.textContent = '';
    const label = button ? button.textContent : '';
    if (button) {
      button.disabled = true;
      button.textContent = 'Saving…';
    }
    try {
      const r = await api('/users', { method: 'POST', body: JSON.stringify(body) });
      if (Array.isArray(r.users)) state.users = r.users;
      state.usersPending = r.pr
        ? `Recorded in pull request #${r.pr}; it takes effect once that merges.`
        : '';
      renderUsers();
    } catch (e) {
      note.textContent = e.message;
      if (button) {
        button.disabled = false;
        button.textContent = label;
      }
    }
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
    const note = el('p', { class: 'signin-error', role: 'alert' });
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
    const inviteBtn = el('button', { class: 'btn', type: 'submit' }, 'Invite');
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
          : 'They sign in at the staging address with this email; Cloudflare Access emails them a one-time code. Their email must also be allowed by the Access policy.',
      ),
      note,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      changeUser(
        { action: 'invite', email: email.value.trim(), role: role.value },
        note,
        inviteBtn,
      );
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
            sel.addEventListener('change', () =>
              changeUser({ action: 'role', email: u.email, role: sel.value }, note),
            );
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
              el(
                'td',
                {},
                u.invitedAt
                  ? `${u.invitedAt.replace('T', ' ').slice(0, 16)}${u.invitedBy ? ` by ${u.invitedBy}` : ''}`
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
                        onclick: () =>
                          confirmBox(
                            `Remove ${u.email}?`,
                            'They can no longer sign in to the admin.',
                            () => changeUser({ action: 'remove', email: u.email }, note),
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
    const img = $('.card-thumb', node);
    if (p.images[0]) {
      img.src = imageUrl('projects', p.images[0].file);
      img.alt = p.images[0].alt;
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
            el('img', { src: imageUrl('projects', img.file), alt: '' }),
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
      el('img', { src: imageUrl(w.image.from, w.image.file), alt: '' }),
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
              el('img', { src: imageUrl(w.image.from, w.image.file), alt: '' }),
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
            el('img', { src: imageUrl(w.image.from, w.image.file), alt: '' }),
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
              el('img', { src: bannerSrc(), alt: '' }),
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
  const openTab = () => window.open('', '_blank');
  const sendTo = (tab, url) => {
    if (tab) tab.location.replace(url);
    else window.location.assign(url);
  };
  const waiting = (tab, text) => {
    if (tab) tab.document.write(`<p style="font:16px/1.5 system-ui;padding:24px">${text}</p>`);
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
  async function cloudflarePreviewUrl(number, tab) {
    waiting(
      tab,
      'Cloudflare is building your proposed change. This page will open the preview as soon as it is ready — usually two to three minutes.',
    );
    for (let i = 0; i < 40; i += 1) {
      const r = await api(`/preview-url/${number}`);
      if (r.url) return r.url.replace(/\/$/, '') + previewPath();
      await sleep(15000);
    }
    return null;
  }

  /* Look only: the top-bar button. */
  async function previewCurrent() {
    const btn = $('#preview-btn');
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
      const url = await cloudflarePreviewUrl(state.pending.number, tab);
      if (url) sendTo(tab, url);
      else {
        if (tab) tab.close();
        alertBox(
          'Preview not ready',
          `Cloudflare has not posted a preview for pull request #${state.pending.number} yet.`,
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
      el(
        'div',
        { class: 'signin-form' },
        el('button', { class: 'btn', type: 'button', onclick: () => onAccept(note) }, acceptLabel),
        el(
          'button',
          { class: 'btn btn-ghost', type: 'button', onclick: () => onReject(note) },
          rejectLabel,
        ),
      ),
      note,
    );
    $('#result-close').hidden = true;
    $('#result').showModal();
  }
  function closeDialog() {
    $('#result').close();
    $('#result-close').hidden = false;
    $('#result-close').textContent = 'Close';
    $('#result-close').onclick = () => $('#result').close();
  }
  function doneDialog(title, lines) {
    $('#result-close').hidden = false;
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
              'a',
              { class: 'btn', href: '/cdn-cgi/access/logout' },
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
      window.location.assign('/cdn-cgi/access/logout');
    }
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
      // Staging: propose as a pull request, let Cloudflare build it, then decide.
      btn.textContent = 'Proposing…';
      const proposed = await api('/save', { method: 'POST', body: JSON.stringify(payload()) });
      state.pending = { number: proposed.number, branch: proposed.branch };
      btn.textContent = 'Waiting for Cloudflare…';
      const previewUrl = await cloudflarePreviewUrl(proposed.number, tab);
      if (previewUrl) sendTo(tab, previewUrl);
      else if (tab) tab.close();
      decisionDialog({
        title: previewUrl ? 'Does the preview look right?' : 'Preview not ready yet',
        text: previewUrl
          ? `Pull request #${proposed.number} is proposed and the preview opened in a new tab. Accept to publish it to staging; reject to discard it.`
          : `Pull request #${proposed.number} is proposed but Cloudflare has not posted its preview yet. You can accept once you have checked it on GitHub, or reject.`,
        previewUrl,
        acceptLabel: 'Accept & publish',
        onAccept: async (note) => {
          try {
            const r = await api(`/accept/${proposed.number}`, {
              method: 'POST',
              body: JSON.stringify({ previewUrl }),
            });
            state.pending = null;
            doneDialog('Accepted', [
              `Accepted by ${r.email} at ${r.at}, recorded on pull request #${proposed.number}.`,
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
            const r = await api(`/reject/${proposed.number}`, {
              method: 'POST',
              body: JSON.stringify({ branch: proposed.branch }),
            });
            state.pending = null;
            doneDialog('Rejected', [
              `Rejected by ${r.email} at ${r.at}. Pull request #${proposed.number} is closed and nothing was published.`,
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
  async function load() {
    const data = await api('/content');
    Object.assign(state, {
      email: data.email,
      base: data.base,
      demo: Boolean(data.demo),
      role: data.role || 'admin',
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
    $('#who').textContent = `${data.email} · ${data.role || 'admin'}`;
    if (data.sessionEnds) startSessionClock(Number(data.sessionEnds));
    if (!sessionName()) {
      await askWhoIsHere();
      $('#who').textContent = `${sessionName()} · ${data.email} · ${data.role || 'admin'}`;
    } else $('#who').textContent = `${sessionName()} · ${data.email} · ${data.role || 'admin'}`;
    document.body.classList.toggle('role-admin', data.role !== 'superadmin');
    document.body.classList.toggle('role-superadmin', data.role === 'superadmin');
    if (data.role !== 'superadmin' && ['home', 'log', 'users'].includes(state.tab))
      state.tab = 'projects';
    $('#base-note').textContent =
      `Editing the ${data.base} branch. Saves open a pull request; staging updates once it merges.`;
    $('#message').value = '';
    markDirty();
    showTab(state.tab);
  }

  $('#new-section').addEventListener('click', newWork);
  $('#preview-btn').addEventListener('click', previewCurrent);
  $('#signout').addEventListener('click', () => signOut('manual'));
  $('#tab-home').addEventListener('click', () => showTab('home'));
  $('#tab-log').addEventListener('click', () => showTab('log'));
  $('#tab-users').addEventListener('click', () => showTab('users'));
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
