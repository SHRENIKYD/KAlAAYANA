/* The page the admin opens while a preview is built. The admin tab that
   opened it writes the current step to window.__previewMessage; this page
   shows it, keeps the elapsed time, and shows the studio's words in the
   style of Claude Code's thinking line. When the
   preview is ready the admin sends this tab to it. */
(function () {
  var LINES = [
    'Sculpting',
    'Chiselling',
    'Moulding',
    'Casting',
    'Gilding',
    'Polishing',
    'Carving',
    'Sketching',
    'Firing the kiln',
    'Plastering',
    'Burnishing',
    'Etching',
    'Glazing',
    'Framing',
    'Mixing colours',
    'Measuring twice',
  ];
  var GLYPHS = ['·', '✢', '✳', '✶', '✻', '✽', '✻', '✶', '✳', '✢'];
  var text = document.getElementById('text');
  var line = document.getElementById('line');
  var time = document.getElementById('time');
  // What this tab is waiting for, and since when, live in its own address
  // (#t=…&b=…&c=…&p=…), so a refresh carries on instead of starting again.
  var saved = {};
  location.hash
    .replace(/^#/, '')
    .split('&')
    .forEach(function (pair) {
      var kv = pair.split('=');
      if (kv[0]) saved[kv[0]] = decodeURIComponent(kv[1] || '');
    });
  var started = Number(saved.t) > 0 && Number(saved.t) <= Date.now() ? Number(saved.t) : Date.now();
  var savedJob =
    saved.b && saved.c ? { branch: saved.b, commit: saved.c, path: saved.p || '/' } : null;
  function remember(job) {
    var h =
      '#t=' +
      started +
      (job
        ? '&b=' +
          encodeURIComponent(job.branch) +
          '&c=' +
          encodeURIComponent(job.commit) +
          '&p=' +
          encodeURIComponent(job.path || '/')
        : '');
    if (location.hash !== h) history.replaceState(null, '', h);
  }
  remember(savedJob);
  var reduced = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  function message() {
    try {
      var m = window.opener && window.opener.__previewMessage;
      if (m && text.textContent !== m) text.textContent = m;
    } catch (e) {
      /* the opener navigated away; keep the last message */
    }
  }
  setInterval(function () {
    var s = Math.floor((Date.now() - started) / 1000);
    time.textContent = '(' + Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0') + ')';
    message();
  }, 500);
  message();

  /* On staging the admin hands over the proposed branch and commit; this
     page asks whether Cloudflare has built it and opens the preview itself,
     even if the admin tab has been paused by the browser. */
  var failed = false;
  var FALLBACK_MS = 150000;
  var toldUnknown = false;
  function poll() {
    var job = null;
    try {
      job = window.opener && window.opener.__previewJob;
    } catch (e) {
      job = null;
    }
    if (job && job.branch && job.commit) {
      savedJob = { branch: job.branch, commit: job.commit, path: job.path || '/' };
      remember(savedJob);
    } else job = savedJob;
    if (job && job.branch && job.commit && !failed) {
      var q =
        'branch=' + encodeURIComponent(job.branch) + '&commit=' + encodeURIComponent(job.commit);
      fetch('/admin/api/preview-ready?' + q, { credentials: 'same-origin', cache: 'no-store' })
        .then(function (r) {
          return r.ok ? r.json() : null;
        })
        .then(function (r) {
          if (!r) return;
          if (r.ready && r.url) {
            var url = r.url.replace(/\/$/, '') + (job.path || '/');
            try {
              window.opener.__previewReadyUrl = url;
            } catch (e) {
              /* the admin is gone; open the preview anyway */
            }
            location.replace(url);
          } else if (r.unknown && r.url && Date.now() - started >= FALLBACK_MS) {
            location.replace(r.url.replace(/\/$/, '') + (job.path || '/'));
          } else if (r.unknown && !toldUnknown) {
            // The build's progress can't be read (the admin's GitHub key has
            // no Checks permission), so say when the preview will open.
            toldUnknown = true;
            text.textContent =
              "Cloudflare's build progress can't be read right now, so the preview opens at about 2:30, when the build is usually done.";
          } else if (r.failed) {
            failed = true;
            text.textContent =
              'The preview build failed. Close this tab and try again from the admin; nothing was published.';
          }
        })
        .catch(function () {});
    }
  }
  setInterval(poll, 8000);
  setTimeout(poll, 4000);

  var queue = [];
  var last = '';
  function next() {
    if (!queue.length) {
      queue = LINES.slice();
      for (var i = queue.length - 1; i > 0; i -= 1) {
        var j = Math.floor(Math.random() * (i + 1));
        var t = queue[i];
        queue[i] = queue[j];
        queue[j] = t;
      }
      if (queue[0] === last) queue.push(queue.shift());
    }
    last = queue.shift();
    return last;
  }
  /* Claude Code's thinking line: a turning star, a word with light passing
     over it, and the time so far. A new word every few seconds, never the
     same one twice in a row. */
  var glyph = document.getElementById('glyph');
  line.textContent = next() + '…';
  if (!reduced) {
    var g = 0;
    setInterval(function () {
      g = (g + 1) % GLYPHS.length;
      glyph.textContent = GLYPHS[g];
    }, 120);
  }
  setInterval(function () {
    line.classList.add('swap');
    setTimeout(function () {
      line.textContent = next() + '…';
      line.classList.remove('swap');
    }, 200);
  }, 3500);
})();
