/* Blank the screen on the keys that start a screenshot.
   Windows: Print Screen, and the Windows key with Shift (Win+Shift+S).
   Mac: Command with Shift (Cmd+Shift+3, 4 or 5).
   The page goes blank before the capture key lands and stays blank for a few
   seconds, long enough to cover dragging a selection. After Print Screen the
   clipboard is also cleared, which removes the picture Windows put there.
   Phones, tablets and screenshot tools started any other way never tell a web
   page, so they cannot be caught; the photographs carry the studio mark for
   those. Switched by the "blankOnScreenshot" feature flag. */
(function () {
  var HOLD_MS = 5000;
  var timer = null;
  var cover = null;

  function show() {
    if (!cover) {
      cover = document.createElement('div');
      cover.setAttribute('aria-hidden', 'true');
      cover.style.cssText =
        'position:fixed;inset:0;z-index:2147483647;background:#0b0a09;' +
        'display:grid;place-items:center;color:#a99c7d;' +
        'font:400 13px/1.4 system-ui,sans-serif;letter-spacing:.14em;text-transform:uppercase';
      cover.textContent = 'Kalaayana Studios';
    }
    if (!cover.parentNode) document.documentElement.appendChild(cover);
    clearTimeout(timer);
    timer = setTimeout(hide, HOLD_MS);
  }
  function hide() {
    if (cover && cover.parentNode) cover.parentNode.removeChild(cover);
  }
  function clearClipboard() {
    try {
      if (navigator.clipboard && navigator.clipboard.writeText)
        navigator.clipboard.writeText('').catch(function () {});
    } catch (e) {
      /* not allowed here; the blank screen still applies */
    }
  }

  function onKey(e) {
    var k = e.key;
    if (k === 'PrintScreen' || e.code === 'PrintScreen') {
      show();
      if (e.type === 'keyup') clearClipboard();
      return;
    }
    if (e.type !== 'keydown') return;
    // Windows key + Shift, or Command + Shift, in either order.
    var meta = e.metaKey || k === 'Meta' || k === 'OS';
    var shift = e.shiftKey || k === 'Shift';
    if (meta && shift && (k === 'Meta' || k === 'OS' || k === 'Shift' || /^[345sS]$/.test(k))) {
      show();
      return;
    }
    // Any other key after Cmd/Win+Shift is an ordinary shortcut (reopen tab,
    // redo...): bring the page straight back.
    if (cover && cover.parentNode) {
      clearTimeout(timer);
      hide();
    }
  }
  window.addEventListener('keydown', onKey, true);
  window.addEventListener('keyup', onKey, true);
})();
