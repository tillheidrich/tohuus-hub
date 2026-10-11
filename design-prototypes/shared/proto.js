/* ToHuus Stilprototypen – gemeinsame Mikrointeraktionen (Vanilla JS + WAAPI, kein Build).
   Hooks im Markup:
   [data-theme-toggle]  schaltet hell/dunkel (auch ?theme=dark)
   [data-check]         Checkbox-Button in einer .row; Zeile gleitet nach [data-done-list]
   [data-add-form]      Schnell-Hinzufügen; neue Zeile in [data-list="sonstiges"] oder per Kategorie
   [data-heart]         Herz am Rezept, [data-heart-count] zählt
   [data-store-toggle]  „Im Laden“-Modus (body.in-store)
*/
(function () {
  var root = document.documentElement;
  var reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
  var q = new URLSearchParams(location.search);
  if (q.get('theme') === 'dark') root.setAttribute('data-theme', 'dark');
  if (q.get('store') === '1') document.body.classList.add('in-store');
  if (q.get('motion') === 'reduce') root.classList.add('force-reduce');
  function isReduced() { return reduce.matches || root.classList.contains('force-reduce'); }
  var EASE = 'cubic-bezier(0.2, 0.7, 0.2, 1)';

  // Theme (auch in eingebettete Vorschau-iframes durchreichen)
  function syncFrames() {
    document.querySelectorAll('iframe').forEach(function (f) {
      try { var r = f.contentDocument.documentElement; if (root.getAttribute('data-theme') === 'dark') r.setAttribute('data-theme', 'dark'); else r.removeAttribute('data-theme'); } catch (e) {}
    });
  }
  document.querySelectorAll('iframe').forEach(function (f) { f.addEventListener('load', syncFrames); });
  document.querySelectorAll('[data-theme-toggle]').forEach(function (b) {
    function sync() { b.setAttribute('aria-pressed', String(root.getAttribute('data-theme') === 'dark')); }
    sync();
    b.addEventListener('click', function () {
      var dark = root.getAttribute('data-theme') === 'dark';
      if (dark) root.removeAttribute('data-theme'); else root.setAttribute('data-theme', 'dark');
      sync(); syncFrames();
    });
  });

  // Checkbox -> Erledigt (140–220 ms)
  function updateCounts() {
    document.querySelectorAll('[data-group]').forEach(function (g) {
      var n = g.querySelectorAll('.row:not(.is-done)').length;
      var c = g.querySelector('[data-count]'); if (c) c.textContent = n;
      g.hidden = n === 0 && !g.hasAttribute('data-keep');
    });
    var open = document.querySelectorAll('[data-list] .row:not(.is-done)').length;
    document.querySelectorAll('[data-open-count]').forEach(function (el) { el.textContent = open; });
    var done = document.querySelector('[data-done-list]');
    if (done) { var dc = document.querySelector('[data-done-count]'); if (dc) dc.textContent = done.querySelectorAll('.row').length; }
  }
  function check(btn) {
    var row = btn.closest('.row');
    var done = document.querySelector('[data-done-list]');
    var on = !row.classList.contains('is-done');
    btn.setAttribute('aria-checked', String(on));
    if (isReduced()) {
      row.classList.toggle('is-done', on);
      if (on && done) done.prepend(row);
      row.animate([{ opacity: 0.4 }, { opacity: 1 }], { duration: 120 });
      updateCounts(); return;
    }
    var mark = btn.querySelector('.mark');
    if (on && mark) mark.animate([{ transform: 'scale(0.4)', opacity: 0 }, { transform: 'scale(1.12)', opacity: 1, offset: 0.7 }, { transform: 'scale(1)', opacity: 1 }], { duration: 160, easing: EASE });
    row.classList.toggle('is-checking', on);
    setTimeout(function () {
      var first = row.getBoundingClientRect();
      row.classList.remove('is-checking');
      row.classList.toggle('is-done', on);
      if (on && done) done.prepend(row);
      else if (!on) { var home = document.querySelector('[data-list="' + (row.dataset.home || 'sonstiges') + '"]'); if (home) home.append(row); }
      updateCounts();
      var last = row.getBoundingClientRect();
      var dy = first.top - last.top;
      // FLIP: Zeile gleitet sanft in "Erledigt"
      row.animate([{ transform: 'translateY(' + Math.max(-40, Math.min(40, dy * 0.15)) + 'px)', opacity: 0.35 }, { transform: 'none', opacity: 1 }], { duration: 200, easing: EASE });
    }, 170);
  }
  document.addEventListener('click', function (e) {
    var b = e.target.closest('[data-check]'); if (b) { check(b); return; }
    var h = e.target.closest('[data-heart]');
    if (h) {
      var on = h.getAttribute('aria-pressed') !== 'true';
      h.setAttribute('aria-pressed', String(on));
      var sv = h.querySelector('svg'); if (sv && window.TH_ICONS) sv.innerHTML = window.TH_ICONS.heart[on ? 'fill' : (getComputedStyle(root).getPropertyValue('--icon-weight').trim() || 'regular')];
      var c = h.querySelector('[data-heart-count]'); if (c) c.textContent = (+c.textContent + (on ? 1 : -1));
      if (!isReduced()) h.querySelector('svg, .heart').animate([{ transform: 'scale(1)' }, { transform: 'scale(1.22)', offset: 0.45 }, { transform: 'scale(1)' }], { duration: 220, easing: EASE });
      return;
    }
    var s = e.target.closest('[data-store-toggle]');
    if (s) {
      var st = document.body.classList.toggle('in-store');
      s.setAttribute('aria-pressed', String(st));
      document.querySelectorAll('[data-store-label]').forEach(function (el) { el.textContent = st ? el.dataset.on : el.dataset.off; });
      if (!isReduced()) document.querySelectorAll('[data-store-fade]').forEach(function (el) { el.animate([{ opacity: 0.2 }, { opacity: 1 }], { duration: 180, easing: EASE }); });
    }
  });

  // Schnell hinzufügen (180–240 ms, 6 px Versatz)
  var CAT = { 'obst': ['apfel', 'äpfel', 'banane', 'tomate', 'zwiebel', 'salat', 'gurke', 'paprika', 'kartoffel', 'zitrone', 'basilikum'], 'kuehl': ['milch', 'joghurt', 'butter', 'käse', 'mozzarella', 'sahne', 'quark', 'eier'], 'drogerie': ['zahnpasta', 'shampoo', 'seife', 'pflaster', 'duschgel', 'deo'] };
  document.querySelectorAll('[data-add-form]').forEach(function (f) {
    f.addEventListener('submit', function (e) {
      e.preventDefault();
      var input = f.querySelector('input'); var text = input.value.trim(); if (!text) return;
      var low = text.toLowerCase(); var cat = 'sonstiges';
      Object.keys(CAT).forEach(function (k) { if (CAT[k].some(function (w) { return low.indexOf(w) > -1; })) cat = k; });
      var list = document.querySelector('[data-list="' + cat + '"]') || document.querySelector('[data-list="sonstiges"]');
      var tpl = document.getElementById('row-tpl');
      var row = tpl.content.firstElementChild.cloneNode(true);
      row.dataset.home = cat;
      row.querySelector('[data-name]').textContent = text;
      list.closest('[data-group]').hidden = false;
      list.prepend(row);
      if (window.thRenderIcons) window.thRenderIcons(row);
      updateCounts();
      input.value = '';
      if (!isReduced()) row.animate([{ transform: 'translateY(6px)', opacity: 0 }, { transform: 'none', opacity: 1 }], { duration: 210, easing: EASE });
    });
  });
  updateCounts();
})();
