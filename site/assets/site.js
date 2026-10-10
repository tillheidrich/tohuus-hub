// ToHuus Hub site: scroll reveals, the interactive house, copy buttons. No dependencies.
(function () {
  var reduce = window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  // Gentle reveals
  var els = document.querySelectorAll('.reveal');
  if ('IntersectionObserver' in window && !reduce) {
    var io = new IntersectionObserver(function (entries) {
      entries.forEach(function (e) {
        if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); }
      });
    }, { rootMargin: '0px 0px -6% 0px', threshold: 0.06 });
    els.forEach(function (el) { io.observe(el); });
  } else {
    els.forEach(function (el) { el.classList.add('in'); });
  }

  // The house: hover or tap a room, read what ToHuus knows about it
  var house = document.querySelector('.house');
  var note = document.querySelector('.house-note');
  if (house && note) {
    var rooms = Array.prototype.slice.call(house.querySelectorAll('.room'));
    var data = {};
    document.querySelectorAll('.house-list li').forEach(function (li) { data[li.getAttribute('data-room')] = li; });
    var current = null, timer = null, touched = false;

    function show(id, fromUser) {
      if (fromUser) { touched = true; stop(); }
      if (id === current) return;
      current = id;
      rooms.forEach(function (r) {
        var on = r.getAttribute('data-room') === id;
        r.classList.toggle('on', on);
        r.setAttribute('aria-pressed', on ? 'true' : 'false');
      });
      var li = data[id];
      if (!li) return;
      note.querySelector('.hn-where').textContent = li.getAttribute('data-where');
      note.querySelector('.hn-title').textContent = li.querySelector('b').textContent;
      var ul = note.querySelector('ul');
      ul.innerHTML = '';
      li.querySelectorAll('span').forEach(function (s) {
        var item = document.createElement('li');
        item.textContent = s.textContent;
        if (s.className) item.className = s.className;
        ul.appendChild(item);
      });
      if (!reduce) { note.classList.remove('pop'); void note.offsetWidth; note.classList.add('pop'); }
    }

    rooms.forEach(function (r) {
      var id = r.getAttribute('data-room');
      r.addEventListener('mouseenter', function () { show(id, true); });
      r.addEventListener('focus', function () { show(id, true); });
      r.addEventListener('click', function () { show(id, true); });
      r.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); show(id, true); }
      });
    });

    var order = ['kitchen', 'freezer', 'utility', 'pantry', 'drinks', 'bath', 'attic'];
    var idx = 0;
    function stop() { if (timer) { clearInterval(timer); timer = null; } }
    function start() {
      if (reduce || touched || timer) return;
      timer = setInterval(function () { idx = (idx + 1) % order.length; show(order[idx], false); }, 3400);
    }
    show(order[0], false);
    if ('IntersectionObserver' in window) {
      new IntersectionObserver(function (entries) {
        entries.forEach(function (e) { if (e.isIntersecting) start(); else stop(); });
      }, { threshold: 0.3 }).observe(house);
    } else { start(); }
  }

  // Copy buttons
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
