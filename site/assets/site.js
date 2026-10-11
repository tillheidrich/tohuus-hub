// ToHuus Hub site: light/dark toggle, gentle reveals, copy buttons. No dependencies.
(function () {
  var d = document.documentElement;
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // light / dark: follows the device until you pick one; the choice is remembered on this device only
  var btn = document.querySelector('.theme-btn');
  var meta = document.querySelectorAll('meta[name="theme-color"]');
  function paint(t) {
    d.setAttribute('data-theme', t);
    for (var i = 0; i < meta.length; i++) { meta[i].setAttribute('content', t === 'dark' ? '#111413' : '#f6f3ed'); meta[i].removeAttribute('media'); }
    if (btn) btn.setAttribute('aria-pressed', t === 'dark' ? 'true' : 'false');
  }
  paint(d.getAttribute('data-theme') || 'light');
  if (btn) btn.addEventListener('click', function () {
    var t = d.getAttribute('data-theme') === 'dark' ? 'light' : 'dark';
    try { localStorage.setItem('tohuus.site.theme', t); } catch (e) { /* private mode */ }
    paint(t);
  });
  if (window.matchMedia) {
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    var follow = function (e) { var s = null; try { s = localStorage.getItem('tohuus.site.theme'); } catch (x) {} if (!s) paint(e.matches ? 'dark' : 'light'); };
    if (mq.addEventListener) mq.addEventListener('change', follow);
  }

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

  // parts list under the house: pointing at a part highlights its number in the drawing
  document.querySelectorAll('.parts-list li[data-n]').forEach(function (li) {
    var n = li.getAttribute('data-n');
    var g = document.querySelector('.hz .hz-call[data-n="' + n + '"]');
    if (!g) return;
    var on = function () { g.classList.add('on'); li.classList.add('on'); };
    var off = function () { g.classList.remove('on'); li.classList.remove('on'); };
    li.addEventListener('mouseenter', on); li.addEventListener('mouseleave', off);
    li.addEventListener('focus', on); li.addEventListener('blur', off);
  });

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
