/* Marks each image loaded so skeleton.css can stop its shimmer. Runs after
   the document is parsed (defer); images that finished before then are
   already complete and are marked at once. */
(function () {
  var root = document.documentElement;
  root.classList.add('skel');

  /* The page skeleton is the page itself: the words are hidden by
     skeleton.css and a bar is drawn over each line they occupy, so every page
     shows its own shape. Gone on load, or after 1.8 s at the latest. */
  var layer = null;
  function backgroundIsDark(el) {
    for (var n = el; n && n.nodeType === 1; n = n.parentElement) {
      var c = getComputedStyle(n).backgroundColor.match(/[\d.]+/g);
      if (c && (c.length < 4 || Number(c[3]) > 0.5))
        return 0.299 * c[0] + 0.587 * c[1] + 0.114 * c[2] < 128;
      if (getComputedStyle(n).backgroundImage !== 'none' && n !== document.body) return true;
    }
    return true;
  }
  function drawBars() {
    if (!root.classList.contains('skel-wait') || !document.body) return;
    if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    layer = document.createElement('div');
    layer.className = 'skx';
    layer.setAttribute('aria-hidden', 'true');
    document.body.appendChild(layer);
    var origin = layer.getBoundingClientRect();
    var limit = window.innerHeight * 2;
    var walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    var range = document.createRange();
    var frag = document.createDocumentFragment();
    var shade = new Map();
    var node;
    while ((node = walker.nextNode())) {
      var el = node.parentElement;
      if (!el || !/\S/.test(node.nodeValue)) continue;
      if (el.closest('script,style,noscript,template,[inert],[aria-hidden="true"],.skx')) continue;
      if (
        el.checkVisibility &&
        !el.checkVisibility({ opacityProperty: true, visibilityProperty: true })
      )
        continue;
      range.selectNodeContents(node);
      var rects = range.getClientRects();
      for (var i = 0; i < rects.length; i += 1) {
        var r = rects[i];
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > limit) continue;
        if (!shade.has(el)) shade.set(el, backgroundIsDark(el));
        var h = Math.max(6, r.height * 0.62);
        var bar = document.createElement('i');
        bar.className = shade.get(el) ? 'on-dark' : 'on-light';
        bar.style.cssText =
          'left:' +
          (r.left - origin.left) +
          'px;top:' +
          (r.top - origin.top + (r.height - h) / 2) +
          'px;width:' +
          r.width +
          'px;height:' +
          h +
          'px';
        frag.appendChild(bar);
      }
    }
    layer.appendChild(frag);
  }

  var cleared = false;
  var started = Date.now();
  function clearPage() {
    if (cleared) return;
    cleared = true;
    var remove = function () {
      root.classList.remove('skel-wait', 'skel-done');
      if (layer && layer.parentNode) layer.parentNode.removeChild(layer);
    };
    /* Shown for at least 600 ms so the shape registers, then fades. */
    var wait = Math.max(0, 600 - (Date.now() - started));
    setTimeout(function () {
      root.classList.add('skel-done');
      setTimeout(remove, 280);
    }, wait);
  }
  if (root.classList.contains('skel-wait')) {
    var reduced =
      window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
    drawBars();
    if (document.fonts && document.fonts.ready) document.fonts.ready.then(drawBars);
    window.addEventListener('resize', drawBars);
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
