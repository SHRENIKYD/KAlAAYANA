const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const clamp = (number, min = 0, max = 1) => Math.min(max, Math.max(min, number));
const lerp = (start, end, amount) => start + (end - start) * amount;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

const cursor = $('.cursor');
if (!reduced) {
  let mouseX = -100, mouseY = -100, cursorX = -100, cursorY = -100;
  addEventListener('pointermove', event => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  $$('.collection-feature').forEach(element => {
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

// Derived from the document, not hand-listed: the meter reads the last section
// whose top has passed 52% of the viewport, which only works if the array is in
// document order. A fixed list broke on both counts — it named five of the eight
// sections, so the meter never passed 05, and moving a section would have put it
// out of order.
const sections = [...document.querySelectorAll('main > section')];
let previousScroll = scrollY;
let velocity = 0;

const render = () => {
  const scrollTop = scrollY;
  velocity = lerp(velocity, scrollTop - previousScroll, 0.12);
  previousScroll = scrollTop;
  const scrollRange = document.documentElement.scrollHeight - innerHeight;
  $('.scroll-progress').style.width = `${scrollTop / scrollRange * 100}%`;
  const nav = $('.nav');
  nav.classList.toggle('hidden', velocity > 1.8 && scrollTop > innerHeight);
  if (velocity < -1) nav.classList.remove('hidden');
  let activeSection = 0;
  sections.forEach((section, index) => { if (section.getBoundingClientRect().top < innerHeight * 0.52) activeSection = index; });
  $('.section-meter b').textContent = String(activeSection + 1).padStart(2, '0');
  $('.section-meter').style.setProperty('--meter', `${(activeSection + 1) / sections.length * 100}%`);

  const hero = $('.hero');
  const heroProgress = clamp(-hero.getBoundingClientRect().top / (hero.offsetHeight - innerHeight));
  $('[data-zoom]').style.transform = `scale(${1 + heroProgress * 0.18})`;
  $('[data-zoom]').style.clipPath = `inset(${6 - heroProgress * 6}% ${5 - heroProgress * 5}%)`;
  $('.hero-title').style.transform = `translate3d(0,${-heroProgress * 150}px,0) scale(${1 + heroProgress * 0.08})`;
  $('.hero-title').style.opacity = 1 - heroProgress;
  const heroOrbit = $('.hero-orbit');
  if (heroOrbit) heroOrbit.style.transform = `rotate(${heroProgress * 240}deg)`;

  const material = $('.material');
  const materialProgress = clamp((innerHeight - material.getBoundingClientRect().top) / (material.offsetHeight + innerHeight));
  $('.material-bg').style.transform = `translateY(${(materialProgress - 0.5) * 12}%) scale(${1.03 + materialProgress * 0.12})`;
  $('.material-copy h2').style.setProperty('--velocity-skew', `${clamp(velocity * -0.08,-3,3)}deg`);

  $$('.process-steps article').forEach(step => {
    const box = step.getBoundingClientRect();
    step.classList.toggle('active', box.top < innerHeight * 0.62 && box.bottom > innerHeight * 0.25);
  });
  requestAnimationFrame(render);
};

if (!reduced) requestAnimationFrame(render);
else $$('.process-steps article').forEach(step => step.classList.add('active'));

if (!reduced) {
  const magnetic = $('.magnetic');
  magnetic.addEventListener('pointermove', event => {
    const box = magnetic.getBoundingClientRect();
    magnetic.style.transform = `translate(${(event.clientX - box.left - box.width / 2) * 0.18}px,${(event.clientY - box.top - box.height / 2) * 0.28}px)`;
  });
  magnetic.addEventListener('pointerleave', () => magnetic.style.transform = '');
}
