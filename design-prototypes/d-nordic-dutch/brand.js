/* Variante D: Marke (ToHuus / Fredirando) und Überschriften-Serif (Hedvig / Bree) per URL umschaltbar.
   ?brand=fredirando  ·  ?serif=bree  ·  (?theme=dark, ?store=1, ?motion=reduce wie überall) */
(function () {
  var q = new URLSearchParams(location.search), r = document.documentElement;
  if (q.get('serif') === 'bree') r.setAttribute('data-serif', 'bree');
  var fredi = q.get('brand') === 'fredirando';
  if (fredi) r.setAttribute('data-brand', 'fredirando');
  // ToHuus: Hausumriss mit grüner Tür. Fredirando: eigene Bildmarke (abgerundetes Haus + Lieferstriche), jetzt grün statt orange.
  window.TH_LOGO = fredi
    ? '<svg class="logo" width="28" height="28" viewBox="0 0 1024 1024" aria-hidden="true"><rect width="1024" height="1024" rx="232" fill="var(--logo-bg)"/><g transform="translate(-30.7 -30.7) scale(1.06)"><g stroke="#F7F5EF" stroke-width="40" stroke-linecap="round" opacity=".55"><path d="M132 590h94M160 672h76M132 754h68"/></g><g transform="translate(40 0)"><path d="M214 486 512 246l298 240" fill="none" stroke="#F7F5EF" stroke-width="92" stroke-linecap="round" stroke-linejoin="round"/><rect x="306" y="516" width="412" height="306" rx="64" fill="#F7F5EF"/><path d="M454 822V700a58 58 0 0 1 116 0v122z" fill="#181D1A"/></g></g></svg>'
    : '<svg class="logo" width="26" height="26" viewBox="0 0 32 32" aria-hidden="true"><path d="M5 15.5 16 6l11 9.5V27H5z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><path d="M13.5 27v-6.5a2.5 2.5 0 0 1 5 0V27z" fill="#176B50"/></svg>';
  window.TH_NAME = fredi ? 'fredirando' : 'ToHuus';
  window.TH_BRAND = window.TH_LOGO + '<span class="wm">' + window.TH_NAME + '</span>';
  if (fredi) document.title = document.title.replace('ToHuus', 'Fredirando');
})();
