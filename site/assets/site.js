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
})();
