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
    previews: {},
    current: null,
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
    });
  const slugify = (s) =>
    s
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
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

  /* ---------- sections sidebar ---------- */
  function renderSections() {
    const nav = $('#sections');
    nav.replaceChildren(
      el(
        'button',
        {
          type: 'button',
          'aria-current': String(state.view === 'home'),
          onclick: editHome,
        },
        el('span', {}, 'Homepage'),
        el('b', {}, String((state.home?.works || []).length)),
      ),
      ...Object.entries(state.sections).map(([key, s]) =>
        el(
          'button',
          {
            type: 'button',
            'aria-current': String(state.view === 'section' && state.current === key),
            onclick: () => openSection(key),
          },
          el('span', {}, s.title),
          el('b', {}, String(state.projects.filter((p) => p.group === key).length)),
        ),
      ),
    );
  }

  /* ---------- section view ---------- */
  function openSection(key) {
    state.view = 'section';
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
          el('h1', {}, s.title),
          el('p', { class: 'muted' }, s.lede),
        ),
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            { class: 'btn btn-ghost', type: 'button', onclick: () => editSection(key) },
            'Edit section',
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
    state.current = p.group;
    let slugLocked = !isNew;
    let slugField;
    const main = $('#main');
    const imagesBox = el('div', { class: 'images' });

    const renderImages = () => {
      imagesBox.replaceChildren(
        ...p.images.map((img, i) =>
          el(
            'div',
            { class: `image${img.file in state.uploads ? ' new' : ''}` },
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
          el('p', { class: 'eyebrow' }, state.sections[p.group].title),
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
                  const o = el('option', { value: k }, s.title);
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

  /* ---------- focus point ----------
     Click the photograph where the subject is. The crops on the right show how
     the site will frame it at the given aspect ratios. */
  function focusPicker({ src, get, set, crops }) {
    const img = el('img', { src, alt: '' });
    const dot = el('div', { class: 'focus-dot' });
    const stage = el('div', { class: 'focus-stage' }, img, dot);
    const value = el('span', { class: 'focus-value' });
    const cropImgs = crops.map(([label, ratio]) => {
      const c = el('img', { src, alt: '' });
      c.style.aspectRatio = ratio;
      return [c, el('div', { class: 'focus-crop' }, c, el('span', {}, label))];
    });
    const paint = () => {
      const f = get() || '50% 50%';
      const [x, y] = f.split(' ');
      dot.style.left = x;
      dot.style.top = y;
      value.textContent = `Focus ${f}`;
      for (const [c] of cropImgs) c.style.objectPosition = f;
    };
    stage.addEventListener('click', (e) => {
      const r = img.getBoundingClientRect();
      const x = Math.round(Math.min(100, Math.max(0, ((e.clientX - r.left) / r.width) * 100)));
      const y = Math.round(Math.min(100, Math.max(0, ((e.clientY - r.top) / r.height) * 100)));
      set(`${x}% ${y}%`);
      paint();
      markDirty();
    });
    paint();
    return el(
      'div',
      { class: 'f' },
      el('label', {}, 'Framing'),
      el(
        'div',
        { class: 'focus' },
        stage,
        el('div', { class: 'focus-crops' }, ...cropImgs.map(([, box]) => box)),
        value,
        el('small', {}, 'Click the photograph where the subject is. The crops follow.'),
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
          label: `${sec.title} banner — ${sec.banner}`,
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
                    ...Object.entries(state.sections).map(([k, sec]) => [`/${k}/`, sec.title]),
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
                'Drop a new photograph for this feature',
                async (files) => {
                  if (!files[0]) return;
                  const ext = files[0].type === 'image/png' ? 'png' : 'jpg';
                  const name = nextImageName(
                    `home-${slugify(w.title || 'feature') || 'feature'}`,
                    ext,
                  );
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
                'Remove',
              ),
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
            'The features under WORKS on the homepage, in this order. Each links to a section or to Collectables.',
          ),
        ),
        el(
          'div',
          { class: 'actions' },
          el(
            'button',
            {
              class: 'btn',
              type: 'button',
              onclick: () => {
                const first = imageChoices()[0];
                works.push({
                  href: Object.keys(state.sections).length
                    ? `/${Object.keys(state.sections)[0]}/`
                    : '/collectables/',
                  eyebrow: '',
                  title: '',
                  link: 'Discover collection',
                  image: first
                    ? { from: first.from, file: first.file, alt: first.alt }
                    : { from: 'projects', file: '', alt: '' },
                });
                render();
                markDirty();
                list.lastElementChild?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              },
            },
            '+ New feature',
          ),
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
    state.current = key;
    const bannerBox = el('div', { class: 'images' });
    const renderBanner = () => {
      const have = state.bannerFiles.has(s.banner) || s.banner in state.banners;
      bannerBox.replaceChildren(
        have
          ? el(
              'div',
              { class: `image${s.banner in state.banners ? ' new' : ''}` },
              el('img', { src: imageUrl('sections', s.banner), alt: '' }),
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
                  src: imageUrl('sections', s.banner),
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
          el('p', { class: 'eyebrow' }, isNew ? 'New section' : 'Edit section'),
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
                      `Delete section “${s.title}”?`,
                      'Its page is removed from the site on save.',
                      () => {
                        delete state.sections[key];
                        delete state.banners[s.banner];
                        markDirty();
                        openSection(Object.keys(state.sections)[0]);
                      },
                    ),
                },
                'Delete section',
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
          field('Title', {
            value: s.title,
            required: true,
            oninput: (v) => {
              s.title = v;
              markDirty();
            },
          }),
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
          dropZone(
            'Drop the banner photograph here, or click to choose',
            async (files) => {
              if (!files[0]) return;
              const ext = files[0].type === 'image/png' ? 'png' : 'jpg';
              delete state.banners[s.banner];
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

  function newSection() {
    const box = el('div', { class: 'form' });
    let key = '';
    const dlg = $('#result');
    $('#result-body').replaceChildren(
      el('h2', {}, 'New section'),
      field(
        'Key (URL)',
        {
          value: '',
          required: true,
          placeholder: 'gardens',
          oninput: (v) => {
            key = slugify(v);
          },
        },
        'Becomes /<key>/ and the section id. Lowercase letters, digits, hyphens.',
      ),
      box,
    );
    $('#result-close').textContent = 'Create';
    $('#result-close').onclick = () => {
      if (!key || state.sections[key]) return;
      dlg.close();
      $('#result-close').textContent = 'Close';
      $('#result-close').onclick = () => dlg.close();
      editSection(key, true);
    };
    dlg.showModal();
  }

  /* ---------- demo preview build ---------- */
  async function buildPreview() {
    const body = $('#result-body');
    body.replaceChildren(
      el('h2', {}, 'Building preview'),
      el('p', {}, 'Running the real site build with your saved changes…'),
    );
    $('#result-close').hidden = true;
    try {
      const r = await api('/preview', { method: 'POST' });
      body.replaceChildren(
        el('h2', {}, 'Preview ready'),
        el(
          'p',
          {},
          el(
            'a',
            { href: r.url, target: '_blank', rel: 'noopener noreferrer' },
            'Open the preview site ↗',
          ),
        ),
        el(
          'p',
          { class: 'muted' },
          `Built in ${r.seconds}s from the saved changes. Close this to keep editing.`,
        ),
      );
      const bar = $('#preview-link');
      if (bar) {
        bar.href = r.url;
        bar.hidden = false;
      }
    } catch (e) {
      body.replaceChildren(el('h2', {}, 'Preview failed'), el('pre', {}, e.message));
    } finally {
      $('#result-close').hidden = false;
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
        body: JSON.stringify({
          projects: state.projects,
          sections: state.sections,
          home: state.home,
          uploads: state.uploads,
          banners: state.banners,
          message: $('#message').value,
        }),
      });
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
                'To see exactly how the site looks with these changes, build a preview — it takes about a minute.',
              )
            : el(
                'p',
                {},
                result.autoMerge
                  ? 'The checks are running. When they pass it merges itself and staging rebuilds — allow three or four minutes.'
                  : 'Auto-merge is not enabled on the repository, so merge it on GitHub once the checks pass. Staging rebuilds after the merge.',
              ),
          result.demo
            ? el('button', { class: 'btn', type: 'button', onclick: buildPreview }, 'Preview site')
            : el(
                'p',
                {},
                'Preview: Cloudflare builds this pull request\u2019s branch and posts the preview link as a comment on it within a few minutes. That is the site exactly as it will look.',
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
      projects: data.projects,
      sections: data.sections,
      home: data.home || { works: [] },
      projectFiles: new Set(data.projectFiles),
      bannerFiles: new Set(data.bannerFiles),
      uploads: {},
      banners: {},
      previews: {},
      dirty: false,
    });
    state.original = snapshot();
    $('#who').textContent = data.email;
    $('#base-note').textContent =
      `Editing the ${data.base} branch. Saves open a pull request; staging updates once it merges.`;
    $('#message').value = '';
    markDirty();
    openSection(
      state.current && state.sections[state.current]
        ? state.current
        : Object.keys(state.sections)[0],
    );
  }

  $('#new-section').addEventListener('click', newSection);
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
