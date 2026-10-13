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

  // copy buttons; the visible label changes, and a polite live region tells screen readers about it
  var copyLive = null;
  function announce(msg) {
    if (!copyLive) {
      copyLive = document.createElement('span');
      copyLive.setAttribute('role', 'status');
      copyLive.setAttribute('aria-live', 'polite');
      copyLive.style.cssText = 'position:absolute;width:1px;height:1px;margin:-1px;padding:0;overflow:hidden;clip:rect(0 0 0 0);white-space:nowrap;border:0';
      document.body.appendChild(copyLive);
    }
    copyLive.textContent = '';
    setTimeout(function () { copyLive.textContent = msg; }, 50);
  }
  document.querySelectorAll('[data-copy]').forEach(function (b) {
    b.addEventListener('click', function () {
      var pre = document.getElementById(b.getAttribute('data-copy'));
      if (!pre || !navigator.clipboard) return;
      var label = b.querySelector('span');
      var original = label.textContent;
      navigator.clipboard.writeText(pre.innerText.trim()).then(function () {
        label.textContent = b.getAttribute('data-done') || 'Copied';
        announce(label.textContent);
        setTimeout(function () { label.textContent = original; }, 1600);
      });
    });
  });

  // fact cards: draw the card as a 1080 × 1350 PNG with the site's own fonts, share it on phones or save it
  function wrap(ctx, text, max) {
    var words = text.split(' '), lines = [], line = '';
    for (var i = 0; i < words.length; i++) {
      var t = line ? line + ' ' + words[i] : words[i];
      if (ctx.measureText(t).width > max && line) { lines.push(line); line = words[i]; } else line = t;
    }
    if (line) lines.push(line);
    return lines;
  }
  function drawFact(card) {
    var W = 1080, H = 1350, P = 96;
    var c = document.createElement('canvas');
    c.width = W; c.height = H;
    var x = c.getContext('2d');
    x.fillStyle = '#104e3c'; x.fillRect(0, 0, W, H);
    x.fillStyle = '#2c7a5f'; x.beginPath(); x.arc(W - 60, 80, 330, 0, Math.PI * 2); x.fill();
    x.fillStyle = '#e8b865'; x.beginPath(); x.arc(P + 110, H, 110, Math.PI, 0); x.fill();
    x.textBaseline = 'top';
    x.fillStyle = '#d5e3da'; x.font = '700 34px "Familjen Grotesk", sans-serif';
    x.fillText((card.querySelector('.fact-brand') || {}).textContent.toUpperCase() || 'TOHUUS', P, P);
    var value = card.getAttribute('data-value'), size = 230;
    x.font = '400 ' + size + 'px "Hedvig Letters Serif", Georgia, serif';
    while (x.measureText(value).width > W - 2 * P && size > 90) { size -= 10; x.font = '400 ' + size + 'px "Hedvig Letters Serif", Georgia, serif'; }
    x.fillStyle = '#f7f5ef';
    var y = 300;
    x.fillText(value, P, y);
    y += size + 50;
    x.font = '400 58px "Familjen Grotesk", sans-serif';
    wrap(x, card.getAttribute('data-text'), W - 2 * P).forEach(function (l) { x.fillText(l, P, y); y += 76; });
    x.font = '400 34px "Familjen Grotesk", sans-serif'; x.fillStyle = '#d5e3da';
    var src = (card.querySelector('figcaption') || {}).textContent || '';
    wrap(x, src.replace(/\s+/g, ' ').trim(), W - 2 * P).forEach(function (l) { x.fillText(l, P, y + 30); y += 46; });
    x.font = '700 36px "Familjen Grotesk", sans-serif'; x.fillStyle = '#f7f5ef';
    x.textAlign = 'right';
    x.fillText('tohuus.heidrich-digital.de', W - P, H - P - 20);
    return c;
  }
  document.querySelectorAll('.fact-save').forEach(function (b) {
    b.addEventListener('click', function () {
      var card = document.getElementById(b.getAttribute('data-fact'));
      if (!card) return;
      var ready = document.fonts && document.fonts.load
        ? Promise.all([document.fonts.load('400 100px "Hedvig Letters Serif"'), document.fonts.load('700 40px "Familjen Grotesk"'), document.fonts.load('400 40px "Familjen Grotesk"')])
        : Promise.resolve();
      ready.catch(function () {}).then(function () {
        drawFact(card).toBlob(function (blob) {
          if (!blob) return;
          var name = b.getAttribute('data-file') + '.png';
          var label = b.querySelector('span'), original = label.textContent;
          var done = function () { label.textContent = b.getAttribute('data-saved') || original; setTimeout(function () { label.textContent = original; }, 1600); };
          var file = typeof File === 'function' ? new File([blob], name, { type: 'image/png' }) : null;
          // phones: the share sheet (save to photos, send in a chat); elsewhere: a download
          if (file && navigator.canShare && navigator.canShare({ files: [file] }) && window.matchMedia('(pointer: coarse)').matches) {
            navigator.share({ files: [file], title: card.getAttribute('data-value'), text: card.getAttribute('data-text') + ' ' + location.href.split('#')[0] }).then(done).catch(function () {});
            return;
          }
          var a = document.createElement('a');
          a.href = URL.createObjectURL(blob);
          a.download = name;
          document.body.appendChild(a); a.click(); a.remove();
          setTimeout(function () { URL.revokeObjectURL(a.href); }, 4000);
          done();
        }, 'image/png');
      });
    });
  });

  // Plattdeutsch saying on the German home page (data: server/data/platt.json, same rules as server/lib/platt.ts:
  // time of day, weekday, month, special days; special days usually win, sayings bound to the moment weigh 3×)
  var pl = document.querySelector('[data-platt]');
  var plData = document.getElementById('platt-data');
  if (pl && plData) {
    var say = pl.querySelector('.platt-say'), more = pl.querySelector('.platt-more'), hi = pl.querySelector('.platt-hi');
    try {
      var list = JSON.parse(plData.textContent || '[]');
      var now = new Date(), h = now.getHours(), m = now.getMonth() + 1, wd = now.getDay();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var iso = function (x) { return x.getFullYear() + '-' + pad(x.getMonth() + 1) + '-' + pad(x.getDate()); };
      var date = iso(now), md = date.slice(5);
      var slot = h >= 5 && h < 11 ? 'morning' : h >= 11 && h < 14 ? 'noon' : h >= 14 && h < 18 ? 'afternoon' : h >= 18 && h < 23 ? 'evening' : 'night';
      var y = now.getFullYear(), a = y % 19, b = Math.floor(y / 100), c = y % 100, dd = Math.floor(b / 4), e = b % 4, f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3);
      var hh = (19 * a + b - dd - g + 15) % 30, i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - hh - k) % 7, mm = Math.floor((a + 11 * hh + 22 * l) / 451);
      var easter = new Date(y, Math.floor((hh + l - 7 * mm + 114) / 31) - 1, ((hh + l - 7 * mm + 114) % 31) + 1);
      var specials = [];
      if (md >= '12-01' && md <= '12-23') specials.push('advent');
      if (md >= '12-24' && md <= '12-26') specials.push('christmas');
      if (md === '12-31') specials.push('newyear-eve');
      if (md === '01-01' || md === '01-02') specials.push('newyear');
      var ed = function (n) { var x = new Date(easter); x.setDate(x.getDate() + n); return iso(x); };
      if (date >= ed(-2) && date <= ed(1)) specials.push('easter');
      var has = function (arr, v) { return !arr || arr.indexOf(v) >= 0; };
      var fits = list.filter(function (s) {
        var w = s.when; if (!w) return true;
        return has(w.slots, slot) && has(w.days, wd) && has(w.months, m) && (!w.special || w.special.some(function (x) { return specials.indexOf(x) >= 0; }));
      });
      var sp = fits.filter(function (s) { return s.when && s.when.special; });
      var pick = null;
      if (sp.length && Math.random() < 0.75) pick = sp[Math.floor(Math.random() * sp.length)];
      else {
        var pool = [];
        fits.forEach(function (s) { if (!(s.when && s.when.special)) for (var n = 0; n < (s.when ? 3 : 1); n++) pool.push(s); });
        if (pool.length) pick = pool[Math.floor(Math.random() * pool.length)];
      }
      if (pick) {
        say.firstChild.textContent = '„' + pick.text + '“';
        more.innerHTML = '';
        var bb = document.createElement('b'); bb.textContent = pick.meaning; more.appendChild(bb);
        more.appendChild(document.createTextNode(' ' + pick.note));
      }
      if (hi) hi.textContent = slot === 'evening' ? "'n Avend!" : 'Moin!';
    } catch (err) { /* keep the saying from the build */ }
    say.addEventListener('click', function () {
      var open = more.hasAttribute('hidden');
      if (open) more.removeAttribute('hidden'); else more.setAttribute('hidden', '');
      say.setAttribute('aria-expanded', open ? 'true' : 'false');
    });
  }
})();
