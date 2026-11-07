const menuButton = document.querySelector('.menu');
const menuPanel = document.querySelector('.menu-panel');
const menuClose = document.querySelector('.menu-close');

if (menuButton && menuPanel && menuClose) {
  let previousOverflow = '';
  const setMenu = (open) => {
    if (open === menuPanel.classList.contains('open')) return;
    if (open) previousOverflow = document.body.style.overflow;
    menuPanel.inert = !open;
    menuPanel.classList.toggle('open', open);
    menuPanel.setAttribute('aria-hidden', String(!open));
    menuButton.setAttribute('aria-expanded', String(open));
    document.body.style.overflow = open ? 'hidden' : previousOverflow;
    if (open) menuClose.focus();
    else menuButton.focus({ preventScroll: true });
  };
  menuButton.addEventListener('click', () => setMenu(true));
  menuClose.addEventListener('click', () => setMenu(false));
  menuPanel.querySelectorAll('a').forEach((link) => {
    link.addEventListener('click', () => setMenu(false));
  });
  document.addEventListener('keydown', (event) => {
    if (!menuPanel.classList.contains('open')) return;
    if (event.key === 'Escape') setMenu(false);
    if (event.key !== 'Tab') return;
    const controls = [...menuPanel.querySelectorAll('button, a[href]')];
    const first = controls[0];
    const last = controls[controls.length - 1];
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  });
}

// Section links scroll to their section without leaving "#story" or "#home"
// in the address bar; a link from another page lands on its section and the
// "#..." is then removed the same way.
const sectionFor = (hash) => {
  if (!hash || hash.length < 2) return null;
  try {
    return document.getElementById(decodeURIComponent(hash.slice(1)));
  } catch {
    return null;
  }
};
const dropHash = () => history.replaceState(history.state, '', location.pathname + location.search);
document.addEventListener('click', (event) => {
  if (event.defaultPrevented || event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const link = event.target.closest('a[href*="#"]');
  if (!link || link.origin !== location.origin || link.pathname !== location.pathname) return;
  const target = sectionFor(link.hash);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView();
  if (location.hash) dropHash();
});
if (sectionFor(location.hash)) {
  window.addEventListener('load', () => {
    sectionFor(location.hash)?.scrollIntoView();
    dropHash();
  });
}
