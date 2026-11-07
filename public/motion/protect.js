/* No "Save image" menu and no dragging on photographs. Right-clicking text
   or links still works, as do the keyboard and screen readers. A screenshot
   cannot be blocked by a web page; the photographs also carry the studio mark
   and are served at a capped size. */
(function () {
  function onImage(e) {
    var t = e.target;
    return t && t.closest && t.closest('img, picture, video');
  }
  document.addEventListener('contextmenu', function (e) {
    if (onImage(e)) e.preventDefault();
  });
  document.addEventListener('dragstart', function (e) {
    if (onImage(e)) e.preventDefault();
  });
})();
