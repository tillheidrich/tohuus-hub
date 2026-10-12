// ToHuus Hub site: light/dark toggle, gentle reveals, copy buttons. No dependencies.
(function () {
  var d = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // light / dark: light by default; a choice is remembered on this device only
  var btn = document.querySelector('.theme-btn');
  var meta = document.querySelectorAll('meta[name="theme-color"]');
  function paint(t) {
    d.setAttribute('data-theme', t);
    for (var i = 0; i < meta.length; i++) { meta[i].setAttribute('content', t === 'dark' ? '#0f1513' : '#f7f5ef'); meta[i].removeAttribute('media'); }
    if (btn) btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
  }
  paint(d.getAttribute('data-theme') || 'light');
  if (btn) btn.addEventListener('click', function () {
    var t = d.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('tohuus.site.theme', t); } catch (e) { /* private mode */ }
    paint(t);
  });
  // reveals
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // copy buttons
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var pre = document.getElementById(b.getAttribute('data-copy'));
      if (!pre || !navigator.clipboard) return;
      var label = b.querySelector('span');
      var original = label.textContent;
      navigator.clipboard.writeText(pre.innerText.trim()).then(function () {
        label.textContent = b.getAttribute('data-done') || 'Copied';
        setTimeout(function () { label.textContent = original; }, 1600);
      });
    });
  });
})();
