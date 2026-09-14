// Shared behaviour for every public page: mobile menu + current-page marking.
(function () {
  window.toggleMobileMenu = function () {
    const menu = document.getElementById('mobileMenu');
    const btn = document.querySelector('.menu-btn');
    if (!menu) return;
    const open = menu.classList.toggle('open');
    if (btn) {
      btn.setAttribute('aria-expanded', open ? 'true' : 'false');
      const icon = btn.querySelector('i');
      if (icon) { icon.classList.toggle('fa-bars', !open); icon.classList.toggle('fa-xmark', open); }
    }
  };

  // Mark the nav link that matches this page (works for /articles, /articles/, /articles/slug …)
  document.addEventListener('DOMContentLoaded', function () {
    const path = location.pathname.replace(/\.html$/, '').replace(/\/$/, '') || '/';
    const first = '/' + (path.split('/')[1] || '');
    document.querySelectorAll('.site-nav a, .mobile-nav a').forEach(function (a) {
      const href = (a.getAttribute('href') || '').replace(/\.html$/, '').replace(/\/$/, '');
      if (href && href !== '/' && !href.includes('#') && (href === path || href === first)) a.setAttribute('aria-current', 'page');
    });
  });
})();
