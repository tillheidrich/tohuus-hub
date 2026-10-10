// ToHuus Hub site — scroll reveals and copy buttons. No dependencies.
(function () {
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -8% 0px', threshold: 0.08 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  document.querySelectorAll('[data-copy]').forEach(function (btn) {
    btn.addEventListener('click', function () {
      var pre = document.getElementById(btn.getAttribute('data-copy'));
      if (!pre || !navigator.clipboard) return;
      var label = btn.querySelector('span');
      var original = label.textContent;
      navigator.clipboard.writeText(pre.innerText.trim()).then(function () {
        label.textContent = btn.getAttribute('data-done') || 'Copied';
        setTimeout(function () { label.textContent = original; }, 1600);
      });
    });
  });
})();
