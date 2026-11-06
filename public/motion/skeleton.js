/* Marks each image loaded so skeleton.css can stop its shimmer. Runs after
   the document is parsed (defer); images that finished before then are
   already complete and are marked at once. */
(function () {
  var root = document.documentElement;
  root.classList.add('skel');
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
