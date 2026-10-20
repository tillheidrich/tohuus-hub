# Wünsche: Vorbild gegen Bestand (20 Oct 2026)

Reverse-Engineering einer kostenlosen iOS-Wunschlisten-App (Screenshots von Till, Name bleibt bewusst draußen) gegen den
Stand von ToHuus am 20.10.2026 (Commit 6d77da3). Spalte „vorher“ = Stand vor diesem Umbau, „jetzt“ = nach dem Umbau.
Details zur API: [wishes.md](wishes.md).

| Vorbild | vorher | jetzt | Wo |
|---|---|---|---|
| Mehrere Wunschlisten | vorhanden | vorhanden | `wish_lists` |
| Anlass + Datum („Weihnachtswünsche · 24. Dezember“) | fehlt | vorhanden: `occasion`, `event_date`, `days_until` | migration `wish-2` |
| Bereiche „Meine Listen“ / „Ich bearbeite mit“ | teilweise (nur „für wen“, keine Mitbearbeiter) | vorhanden: `editors`, `role`; Übersicht gruppiert in Meine Listen / Ich bearbeite mit / Für andere / Zum Schenken | web `Wishes.tsx`, iOS `WishesView.swift` |
| Wunsch: Titel, Foto, Preis, Shop-Link, Notiz | vorhanden | vorhanden | `wish_items`, `wish_links` |
| Menge | fehlt | vorhanden: `quantity` 1–99 | |
| Priorität mit „Hohe Priorität“-Badge | teilweise (3 Stufen, kein Badge) | vorhanden, Badge bei Stufe 3 | |
| „von Lina“ (wer den Wunsch eingetragen hat) | teilweise (`created_by`, nicht angezeigt) | angezeigt im Detail | |
| Sortieren per Ziehen | fehlt (`sort`-Spalte ungenutzt) | vorhanden: `POST /lists/:id/order`, Ziehen im Web, Verschieben auf iOS | |
| Kopfzeile mit Anzahl Wünsche, Personen/Gäste | teilweise (Anzahl) | vorhanden: Anzahl, `people`, Gast-Link aktiv | |
| „Wunsch reservieren“, „Reserviert – Noah“, „Von dir reserviert“ | vorhanden | vorhanden, Gäste mit Namen | |
| Reservierungen verborgen (Überraschung) pro Liste | teilweise (nur für die beschenkte Person) | vorhanden: `surprise` – auch Besitzer und Mitbearbeiter sehen nichts, serverseitig auf allen Lesewegen | `wish-policy.ts statusHidden` |
| Reservierungen sichtbar (Kinderliste, Eltern sehen wer) | vorhanden | vorhanden | |
| Filter „Alle / Noch frei“ | fehlt | vorhanden (nur wer reservieren darf) | |
| „Du schenkst: 2 Wünsche · 124,00 €“ | fehlt | vorhanden: `GET /api/wishes/giving` | |
| Geschenke-Einkauf „Noch zu besorgen“ / „Gekauft“ über alle Listen | fehlt | vorhanden, getrennt von der Haushalts-Einkaufsliste | `/einkauf/wuensche/schenken` |
| Teilen per Link, Gäste ohne Konto | fehlt (nur Text zum Kopieren) | vorhanden: Gast-Link `/w/<token>`, gefilterter Schnappschuss, Reservieren mit Namen, Rate-Limit | `wishGuest` |
| Mitbearbeiter einladen | fehlt | vorhanden, aus dem Haushalt | |
| Foto hochladen → KI füllt Titel/Beschreibung | fehlt | vorhanden mit KI-Zustimmung, KI-Schalter, KI-Guthaben; ohne KI-Anbieter ausgeblendet | `POST /api/wishes/ai/photo` |
| Link einfügen → Angaben ergänzen | teilweise (Server holte die Seite, SSRF-Fläche) | Server holt nichts mehr; iPhone liest per LinkPresentation, Web leitet den Titel aus der Adresse ab | |
| Platzhalter-Symbol ohne Foto | fehlt (immer Geschenk) | vorhanden: Symbol-Schlüssel aus dem Titel, lokal | `wish-icons.ts` |
| Erinnerungen an Geschenke | fehlt | vorhanden: pro Wunsch, Vorschlag 10 Tage vor dem Anlass; Sammel-Hinweis 7 Tage vorher; abschaltbar | `wish-jobs.ts` |
| Leerer Zustand mit einer Handlung | teilweise | vorhanden | |

Bestand, der nicht im Vorbild ist und bleibt: „Wer könnte das schenken“, mehrere Links mit Preisvergleich („ab …“),
„Auf die Einkaufsliste“ (privat), Merkliste und Assistent („merk dir …“), Archiv, Suche.

Abgrenzung: „Bring mir was“ (Wünsche vom Sofa und vom Kinder-Tablet, `kid_wishes`, `orders`) bleibt ein eigener
Bereich. Kinder-Tablets und Displays sehen Wunschlisten nie.
