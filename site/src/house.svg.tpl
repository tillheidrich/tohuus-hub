<svg class="house" viewBox="0 0 640 600" role="group" aria-label="{{label}}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <pattern id="bricks" width="28" height="14" patternUnits="userSpaceOnUse">
      <rect width="28" height="14" fill="#b4472e"/>
      <path d="M0 .75H28M0 7.75H28M7 .75v7M21 7.75v7" stroke="#d58a70" stroke-width="1.5" fill="none"/>
    </pattern>
    <pattern id="tiles" width="22" height="13" patternUnits="userSpaceOnUse">
      <rect width="22" height="13" fill="#9a3a24"/>
      <path d="M0 12.25H22M5.5 0v12.5M16.5 0v12.5" stroke="#c4644b" stroke-width="1.4" fill="none"/>
      <path d="M0 12.5q5.5-4 11 0t11 0" stroke="#7f2e1b" stroke-width="1" fill="none" opacity=".5"/>
    </pattern>
    <pattern id="earth" width="26" height="22" patternUnits="userSpaceOnUse">
      <rect width="26" height="22" fill="#ece2cf"/>
      <circle cx="5" cy="6" r="1.6" fill="#d6c6a8"/><circle cx="18" cy="15" r="1.2" fill="#d6c6a8"/><circle cx="21" cy="4" r=".9" fill="#cdbb99"/>
    </pattern>
  </defs>
  <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <!-- ground and garden -->
    <rect x="0" y="472" width="640" height="128" fill="url(#earth)" stroke="none"/>
    <path d="M0 472H640" stroke-width="2"/>
    <path d="M14 472c0-18 14-30 28-28 6-12 26-12 32 2 8-2 12 10 8 26" fill="#a9bd9b"/>
    <path d="M574 472c-2-14 8-24 20-22 4-10 20-10 26 2 10 0 14 10 12 20" fill="#a9bd9b"/>
    <path d="M30 462v-6M52 458v-8M600 462v-6" stroke="#6f8b62" stroke-width="1.5"/>
    <!-- cellar shell -->
    <rect x="72" y="472" width="496" height="118" fill="#d9d2c4"/>
    <!-- chimney -->
    <rect x="446" y="74" width="34" height="96" fill="url(#bricks)"/>
    <rect x="440" y="66" width="46" height="10" rx="2" fill="#efe6d5"/>
    <!-- walls -->
    <rect x="70" y="196" width="500" height="276" fill="url(#bricks)"/>
    <!-- roof -->
    <path d="M40 210 320 40 600 210Z" fill="url(#tiles)" stroke-width="2.5"/>
    <path d="M32 212 320 34 608 212" stroke-width="3"/>
    <!-- floor slabs -->
    <rect x="70" y="198" width="500" height="16" fill="#e7dcc8"/>
    <rect x="70" y="326" width="500" height="16" fill="#e7dcc8"/>
    <rect x="70" y="454" width="500" height="18" fill="#e7dcc8"/>
    <rect x="72" y="472" width="496" height="14" fill="#cfc6b6"/>
  </g>

  <!-- ATTIC -->
  <g class="room" data-room="attic" tabindex="0" role="button" aria-pressed="false" aria-label="{{attic}}">
    <path class="bg" d="M122 198 320 86 518 198Z"/>
    <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <path d="M122 198 320 86 518 198Z"/>
      <circle cx="320" cy="140" r="18" fill="#fff"/><circle cx="320" cy="140" r="12" fill="#dceaf0"/><path d="M320 128v24M308 140h24" stroke="#fff" stroke-width="2.5"/>
      <rect x="196" y="164" width="46" height="34" rx="2" fill="#e7d3ae"/><path d="M196 172h46M219 164v8"/>
      <rect x="236" y="178" width="34" height="20" rx="2" fill="#efe0c2"/>
      <rect x="372" y="166" width="54" height="32" rx="2" fill="#e7d3ae"/><path d="M372 174h54"/>
      <rect x="392" y="180" width="16" height="12" rx="1.5" fill="#fff" stroke-width="1.5"/>
      <path d="M150 186c20 6 36 6 52-4" stroke="#6f7a82" stroke-width="1.5"/>
    </g>
    <text x="400" y="190.5" text-anchor="middle" font-family="Caveat, cursive" font-weight="600" font-size="12" fill="#1d2a33">3</text>
    <path class="edge" d="M122 198 320 86 518 198Z"/>
    <g class="pin"><circle class="ring" cx="462" cy="184" r="8"/><circle cx="462" cy="184" r="8.5" fill="#fff" stroke="#b4472e" stroke-width="1.5"/><circle class="dot" cx="462" cy="184" r="3.6"/></g>
  </g>

  <!-- BATHROOM -->
  <g class="room" data-room="bath" tabindex="0" role="button" aria-pressed="false" aria-label="{{bath}}">
    <rect class="bg" x="88" y="214" width="214" height="112" rx="3"/>
    <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="88" y="214" width="214" height="112" rx="3"/>
      <rect x="110" y="228" width="72" height="46" rx="4" fill="#fff"/><path d="M146 228v46"/><path d="M140 248v6M152 248v6" stroke-width="2.5"/>
      <path d="M108 294h80c-4 16-18 22-40 22s-36-6-40-22Z" fill="#fff"/><path d="M148 294v-10h10"/>
      <rect x="238" y="232" width="44" height="44" rx="2" fill="#fff" stroke-width="2"/><rect x="243" y="237" width="34" height="34" fill="#dceaf0" stroke="none"/><path d="M260 236v38M242 254h38" stroke="#fff" stroke-width="3"/><rect x="238" y="232" width="44" height="44" rx="2"/>
      <rect x="204" y="282" width="16" height="36" rx="2" fill="#dceaf0"/><path d="M200 282h24"/>
      <path d="M240 300h48v8c0 8-6 12-14 12h-20c-8 0-14-4-14-12Z" fill="#fff"/>
    </g>
    <rect class="edge" x="88" y="214" width="214" height="112" rx="3"/>
    <g class="pin"><circle class="ring" cx="198" cy="242" r="8"/><circle cx="198" cy="242" r="8.5" fill="#fff" stroke="#b4472e" stroke-width="1.5"/><circle class="dot" cx="198" cy="242" r="3.6"/></g>
  </g>

  <!-- UTILITY -->
  <g class="room" data-room="utility" tabindex="0" role="button" aria-pressed="false" aria-label="{{utility}}">
    <rect class="bg" x="314" y="214" width="238" height="112" rx="3"/>
    <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="314" y="214" width="238" height="112" rx="3"/>
      <path d="M328 256h126" stroke-width="3"/><path d="M336 256v8M446 256v8"/>
      <rect x="334" y="226" width="48" height="30" rx="2" fill="#e7d3ae"/><rect x="346" y="236" width="24" height="10" rx="1.5" fill="#fff" stroke-width="1.5"/>
      <circle cx="400" cy="245" r="11" fill="#e5a93f"/><circle cx="400" cy="245" r="4.5" fill="#fdf8ee"/>
      <rect x="418" y="234" width="32" height="22" rx="2" fill="#dceaf0"/>
      <rect x="468" y="252" width="66" height="72" rx="6" fill="#fff"/><path d="M468 266h66"/><circle cx="501" cy="295" r="18" fill="#e2ebee"/><circle cx="501" cy="295" r="11" fill="#fff" stroke-width="1.5"/><path d="M478 259h10" stroke-width="2.5"/>
      <path d="M344 296h76l-6 28h-64Z" fill="#e7d3ae"/><path d="M354 304h56M356 314h52" stroke-width="1.4"/>
    </g>
    <rect class="edge" x="314" y="214" width="238" height="112" rx="3"/>
    <g class="pin"><circle class="ring" cx="434" cy="286" r="8"/><circle cx="434" cy="286" r="8.5" fill="#fff" stroke="#b4472e" stroke-width="1.5"/><circle class="dot" cx="434" cy="286" r="3.6"/></g>
  </g>

  <!-- KITCHEN -->
  <g class="room" data-room="kitchen" tabindex="0" role="button" aria-pressed="false" aria-label="{{kitchen}}">
    <rect class="bg" x="88" y="342" width="290" height="112" rx="3"/>
    <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="88" y="342" width="290" height="112" rx="3"/>
      <rect x="102" y="354" width="58" height="100" rx="7" fill="#fff"/><path d="M102 388h58"/><path d="M151 364v14M151 398v22" stroke-width="2.5"/>
      <circle cx="115" cy="368" r="3.6" fill="#b4472e" stroke="none"/><circle cx="128" cy="402" r="3.6" fill="#1f4257" stroke="none"/>
      <rect x="111" y="408" width="20" height="20" fill="#fbe8a6" stroke-width="1.4" transform="rotate(-6 121 418)"/>
      <rect x="206" y="356" width="76" height="42" rx="2" fill="#fff"/><rect x="211" y="361" width="66" height="32" fill="#dceaf0" stroke="none"/><path d="M244 360v36M210 377h68" stroke="#fff" stroke-width="3"/><rect x="206" y="356" width="76" height="42" rx="2"/>
      <rect x="176" y="414" width="190" height="40" fill="#e2ebee"/><path d="M172 414h198" stroke-width="3.5"/><path d="M239 418v32M302 418v32M228 432v6M250 432v6M314 432v6"/>
      <rect x="312" y="394" width="38" height="20" rx="3" fill="#b4472e"/><path d="M306 398h6M350 398h6M318 390h26"/>
      <path d="M326 386c0-6 4-6 4-12M336 386c0-6 4-6 4-12" stroke="#6f7a82" stroke-width="1.5"/>
    </g>
    <rect class="edge" x="88" y="342" width="290" height="112" rx="3"/>
    <g class="pin"><circle class="ring" cx="182" cy="370" r="8"/><circle cx="182" cy="370" r="8.5" fill="#fff" stroke="#b4472e" stroke-width="1.5"/><circle class="dot" cx="182" cy="370" r="3.6"/></g>
  </g>

  <!-- PANTRY -->
  <g class="room" data-room="pantry" tabindex="0" role="button" aria-pressed="false" aria-label="{{pantry}}">
    <rect class="bg" x="390" y="342" width="162" height="112" rx="3"/>
    <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="390" y="342" width="162" height="112" rx="3"/>
      <path d="M400 382h142M400 418h142" stroke-width="3"/>
      <rect x="408" y="360" width="16" height="22" rx="3" fill="#fcecc4"/><path d="M406 360h20"/>
      <rect x="430" y="364" width="14" height="18" rx="3" fill="#f4ddd2"/><path d="M428 364h18"/>
      <rect x="452" y="356" width="20" height="26" rx="1.5" fill="#e7d3ae"/>
      <rect x="476" y="356" width="20" height="26" rx="1.5" fill="#e7d3ae"/>
      <rect x="504" y="362" width="28" height="20" rx="1.5" fill="#fff"/>
      <rect x="408" y="400" width="14" height="18" rx="1.5" fill="#b4472e"/><rect x="424" y="400" width="14" height="18" rx="1.5" fill="#b4472e"/>
      <path d="M460 418v-12l4-6v-6h6v6l4 6v12Z" fill="#dceaf0"/>
      <rect x="486" y="396" width="26" height="22" rx="1.5" fill="#fff"/><rect x="516" y="402" width="18" height="16" rx="1.5" fill="#fcecc4"/>
      <path d="M410 454v-16c0-6 4-8 10-8h30c6 0 10 2 10 8v16" fill="#e7d3ae"/><circle cx="424" cy="440" r="4" fill="#d6b98a" stroke-width="1.4"/><circle cx="440" cy="442" r="4" fill="#d6b98a" stroke-width="1.4"/>
      <path d="M492 454v-22l6-6h18l6 6v22Z" fill="#fff"/>
    </g>
    <rect class="edge" x="390" y="342" width="162" height="112" rx="3"/>
    <g class="pin"><circle class="ring" cx="536" cy="438" r="8"/><circle cx="536" cy="438" r="8.5" fill="#fff" stroke="#b4472e" stroke-width="1.5"/><circle class="dot" cx="536" cy="438" r="3.6"/></g>
  </g>

  <!-- CELLAR: DRINKS -->
  <g class="room" data-room="drinks" tabindex="0" role="button" aria-pressed="false" aria-label="{{drinks}}">
    <rect class="bg" x="88" y="486" width="236" height="92" rx="3"/>
    <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="88" y="486" width="236" height="92" rx="3"/>
      <path d="M200 486v10"/><circle cx="200" cy="502" r="6" fill="#fcecc4"/>
      <path d="M110 532v-12M122 532v-12M134 532v-12M146 532v-12M158 532v-12" stroke-width="3.5"/>
      <rect x="102" y="532" width="64" height="46" rx="3" fill="#1f4257"/><path d="M112 546h44" stroke="#fff" stroke-width="2"/>
      <path d="M182 532v-12M194 532v-12M206 532v-12M218 532v-12M230 532v-12" stroke-width="3.5"/>
      <rect x="174" y="532" width="64" height="46" rx="3" fill="#e5a93f"/><path d="M184 546h44" stroke="#fff" stroke-width="2"/>
      <rect x="254" y="500" width="56" height="78" rx="2" fill="#efe0c2"/><path d="M254 526h56M254 552h56M282 500v78"/>
      <circle cx="268" cy="513" r="5" fill="#93361f"/><circle cx="296" cy="539" r="5" fill="#93361f"/><circle cx="268" cy="565" r="5" fill="#2d5b75"/>
    </g>
    <rect class="edge" x="88" y="486" width="236" height="92" rx="3"/>
    <g class="pin"><circle class="ring" cx="126" cy="504" r="8"/><circle cx="126" cy="504" r="8.5" fill="#fff" stroke="#b4472e" stroke-width="1.5"/><circle class="dot" cx="126" cy="504" r="3.6"/></g>
  </g>

  <!-- CELLAR: CHEST FREEZER -->
  <g class="room" data-room="freezer" tabindex="0" role="button" aria-pressed="false" aria-label="{{freezer}}">
    <rect class="bg" x="336" y="486" width="216" height="92" rx="3"/>
    <g fill="none" stroke="#1d2a33" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
      <rect x="336" y="486" width="216" height="92" rx="3"/>
      <path d="M444 486v10"/><circle cx="444" cy="502" r="6" fill="#fcecc4"/>
      <rect x="362" y="526" width="152" height="52" rx="7" fill="#fff"/><path d="M362 538h152"/><rect x="424" y="542" width="30" height="6" rx="3" fill="#e2ebee"/>
      <path d="M384 556v14M377 559l14 8M391 559l-14 8" stroke="#2d5b75" stroke-width="1.6"/>
      <circle cx="496" cy="560" r="3" fill="#1d9a63" stroke="none"/>
    </g>
    <rect class="edge" x="336" y="486" width="216" height="92" rx="3"/>
    <g class="pin"><circle class="ring" cx="530" cy="506" r="8"/><circle cx="530" cy="506" r="8.5" fill="#fff" stroke="#b4472e" stroke-width="1.5"/><circle class="dot" cx="530" cy="506" r="3.6"/></g>
  </g>
</svg>