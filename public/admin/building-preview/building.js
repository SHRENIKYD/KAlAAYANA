/* The page the admin opens while a preview is built. The admin tab that
   opened it writes the current step to window.__previewMessage; this page
   shows it, keeps the elapsed time, and types the studio's lines out one at
   a time from a shuffled list, never the same line twice in a row. When the
   preview is ready the admin sends this tab to it. */
(function () {
  var LINES = [
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
  var text = document.getElementById('text');
  var line = document.getElementById('line');
  var time = document.getElementById('time');
  var started = Date.now();
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
    time.textContent = Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0');
    message();
  }, 500);
  message();

  /* On staging the admin hands over the proposed branch and commit; this
     page asks whether Cloudflare has built it and opens the preview itself,
     even if the admin tab has been paused by the browser. */
  var failed = false;
  var FALLBACK_MS = 150000;
  function poll() {
    var job = null;
    try {
      job = window.opener && window.opener.__previewJob;
    } catch (e) {
      job = null;
    }
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
  function type(word, i) {
    line.textContent = word.slice(0, i);
    if (i < word.length)
      setTimeout(
        function () {
          type(word, i + 1);
        },
        45 + Math.random() * 40,
      );
    else
      setTimeout(function () {
        erase(word, word.length);
      }, 1700);
  }
  function erase(word, i) {
    line.textContent = word.slice(0, i);
    if (i > 0)
      setTimeout(function () {
        erase(word, i - 1);
      }, 18);
    else
      setTimeout(function () {
        type(next(), 0);
      }, 250);
  }
  if (reduced) {
    line.textContent = next();
    setInterval(function () {
      line.textContent = next();
    }, 3000);
  } else type(next(), 0);
})();
