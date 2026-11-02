const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const clamp = (number, min = 0, max = 1) => Math.min(max, Math.max(min, number));
const lerp = (start, end, amount) => start + (end - start) * amount;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const cursor = $('.cursor');
if (!reduced) {
  let mouseX = -100,
    mouseY = -100,
    cursorX = -100,
    cursorY = -100;
  addEventListener('pointermove', (event) => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  $$('.collection-feature').forEach((element) => {
    element.addEventListener('mouseenter', () => cursor.classList.add('view'));
    element.addEventListener('mouseleave', () => cursor.classList.remove('view'));
  });
  const moveCursor = () => {
    cursorX = lerp(cursorX, mouseX, 0.16);
    cursorY = lerp(cursorY, mouseY, 0.16);
    cursor.style.transform = `translate(${cursorX}px,${cursorY}px) translate(-50%,-50%)`;
    requestAnimationFrame(moveCursor);
  };
  moveCursor();
}

const render = () => {
  const hero = $('.hero');
  const heroProgress = clamp(-hero.getBoundingClientRect().top / (hero.offsetHeight - innerHeight));
  $('[data-zoom]').style.transform = `scale(${1 + heroProgress * 0.18})`;
  $('.hero-title').style.transform =
    `translate3d(0,${-heroProgress * 150}px,0) scale(${1 + heroProgress * 0.08})`;
  $('.hero-title').style.opacity = 1 - heroProgress;
  const heroOrbit = $('.hero-orbit');
  if (heroOrbit) heroOrbit.style.transform = `rotate(${heroProgress * 240}deg)`;

  requestAnimationFrame(render);
};

if (!reduced) requestAnimationFrame(render);
