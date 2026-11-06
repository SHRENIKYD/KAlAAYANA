/* Marks each image loaded so skeleton.css can stop its shimmer. Runs after
   the document is parsed (defer); images that finished before then are
   already complete and are marked at once. */
(function () {
  var root = document.documentElement;
  root.classList.add('skel');

  /* The page skeleton: gone on load, or after 1.8 s at the latest, with a fade. */
  var cleared = false;
  var started = Date.now();
  function clearPage() {
    if (cleared) return;
    cleared = true;
    var remove = function () {
      root.classList.remove('skel-wait', 'skel-done');
      var p = document.querySelector('.pskel');
      if (p && p.parentNode) p.parentNode.removeChild(p);
    };
    /* A page that was ready at once never shows the skeleton: no flash. */
    if (Date.now() - started < 150) return remove();
    root.classList.add('skel-done');
    setTimeout(remove, 280);
  }
  if (root.classList.contains('skel-wait')) {
    var reduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (document.readyState === 'complete' || reduced) clearPage();
    else window.addEventListener('load', clearPage, { once: true });
    setTimeout(clearPage, reduced ? 300 : 1800);
    window.addEventListener('pageshow', function (e) {
      if (e.persisted) clearPage();
    });
  }
  function mark(img) {
    img.classList.add('is-loaded');
  }
  function watch(img) {
    if (img.classList.contains('is-loaded')) return;
    if (img.complete && img.naturalWidth) return mark(img);
    img.addEventListener(
      'load',
      function () {
        mark(img);
      },
      { once: true },
    );
    img.addEventListener(
      'error',
      function () {
        mark(img);
      },
      { once: true },
    );
  }
  Array.prototype.forEach.call(document.images, watch);
  if (window.MutationObserver) {
    new MutationObserver(function (records) {
      records.forEach(function (r) {
        Array.prototype.forEach.call(r.addedNodes, function (n) {
          if (n.nodeType !== 1) return;
          if (n.tagName === 'IMG') watch(n);
          else if (n.querySelectorAll)
            Array.prototype.forEach.call(n.querySelectorAll('img'), watch);
        });
      });
    }).observe(document.body, { childList: true, subtree: true });
  }
})();
