/* App-Rahmen (Sidebar ab 1024 px, Tabbar darunter) mit der echten Navigation der App (web/src/App.tsx).
   Vorschlag: „Rund ums Haus“ -> „Rund ums Zuhause“, „Haus & Pflege“ -> „Zuhause & Pflege“ (siehe README). */
(function () {
  var active = document.body.dataset.page; // 'heute' | 'einkauf'
  var brand = window.TH_BRAND || '<span>ToHuus</span>';
  var groups = [
    { t: 'Rund ums Zuhause', i: [['package', 'Bestand', '', '3'], ['pin', 'Wo ist was?'], ['clipboard', 'Schnell-Abgleich'], ['wrench', 'Zuhause & Pflege'], ['suitcase', 'Urlaub / unterwegs']] },
    { t: 'Küche & Einkauf', i: [['basket', 'Einkauf', 'einkauf', '', '4'], ['chef', 'Kochen'], ['heart', 'Lieblinge'], ['receipt', 'Importe'], ['coins', 'Ausgaben']] },
    { t: 'Gäste', i: [['fork', 'Bestellen'], ['martini', 'Gäste & Bar']] },
    { t: 'Verwalten', i: [['qr', 'QR-Etiketten'], ['gear', 'Einstellungen'], ['question', 'Hilfe']] },
  ];
  function link(ic, label, key, badge, count) {
    var on = key && key === active;
    return '<a href="' + (key ? key + '.html' : '#') + '" class="navlink press' + (on ? ' active' : '') + '"' + (on ? ' aria-current="page"' : '') + '><i data-icon="' + ic + '"' + (on ? ' data-w="fill"' : '') + '></i><span>' + label + '</span>' +
      (badge ? '<span class="nbadge" aria-label="' + badge + ' brauchen Aufmerksamkeit">' + badge + '</span>' : '') + (count ? '<span class="count">' + count + '</span>' : '') + '</a>';
  }
  var side = '<aside class="sidebar" aria-label="Hauptnavigation"><a class="brand" href="heute.html">' + brand + '</a>' +
    '<div class="side-search"><i data-icon="search" data-size="18"></i><span>Wo finde ich …?</span></div>' +
    '<nav class="side-nav">' + link('house', 'Heute', 'heute') +
    groups.map(function (g) { return '<div class="nav-group"><h4>' + g.t + '</h4>' + g.i.map(function (x) { return link.apply(null, x); }).join('') + '</div>'; }).join('') +
    '</nav><div class="side-foot"><span class="av t" aria-hidden="true">T</span><span>Till · Wohnung Lindenstraße</span><button class="icon-btn press" data-theme-toggle aria-label="Dunkles Design"><i data-icon="moon" data-size="18"></i></button></div></aside>';
  function tab(ic, label, key, badge) {
    var on = key === active;
    return '<a href="' + (key ? key + '.html' : '#') + '" class="tab press' + (on ? ' active' : '') + '"' + (on ? ' aria-current="page"' : '') + '><i data-icon="' + ic + '" data-size="24"' + (on ? ' data-w="fill"' : '') + '></i>' + label + (badge ? '<span class="badge">' + badge + '</span>' : '') + '</a>';
  }
  var bar = '<nav class="tabbar" aria-label="Navigation">' + tab('house', 'Heute', 'heute') + tab('fork', 'Bestellen', '') +
    '<button class="tab-plus press" aria-label="Etwas hinzufügen"><i data-icon="plus" data-size="22"></i></button>' +
    tab('basket', 'Einkauf', 'einkauf', '4') + tab('dots', 'Mehr', '', '3') + '</nav>';
  var shell = document.querySelector('.shell');
  shell.insertAdjacentHTML('afterbegin', side);
  shell.insertAdjacentHTML('beforeend', bar);
})();
