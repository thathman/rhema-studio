(() => {
  const toggle = document.querySelector('.menu-toggle');
  const nav = document.getElementById('nav-links');
  if (toggle && nav) {
    toggle.addEventListener('click', () => {
      const open = toggle.getAttribute('aria-expanded') !== 'true';
      toggle.setAttribute('aria-expanded', String(open));
      nav.classList.toggle('open', open);
      toggle.querySelector('.menu-label').textContent = open ? 'Close' : 'Menu';
    });
    nav.querySelectorAll('a').forEach(link => link.addEventListener('click', () => {
      nav.classList.remove('open');
      toggle.setAttribute('aria-expanded', 'false');
      toggle.querySelector('.menu-label').textContent = 'Menu';
    }));
    document.addEventListener('keydown', event => {
      if (event.key === 'Escape') {
        nav.classList.remove('open');
        toggle.setAttribute('aria-expanded', 'false');
        toggle.querySelector('.menu-label').textContent = 'Menu';
      }
    });
  }
  const year = document.getElementById('year');
  if (year) year.textContent = String(new Date().getFullYear());
})();