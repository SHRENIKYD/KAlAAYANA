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
        problems: data.problems,
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
                field(
                  'Focus point',
                  {
                    value: s.bannerFocus,
                    placeholder: '50% 16%',
                    oninput: (v) => {
                      s.bannerFocus = v;
                      markDirty();
                    },
                  },
                  'Horizontal and vertical position kept in view when the banner is cropped.',
                ),
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
            ? null
            : el(
                'p',
                {},
                result.autoMerge
                  ? 'The checks are running. When they pass it merges itself and staging rebuilds — allow three or four minutes.'
                  : 'Auto-merge is not enabled on the repository, so merge it on GitHub once the checks pass. Staging rebuilds after the merge.',
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
    $('#loading').textContent = `Could not load content: ${e.message}`;
  });
})();
