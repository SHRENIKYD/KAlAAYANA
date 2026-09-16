const $ = (selector, parent = document) => parent.querySelector(selector);
const $$ = (selector, parent = document) => [...parent.querySelectorAll(selector)];
const clamp = (number, min = 0, max = 1) => Math.min(max, Math.max(min, number));
const lerp = (start, end, amount) => start + (end - start) * amount;
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;

let count = 0;
const counter = $('.loader-copy b');
if (counter) {
  const counterTimer = setInterval(() => {
    count = Math.min(100, count + Math.ceil((100 - count) * 0.12));
    counter.textContent = String(count).padStart(3, '0');
    if (count === 100) clearInterval(counterTimer);
  }, 45);
}

const cursor = $('.cursor');
if (cursor && !reduced) {
  let mouseX = -100, mouseY = -100, cursorX = -100, cursorY = -100;
  addEventListener('pointermove', event => {
    mouseX = event.clientX;
    mouseY = event.clientY;
  });
  $$('.project-card, .slide-end').forEach(element => {
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

const statementCopy = $('.word-reveal');
const wordList = statementCopy.textContent.trim().split(/\s+/);
statementCopy.innerHTML = wordList.map(word => `<span class="word">${word}</span> `).join('');
const words = $$('.word');
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
  const hero = $('.hero');
  const heroProgress = clamp(-hero.getBoundingClientRect().top / (hero.offsetHeight - innerHeight));
  $('[data-zoom]').style.transform = `scale(${1 + heroProgress * 0.18})`;
  $('[data-zoom]').style.clipPath = `inset(${6 - heroProgress * 6}% ${5 - heroProgress * 5}%)`;
  $('.hero-title').style.transform = `translate3d(0,${-heroProgress * 150}px,0) scale(${1 + heroProgress * 0.08})`;
  $('.hero-title').style.opacity = 1 - heroProgress * 0.55;
  const heroOrbit = $('.hero-orbit');
  if (heroOrbit) heroOrbit.style.transform = `rotate(${heroProgress * 240}deg)`;

  const statement = $('.statement');
  const statementProgress = clamp((innerHeight - statement.getBoundingClientRect().top) / (statement.offsetHeight * 0.85));
  words.forEach((word, index) => {
    word.style.opacity = clamp(statementProgress * 1.5 - index / words.length * 0.75, 0.16, 1);
  });

  const projects = $('.projects');
  const projectProgress = clamp(-projects.getBoundingClientRect().top / (projects.offsetHeight - innerHeight));
  const track = $('.track');
  const travel = track.scrollWidth - innerWidth;
  track.style.transform = `translate3d(${-travel * projectProgress}px,0,0)`;
  $('.track-line i').style.width = `${12 + projectProgress * 88}%`;
  $$('.project-card').forEach(card => {
    const box = card.getBoundingClientRect();
    const offset = (box.left + box.width / 2 - innerWidth / 2) / innerWidth;
    const parallax = clamp(offset, -1, 1);
    $('.media img', card).style.transform = `scale(1.08) translateX(${-parallax * 3}%)`;
    const focus = 1 - Math.min(1, Math.abs(offset));
    $('.media', card).style.setProperty('--focus', 0.94 + focus * 0.06);
    $('.media', card).style.setProperty('--tilt', `${offset * -3}deg`);
    $('.media', card).style.setProperty('--wipe', clamp(Math.abs(offset) - 0.12, 0, 1));
  });
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
