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
