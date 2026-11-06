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
    editing: null,
    demo: false,
    lastPr: null,
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

  async function api(path, init) {
    const res = await fetch(`/admin/api${path}`, {
      ...init,
      headers: { 'content-type': 'application/json', ...(init?.headers || {}) },
    });
    const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
    if (!res.ok)
      throw Object.assign(new Error(data.error || `HTTP ${res.status}`), {
        status: res.status,
        problems: data.problems,
        demo: data.demo,
        email: data.email,
      });
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
  function showTab(tab) {
    state.tab = tab;
    document.body.classList.toggle('tab-home', tab === 'home');
    document.body.classList.toggle('tab-projects', tab === 'projects');
    $('#tab-home').setAttribute('aria-current', tab === 'home' ? 'page' : 'false');
    $('#tab-projects').setAttribute('aria-current', tab === 'projects' ? 'page' : 'false');
    if (tab === 'home') editHome();
    else
      openSection(
        state.current && state.sections[state.current]
          ? state.current
          : Object.keys(state.sections)[0],
      );
  }

  /* ---------- sections sidebar ---------- */
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
          el(
            'button',
            { class: 'btn btn-ghost', type: 'button', onclick: () => editSection(key) },
            'Edit work',
          ),
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
          isNew
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

  /* ---------- framing ----------
     The photograph is shown whole, with the crop the site will use drawn over
     it. Drag the frame to the part that should show. One frame per layout
     (desktop, phone); the position is saved as the image's focus point. */
  function focusPicker({ src, get, set, crops }) {
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
      const fw = Math.min(W, H * r);
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
      paint();
      markDirty();
    });

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
            { class: `image work${w.image.file in state.uploads ? ' new' : ''}` },
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
              focusPicker({
                src: imageUrl(w.image.from, w.image.file),
                get: () => w.image.focus || '50% 48%',
                set: (v) => {
                  w.image.focus = v;
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
      (state.home.works ||= []).push({
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

  /* ---------- preview this page ----------
     The page being edited, as the site will show it. In the demo the real
     site is built from the current edits, saved or not. On staging a save
     is needed first: Cloudflare builds the pull request's branch and posts
     the URL on it, which the Worker reads back. */
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
  async function previewCurrent() {
    const btn = $('#preview-btn');
    const tab = window.open('', '_blank');
    const show = (html) => {
      if (tab) tab.document.write(html);
    };
    btn.disabled = true;
    try {
      if (state.demo) {
        btn.textContent = 'Building preview…';
        show(
          '<p style="font:16px/1.5 system-ui;padding:24px">Building the site with your current edits — about a minute the first time, a few seconds after…</p>',
        );
        const r = await api('/preview', { method: 'POST', body: JSON.stringify(payload()) });
        const url = r.url.replace(/\/$/, '') + previewPath();
        if (tab) tab.location.replace(url);
        else window.location.assign(url);
        return;
      }
      if (!state.lastPr) {
        if (tab) tab.close();
        return alertBox(
          'Save first',
          'On staging the preview is built from your saved changes: save, and Cloudflare builds this page within a few minutes.',
        );
      }
      btn.textContent = 'Waiting for Cloudflare…';
      show(
        '<p style="font:16px/1.5 system-ui;padding:24px">Cloudflare is building your saved changes. This page will open the preview as soon as it is ready — usually two to three minutes.</p>',
      );
      for (let i = 0; i < 40; i += 1) {
        const r = await api(`/preview-url/${state.lastPr}`);
        if (r.url) {
          const url = r.url.replace(/\/$/, '') + previewPath();
          if (tab) tab.location.replace(url);
          else window.location.assign(url);
          return;
        }
        await new Promise((ok) => setTimeout(ok, 15000));
      }
      if (tab) tab.close();
      alertBox(
        'Preview not ready',
        `Cloudflare has not posted a preview for pull request #${state.lastPr} yet. Check the pull request on GitHub.`,
      );
    } catch (e) {
      if (tab) tab.close();
      alertBox('Preview failed', e.problems ? e.problems.join('\n') : e.message);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Preview this page ↗';
    }
  }

  /* ---------- sign-in ----------
     On staging, Cloudflare Access shows its own sign-in page before this one
     loads; the Worker then checks the signed-in email against the editor
     list. This screen covers the two cases the page itself can see: a
     signed-in account that is not an editor, and the local demo's sign-in. */
  function showSignIn(err) {
    document.body.classList.add('signin');
    const main = $('#main');
    const box = el('div', { class: 'signin-card' });
    if (err.demo) {
      const input = el('input', {
        type: 'email',
        id: 'signin-email',
        autocomplete: 'email',
        placeholder: 'you@kalaayanastudios.com',
        required: '',
      });
      const note = el('p', { class: 'signin-error', role: 'alert' });
      const form = el(
        'form',
        { class: 'signin-form' },
        el('div', { class: 'f' }, el('label', { for: 'signin-email' }, 'Studio email'), input),
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
      box.append(
        el('p', { class: 'eyebrow' }, 'Content admin'),
        el('h1', {}, 'Sign in'),
        el(
          'p',
          { class: 'muted' },
          'Only authorised studio accounts can edit the site. Anyone else is turned away here.',
        ),
        form,
        el(
          'p',
          { class: 'muted signin-small' },
          'Local demo: on staging this page is Cloudflare Access, which sends a one-time code to the email.',
        ),
      );
    } else {
      box.append(
        el('p', { class: 'eyebrow' }, 'Content admin'),
        el('h1', {}, err.status === 403 ? 'Not authorised' : 'Sign in'),
        el(
          'p',
          { class: 'muted' },
          err.email
            ? `${err.email} is signed in but is not on the editor list. Ask the studio to add it, or sign in with another account.`
            : 'Only authorised studio accounts can edit the site. Sign in with your studio email to continue.',
        ),
        el(
          'div',
          { class: 'signin-form' },
          el('a', { class: 'btn', href: '/cdn-cgi/access/logout' }, 'Sign in with another account'),
          el('a', { class: 'btn btn-ghost', href: '/' }, 'Back to the site'),
        ),
      );
    }
    main.replaceChildren(box);
    $('#who').textContent = err.email || '';
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

  /* ---------- save ---------- */
  async function save() {
    const btn = $('#save');
    btn.disabled = true;
    btn.textContent = 'Saving…';
    try {
      const result = await api('/save', {
        method: 'POST',
        body: JSON.stringify(payload()),
      });
      if (result.number) state.lastPr = result.number;
      $('#result-body').replaceChildren(
        ...[
          el('h2', {}, 'Saved'),
          result.demo
            ? el(
                'p',
                {},
                `Demo mode: written to ${result.folder} in the project folder (${result.added} image(s) added, ${result.removed} marked for removal). Nothing was committed.`,
              )
            : el(
                'p',
                {},
                'Your changes are in ',
                el(
                  'a',
                  { href: result.url, target: '_blank', rel: 'noopener noreferrer' },
                  `pull request #${result.number}`,
                ),
                '.',
              ),
          result.demo
            ? el(
                'p',
                {},
                'Preview this page shows the site exactly as it will look with these changes.',
              )
            : el(
                'p',
                {},
                result.autoMerge
                  ? 'The checks are running. When they pass it merges itself and staging rebuilds — allow three or four minutes.'
                  : 'Auto-merge is not enabled on the repository, so merge it on GitHub once the checks pass. Staging rebuilds after the merge.',
              ),
          result.demo
            ? el(
                'button',
                { class: 'btn', type: 'button', onclick: previewCurrent },
                'Preview this page ↗',
              )
            : el(
                'p',
                {},
                'Preview this page (top right) opens the page as it will look once Cloudflare has built this pull request — usually two to three minutes.',
              ),
        ].filter(Boolean),
      );
      $('#result-close').textContent = 'Close';
      $('#result-close').onclick = () => $('#result').close();
      $('#result').showModal();
      await load();
    } catch (e) {
      $('#result-body').replaceChildren(
        el('h2', {}, 'Not saved'),
        el('p', {}, e.message),
        e.problems
          ? el(
              'ul',
              {},
              e.problems.map((m) => el('li', {}, m)),
            )
          : null,
      );
      $('#result-close').textContent = 'Close';
      $('#result-close').onclick = () => $('#result').close();
      $('#result').showModal();
    } finally {
      btn.disabled = false;
      btn.textContent = 'Save & publish to staging';
    }
  }

  /* ---------- boot ---------- */
  async function load() {
    const data = await api('/content');
    Object.assign(state, {
      email: data.email,
      base: data.base,
      demo: Boolean(data.demo),
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
    $('#who').textContent = data.email;
    $('#base-note').textContent =
      `Editing the ${data.base} branch. Saves open a pull request; staging updates once it merges.`;
    $('#message').value = '';
    markDirty();
    showTab(state.tab);
  }

  $('#new-section').addEventListener('click', newWork);
  $('#preview-btn').addEventListener('click', previewCurrent);
  $('#tab-home').addEventListener('click', () => showTab('home'));
  $('#tab-projects').addEventListener('click', () => showTab('projects'));
  $('#new-project').addEventListener('click', newProjectAnywhere);
  $('#save').addEventListener('click', save);
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
