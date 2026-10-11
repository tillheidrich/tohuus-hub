/* Runs before the first paint (loaded blocking from <head>): picks light or dark so nothing flashes.
   Preference order: the last choice this device saw (localStorage "sw.theme", written by web/src/theme.ts),
   then the household default the server puts on <html data-theme-default>. "system" follows the OS. */
(function () {
  var d = document.documentElement;
  var pref = null;
  try { pref = localStorage.getItem('sw.theme'); } catch (e) { /* storage blocked */ }
  if (pref === 'auto') pref = 'system';
  if (pref !== 'light' && pref !== 'dark' && pref !== 'system') pref = d.getAttribute('data-theme-default') || 'light';
  var mq = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null;
  var resolved = pref === 'system' ? (mq && mq.matches ? 'dark' : 'light') : pref;
  d.setAttribute('data-theme', resolved);
  d.setAttribute('data-theme-pref', pref);
  var fredi = d.getAttribute('data-brand') === 'fredirando';
  var paper = resolved === 'dark' ? (fredi ? '#150e0a' : '#111413') : (fredi ? '#fbf5ee' : '#f6f3ed');
  var metas = document.querySelectorAll('meta[name="theme-color"]');
  for (var i = 0; i < metas.length; i++) { metas[i].setAttribute('content', paper); metas[i].removeAttribute('media'); }
})();
