# Party-Modus – entfernt

Entfernt am 18.10.2026 auf Tills Entscheidung („den Partymodus komplett raus!“). Code in der Git-History bis Commit 265276f.

Was stattdessen gilt: Gäste wünschen sich etwas über den Gäste-Link aus „Bring mir was“ („Gäste einladen“). Ihre Wünsche landen in derselben Liste wie die Wünsche von zu Hause, mit „Gast: Name“, denselben Knöpfen und denselben Benachrichtigungen (Till: „führe das beides zusammen“).

Daten: Die Tabellen `parties`, `party_menu_items`, `party_templates` und die Spalte `orders.party_id` bleiben in der Datenbank (Migrationen `party-1`, `party-2` in `server/lib/orders.ts`), werden aber nicht mehr gelesen oder geschrieben. Bestellungen mit `party_id` werden überall ausgeblendet. Ein gespeichertes „nur bei Partys“ in der Karte gilt als „versteckt“, ein Drucker mit „während Partys“ als „aus“.
