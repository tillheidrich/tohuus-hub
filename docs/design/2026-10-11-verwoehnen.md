# „Verwöhnen“: der Bestellmodus als „einander was Gutes tun“ (Welle 6, 11.10.2026)

Till: „Den Bestellmodus so umbauen, dass er ganz klar in die Richtung ‚im Alltag was zurückgeben‘ und natürlich bzgl. Gästen und Party verstanden werden kann. Wenn die Frau das Kind ins Bett bringt und das Vanilleeis über die App ordert, dann ist der Abend nicht mehr ganz so schlimm.“

## Name

| Sprache | Name (Navigation, Titel) | Leitsatz |
|---|---|---|
| DE | **Verwöhnen** | Einander was Gutes tun |
| EN | **Treats** | Do each other a good turn |
| SV | **Ompyssling** | Pyssla om varandra |

Warum dieser Name:
- **Bestellen** klingt nach Lieferdienst und Kasse. Im Alltag geht es aber nicht ums Bestellen, sondern darum, dass jemand, der gerade festsitzt (Zubettbringen, krank, spät gearbeitet), sich eine Kleinigkeit wünschen darf und jemand anderes sie bringt.
- **Verwöhnen** trägt beide Richtungen: sich verwöhnen lassen und andere verwöhnen. Das funktioniert genauso für Gäste („Gäste verwöhnen“) und Partys, ohne einen zweiten Begriff.
- **Verworfen:** „Bringdienst“ (wieder Dienstleistung, Lieferdienst-Ton, im Englischen und Schwedischen ohne gutes Gegenstück), „Wunschzettel“ (Weihnachten, und „Wunsch“ ist im Kinder-Modus schon belegt), „Bitte bring mir …“ (zu lang für die Leiste, passt nicht für Partys), „Room service“ (Hotel, Bedienrolle).
- **EN „Treats“** ist kurz genug für die Leiste und meint „Kleinigkeiten, die man jemandem gönnt“. **SV „Ompyssling“** (pyssla om någon = sich liebevoll um jemanden kümmern) passt auch zum kranken Partner mit Tee.
- „Bestellung“ bleibt, wo es technisch ist: Party-Statistik, Küchenzettel für Gäste und Partys, Board-Begriffe, Importe.

Route bleibt `/bestellen` (Links, QR-Etiketten, Benachrichtigungen bleiben gültig). `?mode=guests` und `?mode=party` öffnen die anderen Modi.

## Aufbau der Seite

Ein Segment mit drei Modi:

1. **Für mich** (Standard bei Paar, Familie, WG und solange keine Haushaltsform gewählt ist): grüner Kopfblock „Was hättest du gern?“ mit „Wer bringt’s?“ (Wer gerade kann oder eine Person). Darunter „Für dich“ als Ticket (was andere sich von mir wünschen, mit „Ich bring’s“ / „Geht gerade nicht“ plus Grund-Chips), „Deine Wünsche“ mit warmem Status und einem kleinen „Danke“, dann große Kacheln: Was Süßes, Was zu trinken, Was zum Knabbern, Aus dem Kühlschrank (nur wenn echter Bestand an einem Ort vom Typ Kühlschrank liegt), Alles, was da ist, Was anderes (freier Wunsch). Desktop ab 1100 px zweispaltig.
2. **Gäste**: Erklärung, Gäste-Links mit Vorlagen Besuch, Babysitter, Großeltern, darunter „Was Gäste gerade möchten“.
3. **Party**: Party-Karte (Start, TV, Abschluss) und „An der Bar“ mit Link aufs ganze Board.

**Allein wohnen:** Der Alltags-Modus entfällt, die Seite heißt „Gäste & Party“. Dauergäste (Oma Inge mit eigenem Konto) sehen nur „Für mich“. Ein geteiltes Gerät ohne Person (Kiosk) fragt wie ein Gast nach dem Namen.

## Ablauf und Texte

| Status | Zu Hause | Gast | Party |
|---|---|---|---|
| neu | Abgeschickt – wartet auf ein „Ich bring’s“ | Ist angekommen | Ist angekommen |
| angenommen | Kommt gleich – Lea bringt’s | Kommt gleich | Wird gemacht |
| erledigt | Lea hat’s gebracht | Ist unterwegs zu dir | Steht bereit an der Theke |
| abgelehnt | Geht gerade nicht – Gleich, in ein paar Minuten | Geht gerade nicht | Geht gerade nicht |

- Benachrichtigung zu Hause: „Lea hätte gern was“ bzw. „Lea fragt dich nach was“ (nur das Handy der gewählten Person klingelt), Knöpfe „Ich bring’s“ / „Geht gerade nicht“ (Web Push und Telegram). Gäste und Party behalten „Mach ich“ / „Fertig“.
- Antwort an die fragende Person (`order.status`, nur an sie, Push standardmäßig an, Telegram/Gotify/Matrix aus). Gäste ohne Konto bekommen keine Push.
- Danke: einmal pro Wunsch, nur von der fragenden Person, geht nur an die Person, die es gebracht hat. Keine Zähler, keine Punkte, keine Liste.
- Küchenzettel für Wünsche von zu Hause: Titel „Bitte bringen“, „Für“ und „Wer bringt’s“.

## Technik

- Migration `order-1` (in `server/lib/orders.ts`): `orders.for_user_id`, `by_user_id`, `by_name`, `reason`, `thanked_at`.
- `orderSchema.bring_by` (nur Haushaltsmitglieder, nie man selbst oder Dauergäste), `setOrderStatus(id, status, { by, reason })`, `thankOrder`, `requestsFor`, `helpers`, `statusLine`, `orderKind`, `DECLINE_REASONS`.
- API: `GET /api/bar/helpers`, `GET /api/bar/requests`, `GET /api/bar/reasons`, `POST /api/bar/orders/:id/thanks`; `PATCH /api/orders/:id` nimmt `reason` und merkt sich, wer geantwortet hat.
- Kachel-Tags (`tags` im Haushaltsmenü): Gruppe zuerst, dann Name; „fridge“ nur aus echtem Bestand an Orten mit `kind = 'fridge'`.
- Benachrichtigungsaktion `order-decline`; `NotifyInput.toUserId` schickt Web Push an eine Person (`null` = an niemanden).
- MCP `set_order_status` nimmt `reason` und trägt den Akteur als Bringer ein.
- Tests: `test/order.test.ts`.
