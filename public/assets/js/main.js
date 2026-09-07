(function () {
  'use strict';
  var reduced = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  var yearEl = document.getElementById('year');
  if (yearEl) { yearEl.textContent = new Date().getFullYear(); }

  /* ---------- hero title split ---------- */
  var title = document.querySelector('[data-split]');
  if (title) {
    var words = title.textContent.trim().split(/\s+/);
    title.textContent = '';
    var i = 0;
    words.forEach(function (word, w) {
      var wordEl = document.createElement('span');
      wordEl.className = 'word';
      word.split('').forEach(function (ch) {
        var s = document.createElement('span');
        s.className = 'ch';
        s.textContent = ch;
        s.style.transitionDelay = (i++ * 45) + 'ms';
        wordEl.appendChild(s);
      });
      title.appendChild(wordEl);
      if (w < words.length - 1) title.appendChild(document.createTextNode(' '));
    });
    requestAnimationFrame(function () { title.classList.add('in'); });
  }

  /* ---------- reveal on scroll ---------- */
  var revealables = document.querySelectorAll('[data-reveal]');
  if ('IntersectionObserver' in window && !reduced) {
    var revealObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        var el = entry.target;
        el.style.transitionDelay = (el.dataset.delay || 0) + 'ms';
        el.classList.add('in');
        revealObserver.unobserve(el);
      });
    }, { threshold: 0.14, rootMargin: '0px 0px -8% 0px' });
    revealables.forEach(function (el) { revealObserver.observe(el); });
  } else {
    revealables.forEach(function (el) { el.classList.add('in'); });
  }

  /* ---------- counters ---------- */
  var counters = document.querySelectorAll('[data-count]');
  function runCount(el) {
    var target = parseFloat(el.dataset.count);
    var suffix = el.dataset.suffix || '';
    if (reduced) { el.textContent = target + suffix; return; }
    var start = null, dur = 1400;
    function step(ts) {
      if (!start) start = ts;
      var p = Math.min((ts - start) / dur, 1);
      var eased = 1 - Math.pow(1 - p, 3);
      el.textContent = Math.round(target * eased) + suffix;
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  }
  if ('IntersectionObserver' in window) {
    var countObserver = new IntersectionObserver(function (entries) {
      entries.forEach(function (entry) {
        if (!entry.isIntersecting) return;
        runCount(entry.target);
        countObserver.unobserve(entry.target);
      });
    }, { threshold: 0.6 });
    counters.forEach(function (el) { countObserver.observe(el); });
  } else {
    counters.forEach(runCount);
  }

  /* ---------- scroll driven: progress, header, parallax, nav state ---------- */
  var header = document.getElementById('siteHeader');
  var progress = document.getElementById('scrollProgress');
  var parallaxEls = document.querySelectorAll('[data-parallax]');
  var sections = Array.prototype.slice.call(document.querySelectorAll('section[id]'));
  var navLinks = Array.prototype.slice.call(document.querySelectorAll('.nav a'));
  var ticking = false;

  function onScroll() {
    var y = window.pageYOffset;
    var max = document.documentElement.scrollHeight - window.innerHeight;
    if (progress) { progress.style.width = (max > 0 ? (y / max) * 100 : 0) + '%'; }
    if (header) { header.classList.toggle('solid', y > 60); }

    if (!reduced) {
      parallaxEls.forEach(function (el) {
        el.style.transform = 'translate3d(0,' + (y * parseFloat(el.dataset.parallax)) + 'px,0)';
      });
    }

    var current = '';
    sections.forEach(function (sec) {
      if (sec.offsetTop - window.innerHeight * 0.35 <= y) current = sec.id;
    });
    navLinks.forEach(function (a) {
      a.classList.toggle('active', a.getAttribute('href') === '#' + current);
    });
    ticking = false;
  }
  window.addEventListener('scroll', function () {
    if (!ticking) { ticking = true; requestAnimationFrame(onScroll); }
  }, { passive: true });
  onScroll();

  /* ---------- mobile nav ---------- */
  var toggle = document.getElementById('navToggle');
  var nav = document.getElementById('nav');
  if (toggle && nav) { toggle.addEventListener('click', function () {
    var open = nav.classList.toggle('open');
    toggle.classList.toggle('open', open);
    toggle.setAttribute('aria-expanded', String(open));
  }); }
  navLinks.forEach(function (a) {
    a.addEventListener('click', function () {
      if (!nav || !toggle) { return; }
      nav.classList.remove('open');
      toggle.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
    });
  });

  /* ---------- in-page links scroll without stamping a #hash on the URL ---------- */
  document.querySelectorAll('a[href^="#"]').forEach(function (a) {
    a.addEventListener('click', function (e) {
      var id = a.getAttribute('href').slice(1);
      var target = id ? document.getElementById(id) : null;
      if (!target) { return; }            /* unresolved: leave it to the browser */
      e.preventDefault();
      target.scrollIntoView({ behavior: reduced ? 'auto' : 'smooth', block: 'start' });
    });
  });
  /* A deep link still works: it scrolls, then the hash is dropped from the URL.
     Covers a fresh load and any later fragment navigation, such as back/forward. */
  function dropHash() {
    if (!location.hash) { return; }
    var target = document.getElementById(location.hash.slice(1));
    if (target) { target.scrollIntoView({ behavior: 'auto', block: 'start' }); }
    history.replaceState(null, '', location.pathname + location.search);
  }
  window.addEventListener('hashchange', dropHash);
  dropHash();

  /* ---------- pointer tilt on cards ---------- */
  if (!reduced && window.matchMedia('(hover: hover)').matches) {
    document.querySelectorAll('[data-tilt]').forEach(function (card) {
      card.addEventListener('pointermove', function (e) {
        var r = card.getBoundingClientRect();
        var rx = ((e.clientY - r.top) / r.height - 0.5) * -5;
        var ry = ((e.clientX - r.left) / r.width - 0.5) * 5;
        card.style.transform = 'perspective(900px) rotateX(' + rx + 'deg) rotateY(' + ry + 'deg) translateY(-6px)';
      });
      card.addEventListener('pointerleave', function () { card.style.transform = ''; });
    });
  }

  /* ---------- lightbox ---------- */
  var lb = document.getElementById('lightbox');
  var lbImg = document.getElementById('lightboxImg');
  var lbCap = document.getElementById('lightboxCap');
  if (lb && lbImg && lbCap) {
  function closeLb() { lb.classList.remove('open'); lb.setAttribute('aria-hidden', 'true'); }
  document.querySelectorAll('.card-media').forEach(function (media) {
    if (media.closest('a')) { return; }   /* a linked card navigates instead */
    media.addEventListener('click', function () {
      var img = media.querySelector('img');
      var body = media.parentElement.querySelector('.card-body h3');
      lbImg.src = img.src;
      lbImg.alt = img.alt;
      lbCap.textContent = body ? body.textContent : '';
      lb.classList.add('open');
      lb.setAttribute('aria-hidden', 'false');
    });
  });
  var lbClose = document.getElementById('lightboxClose');
  if (lbClose) { lbClose.addEventListener('click', closeLb); }
  lb.addEventListener('click', function (e) { if (e.target === lb) closeLb(); });
  document.addEventListener('keydown', function (e) { if (e.key === 'Escape') closeLb(); });
  }
})();
