/* Variante B – eigene Illustrationen (Original, CC0-fähig als Projekt-Asset).
   Technik: echte Vektorpfade + SVG-Filter für unperfekte Federlinien (#hd-line) und Gouache-Flächen (#hd-wash).
   Farben nur aus Tokens (CSS-Variablen) -> funktioniert hell und dunkel.
   Detailgrade: 1 = Objekt-Vignette (40 px), 2 = Ort-Kachel, 3 = Tageszeit-Szene, 4 = Wohnformen-Ensemble (Website). */
(function () {
  var DEFS = '<svg width="0" height="0" style="position:absolute" aria-hidden="true"><defs>' +
    '<filter id="hd-line" x="-12%" y="-12%" width="124%" height="124%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.035" numOctaves="2" seed="4" result="n"/><feDisplacementMap in="SourceGraphic" in2="n" scale="2" xChannelSelector="R" yChannelSelector="G"/></filter>' +
    '<filter id="hd-wash" x="-10%" y="-10%" width="120%" height="120%" color-interpolation-filters="sRGB"><feTurbulence type="fractalNoise" baseFrequency="0.022" numOctaves="3" seed="9" result="w"/><feDisplacementMap in="SourceGraphic" in2="w" scale="7" xChannelSelector="R" yChannelSelector="G" result="d"/>' +
    '<feTurbulence type="fractalNoise" baseFrequency="0.75" numOctaves="2" seed="2" result="g"/><feColorMatrix in="g" type="matrix" values="0 0 0 0 0  0 0 0 0 0  0 0 0 0 0  0 0 0 -0.9 1.25" result="ga"/><feComposite in="d" in2="ga" operator="in" result="t"/><feGaussianBlur in="t" stdDeviation="0.35"/></filter>' +
    '</defs></svg>';
  document.body.insertAdjacentHTML('afterbegin', DEFS);

  var L = 'fill="none" stroke="var(--ill-line)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" filter="url(#hd-line)"';
  var W = 'filter="url(#hd-wash)"';

  var cat = function (x, y, s) { // schlafende Katze (Easter Egg), Ursprung unten links
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (s || 1) + ')">' +
      '<path ' + W + ' d="M2 -2c0-14 12-22 26-22 10 0 18 5 21 12 3-3 8-3 10 1 2 4 0 9-4 10l-1 1H4z" fill="var(--ill-cat)" opacity=".9"/>' +
      '<g ' + L + '><path d="M3 -1c-1-13 10-22 25-22 10 0 17 5 20 11"/><path d="M48 -12l1-8 4 5 4-4 1 8c2 4 0 9-5 10H40"/><path d="M3 -1h44"/><path d="M12 -1c-6 0-10 3-8 7 3 4 14 3 22-1" /><path d="M50 -8q2 1 4 0"/></g></g>';
  };
  var plant = function (x, y, s) { // Topfpflanze, Ursprung Topfboden-Mitte
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (s || 1) + ')">' +
      '<path ' + W + ' d="M-9 0l-2-15h22L9 0z" fill="var(--clay)" opacity=".75"/>' +
      '<path ' + W + ' d="M0-16c-10-6-14-18-8-30 6 8 9 18 8 30zM1-16c4-10 13-17 22-16-3 9-11 15-22 16zM-1-15c-8-1-17-8-18-16 9-1 16 5 18 16z" fill="var(--primary)" opacity=".8"/>' +
      '<g ' + L + '><path d="M-11-15h22l-2 15h-18z"/><path d="M0-16c-10-6-14-18-8-30 6 8 9 18 8 30"/><path d="M1-16c4-10 13-17 22-16-3 9-11 15-22 16"/><path d="M-1-15c-8-1-17-8-18-16 9-1 16 5 18 16"/></g></g>';
  };
  var bird = function (x, y, s) {
    return '<g transform="translate(' + x + ' ' + y + ') scale(' + (s || 1) + ')"><path ' + W + ' d="M0 0c2-7 9-10 15-7l6-3-2 5c1 5-4 9-11 9C3 4 0 3 0 0z" fill="var(--ill-ink-soft)"/>' +
      '<g ' + L + '><path d="M0 0c2-7 9-10 15-7l6-3-2 5c1 5-4 9-11 9C3 4 0 3 0 0z"/><path d="M6 4v5M10 4v5"/></g><circle cx="13" cy="-4" r="1" fill="var(--ill-line)"/></g>';
  };

  var ILLO = {};
  /* Detailgrad 3 – Tageszeit „Nachmittag“: Fenster, Fensterbank, Pflanze, Katze, Tasse */
  ILLO.window = function () {
    return '<svg viewBox="0 0 360 132" role="img" aria-label="Gezeichnetes Fenster am Nachmittag, auf der Fensterbank schläft eine Katze neben einer Topfpflanze">' +
      '<path ' + W + ' d="M232 18c0-10 8-16 18-16h62c10 0 18 6 18 16v96h-98z" fill="var(--ill-sky)"/>' +
      '<path ' + W + ' d="M296 44a16 16 0 1 1 0.1 0z" fill="var(--ill-sun)" opacity=".9"/>' +
      '<path ' + W + ' d="M240 92c18-10 36-12 52-6 14 5 26 3 34-2v30h-86z" fill="var(--sage)" opacity=".55"/>' +
      '<g ' + L + '><path d="M228 116V20c0-12 10-19 21-19h64c11 0 21 7 21 19v96"/><path d="M233 114V22c0-9 7-14 16-14h64c9 0 16 5 16 14v92"/><path d="M281 9v105M233 62h96"/></g>' +
      '<path ' + W + ' d="M150 116h210v8H150z" fill="var(--ill-wood)"/>' +
      '<g ' + L + '><path d="M140 116h220M146 124h214"/></g>' +
      plant(212, 116, 0.9) + cat(244, 116, 0.95) +
      '<g transform="translate(330 116)"><path ' + W + ' d="M0 0v-16h16v16z" fill="var(--primary-soft)"/><g ' + L + '><path d="M0 0v-16h16V0zM16-12c6 0 6 9 0 9"/><path d="M5-21c-2-3 2-5 0-8M10-21c-2-3 2-5 0-8" stroke-width="1.2"/></g></g>' +
      '</svg>';
  };
  /* Detailgrad 1 – Objekt-Vignetten */
  ILLO.yoghurt = function () { return '<svg viewBox="0 0 40 40" aria-hidden="true"><path ' + W + ' d="M11 13h18l-2 20H13z" fill="var(--primary-soft)"/><path ' + W + ' d="M13 21h14l-1 6H14z" fill="var(--sage)" opacity=".7"/><g ' + L + '><path d="M10 13h20l-2.5 20h-15z"/><path d="M9 11h22v3H9z"/></g></svg>'; };
  ILLO.milk = function () { return '<svg viewBox="0 0 40 40" aria-hidden="true"><path ' + W + ' d="M12 14l4-7h8l4 7v20H12z" fill="var(--surface-ill)"/><path ' + W + ' d="M12 22h16v6H12z" fill="var(--primary)" opacity=".75"/><g ' + L + '><path d="M12 14l4-7h8l4 7v20H12z"/><path d="M16 7v-3h8v3M12 14h16"/></g></svg>'; };
  ILLO.basket = function () { return '<svg viewBox="0 0 40 40" aria-hidden="true"><path ' + W + ' d="M7 17h26l-3 16H10z" fill="var(--ill-wood)"/><path ' + W + ' d="M14 17c0-5 3-8 5-8s3 3 3 8z" fill="var(--primary)" opacity=".7"/><g ' + L + '><path d="M6 17h28l-3.5 16h-21z"/><path d="M12 17c1-7 5-11 8-11s7 4 8 11"/><path d="M14 22l1 7M20 22v7M26 22l-1 7"/></g></svg>'; };
  ILLO.tote = function () { return '<svg viewBox="0 0 60 60" aria-hidden="true"><path ' + W + ' d="M28 22l6-16 4 2-5 15z" fill="var(--sand-ill)"/><path ' + W + ' d="M22 22c-2-6-1-12 2-15 3 3 4 9 2 15z" fill="var(--primary)" opacity=".8"/><path ' + W + ' d="M12 22h36l-3 32H15z" fill="var(--primary-soft)"/><g ' + L + '><path d="M11 22h38l-3 32H14z"/><path d="M20 22c0-9 4-13 10-13s10 4 10 13"/><path d="M28 22l6-16 4 2-5 14"/><path d="M22 22c-2-6-1-12 2-15 3 3 4 9 2 15"/></g></svg>'; };
  /* Detailgrad 2 – Orte (nur die konfigurierten: Küchenzeile, Kühlschrank, Regal im Flur, Badschrank) */
  ILLO.kitchen = function () { return '<svg viewBox="0 0 120 80" aria-hidden="true"><path ' + W + ' d="M8 46h104v28H8z" fill="var(--ill-wood)"/><path ' + W + ' d="M70 30h22v16H70z" fill="var(--primary-soft)"/><g ' + L + '><path d="M6 46h108M8 46v28h104V46M42 50v24M78 50v24"/><path d="M20 46c0-6 4-10 9-10s9 4 9 10"/><path d="M70 46V30h22v16M74 30v-5h14v5M92 34h5"/><path d="M29 36v-8"/></g>' + plant(104, 46, 0.45) + '</svg>'; };
  ILLO.fridge = function () { return '<svg viewBox="0 0 120 80" aria-hidden="true"><path ' + W + ' d="M38 6h44v68H38z" fill="var(--surface-ill)"/><path ' + W + ' d="M48 14h10v6H48z" fill="var(--clay)" opacity=".7"/><g ' + L + '><path d="M38 6h44v68H38zM38 32h44M74 14v12M74 38v18"/><path d="M48 14h10v6H48z"/></g></svg>'; };
  ILLO.shelf = function () { return '<svg viewBox="0 0 120 80" aria-hidden="true"><path ' + W + ' d="M26 18h22v18H26zM56 50h26v18H56z" fill="var(--sand-ill)"/><path ' + W + ' d="M66 24a8 8 0 1 1 0.1 0z" fill="var(--primary)" opacity=".55"/><g ' + L + '><path d="M14 36h92M14 68h92M18 36v38M102 36v38"/><path d="M26 18h22v18H26zM56 50h26v18H56z"/><circle cx="66" cy="28" r="8"/><circle cx="66" cy="28" r="3"/></g></svg>'; };
  ILLO.bath = function () { return '<svg viewBox="0 0 120 80" aria-hidden="true"><path ' + W + ' d="M30 8h60v44H30z" fill="var(--ill-sky)"/><g ' + L + '><path d="M30 8h60v44H30zM60 8v44M54 28v6M66 28v6"/><path d="M38 64h44"/><path d="M48 64v-6h6v6M66 64v-9h5v9"/></g></svg>'; };
  /* Detailgrad 4 – Wohnformen-Ensemble für die Website (aufsteigende Silhouette: Haus, Reihenhaus, Altbau-WG, Mehrfamilienhaus) */
  ILLO.ensemble = function () {
    var s = '<svg viewBox="0 0 1280 620" preserveAspectRatio="xMidYMax meet" role="img" aria-label="Gezeichnete Straße: ein freistehendes Haus mit Baum, drei Reihenhäuser, ein Altbau mit Wohngemeinschaft und ein Mehrfamilienhaus mit Balkonen. Auf dem Dach sitzt ein Vogel, auf der Gartenmauer schläft eine Katze.">';
    // Himmel
    s += '<path ' + W + ' d="M1010 60a150 150 0 1 1-0.1 0z" fill="var(--ill-sun)" opacity=".45"/>';
    s += '<path ' + W + ' d="M690 196c20-18 60-22 84-8 18-10 52-8 66 8 10 10-4 18-22 18H700c-18 0-22-8-10-18z" fill="var(--ill-sky)" opacity=".9"/>';
    s += '<g ' + L + ' stroke-width="1.3"><path d="M760 120q6-6 12 0q6-6 12 0M800 96q5-5 10 0q5-5 10 0"/></g>';
    // Boden
    s += '<path ' + W + ' d="M0 582h1280v16H0z" fill="var(--ill-wood)" opacity=".8"/><path ' + W + ' d="M0 598c200-6 420-4 640-2s440 4 640 0v22H0z" fill="var(--sage)" opacity=".55"/>';
    // --- 1 freistehendes Haus
    s += '<path ' + W + ' d="M66 472l100-74 100 74z" fill="var(--ill-roof)"/><path ' + W + ' d="M84 472h164v110H84z" fill="var(--sand-ill)"/>';
    s += '<path ' + W + ' d="M150 520h30v62h-30z" fill="var(--primary)" opacity=".85"/>';
    s += '<g ' + L + '><path d="M58 478l108-82 108 82M84 470v112M248 470v112"/><path d="M210 432v-30h18v44"/><path d="M150 582v-62h30v62M174 552h2"/><path d="M100 500h34v30h-34zM117 500v30M200 500h34v30h-34zM217 500v30"/><path d="M98 532h38M198 532h38"/></g>';
    s += '<path ' + W + ' d="M100 501h12v28h-12zM222 501h12v28h-12z" fill="var(--clay)" opacity=".35"/>';
    s += '<path ' + W + ' d="M300 586c-24 0-36-24-28-50 6-20 24-34 38-34s30 16 32 36c4 28-14 48-42 48z" fill="var(--primary)" opacity=".55"/>';
    s += '<g ' + L + '><path d="M306 590v-46M306 560l-12-12M306 552l10-10"/><path d="M300 586c-24 0-36-24-28-50 6-20 24-34 38-34s30 16 32 36c4 28-14 48-42 48"/><path d="M40 560h44M40 560v22M60 560v22M248 560h22v22"/></g>';
    s += plant(196, 582, 0.5) + bird(46, 548, 0.7);
    // --- 2 Reihenhäuser
    s += '<path ' + W + ' d="M336 478l46-46 46 46zM428 478l46-46 46 46zM520 478l46-46 46 46z" fill="var(--ill-roof)"/>';
    s += '<path ' + W + ' d="M340 478h88v104h-88zM520 478h88v104h-88z" fill="var(--surface-ill)"/><path ' + W + ' d="M428 478h92v104h-92z" fill="var(--primary-soft)"/>';
    s += '<g ' + L + '><path d="M330 484l52-52 46 46 46-46 46 46 46-46 52 52M340 478v104M428 478v104M520 478v104M608 478v104"/>';
    [340, 428, 520].forEach(function (x, i) { s += '<path d="M' + (x + 14) + ' 582v-46h24v46M' + (x + 52) + ' 498h24v24h-24zM' + (x + 52) + ' 538h24v22h-24z"/>'; if (i === 1) s += '<path d="M' + (x + 30) + ' 456v-30h12v18"/>'; });
    s += '<path d="M322 566h80v16M322 566c0-4 2-5 4-5h72c2 0 4 1 4 5"/></g>';
    s += '<path ' + W + ' d="M354 536h24v46h-24z" fill="var(--sage)"/><path ' + W + ' d="M442 536h24v46h-24z" fill="var(--primary)" opacity=".85"/><path ' + W + ' d="M534 536h24v46h-24z" fill="var(--clay)" opacity=".55"/>';
    s += cat(330, 561, 0.62) + plant(500, 582, 0.55) + plant(590, 582, 0.45);
    // Laterne
    s += '<g ' + L + '><path d="M632 582V448M624 448h16l-3-16h-10z"/><path d="M626 582h12"/></g><path ' + W + ' d="M627 446h10l-2-12h-6z" fill="var(--ill-sun)"/>';
    // --- 3 Altbau-WG
    s += '<path ' + W + ' d="M660 312h214v270H660z" fill="var(--sand-ill)"/>';
    s += '<g ' + L + '><path d="M652 312h230M660 312v270M874 312v270M652 300h230v12M660 336h214M660 452h214"/>';
    [356, 470].forEach(function (y) { (y === 470 ? [686, 810] : [686, 748, 810]).forEach(function (x) { s += '<path d="M' + x + ' ' + (y + 66) + 'v-50a14 14 0 0 1 28 0v50z"/>'; }); });
    s += '<path d="M748 582v-70a20 20 0 0 1 40 0v70M768 492v90"/><path d="M800 528h12v26h-12z"/><path d="M798 534h16M798 540h16M798 546h16"/></g>';
    s += '<path ' + W + ' d="M688 372h24v48h-24z" fill="var(--clay)" opacity=".4"/><path ' + W + ' d="M812 372h24v48h-24z" fill="var(--primary)" opacity=".4"/><path ' + W + ' d="M688 486h24v48h-24z" fill="var(--ill-sun)"/>';
    s += '<g ' + L + ' stroke-width="1.3"><path d="M688 420c4-8 20-8 24 0"/><circle cx="680" cy="566" r="15"/><circle cx="720" cy="566" r="15"/><path d="M680 566l15-19h17l8 19M695 547l-4-8h-8M712 547l2-8"/></g>';
    s += plant(824, 422, 0.42) + '<g fill="var(--ill-sun)">' + [668, 690, 712, 734, 756, 778, 800, 822, 844, 866].map(function (x, i) { return '<circle cx="' + x + '" cy="' + (306 + (i % 2) * 2) + '" r="2.4"/>'; }).join('') + '</g>';
    // --- 4 Mehrfamilienhaus
    s += '<path ' + W + ' d="M920 206h270v376H920z" fill="var(--primary-soft)"/><path ' + W + ' d="M1066 338h34v30h-34z" fill="var(--ill-sun)"/>';
    s += '<g ' + L + '><path d="M914 206h282M920 196h270v10M920 206v376M1190 206v376"/><path d="M1140 196v-34h20v34M1150 162v-22"/>';
    [232, 286, 340, 394, 448].forEach(function (y) { [942, 1004, 1066].forEach(function (x) { s += '<path d="M' + x + ' ' + y + 'h34v30h-34z"/>'; }); s += '<path d="M1124 ' + y + 'h44v30h-44zM1118 ' + (y + 32) + 'h56M1120 ' + (y + 32) + 'v-12h52v12"/>'; });
    s += '<path d="M1010 582v-62h48v62M1034 520v62M998 520h72v-10h-72z"/></g>';
    s += plant(1160, 316, 0.4) + plant(1132, 424, 0.36) + bird(1142, 132, 0.95);
    s += '<g ' + L + '><path d="M0 582h1280"/></g></svg>';
    return s;
  };
  document.querySelectorAll('[data-illo]').forEach(function (el) { el.innerHTML = ILLO[el.dataset.illo](); });
})();
