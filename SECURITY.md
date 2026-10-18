# Sicherheit — ToHuus Hub / ToHuus Cloud

Klasse: K3 (ToHuus Cloud, öffentliche Registrierung, viele Haushalte) · K2 (selbst gehostete Instanzen wie Fredirando, nur Familie)
Stand: 18.10.2026 · Standard: https://wiki.heidrich-digital.de/doc/sicherheitsstandard-app-projekte-owasp-start-hier-18102026-YfB9ALPQ01
Prüfung: https://wiki.heidrich-digital.de/doc/sicherheitsprufung-tohuus-vor-app-store-start-18102026-KzLLjHs2Ey

## Lücke gefunden?

Bitte **nicht** als öffentliches Issue melden, sondern per Mail an **security@tillheidrich.de**.
Wir antworten binnen einer Woche, sagen dir, wie es weitergeht, und nennen dich auf Wunsch im Changelog.
Maschinenlesbar: `/.well-known/security.txt` (RFC 9116) in der Cloud und auf tohuus.heidrich-digital.de.

Bitte teste nur mit eigenen Konten und Haushalten, nicht gegen fremde Daten, und ohne Last- oder Spam-Tests.

## Daten

- **accounts.db** (Cloud, verschlüsselt): E-Mail, Passwort-Hash (scrypt), Sitzungen, App-Token (gehasht, laufen 180 Tage nach letzter Nutzung ab), Passkeys, Apple-Verknüpfung, Käufe.
- **Pro Haushalt eine SQLCipher-Datenbank** plus Dateien (Bilder, Bons/PDF, Videos). Schlüssel pro Haushalt, umschlagverschlüsselt mit `TOHUUS_MASTER_KEY` (nur Coolify-ENV und Vaultwarden, nie im Volume oder Repo).
- **Besondere Kategorien:** Allergien und Gesundheit (an die KI nur mit `ai.health_share`), Kinderprofile und Kinder-Geräte, Pflege („Für wen ich da bin“), Hausinfo-Codes (Tür, WLAN).
- **KI:** OpenRouter, fest auf Mistral/EU. Fremdinhalte (Bons, Mails, Webseiten) gelten als Daten, nicht als Anweisungen.
- Wessen Daten: Familien und Wohngemeinschaften, also auch Kinder und Pflegebedürftige, die selbst kein Konto haben.

## Wer darf was

- Die Haushalts-ID kommt nur aus der Sitzung, aus App-Token plus Mitgliedschaftsprüfung oder aus einem gehashten Token mit Routing-Präfix. Nie aus Body oder Header ohne Mitgliedschaftsprüfung. Ohne Kontext wirft jeder Datenbankzugriff (fail closed).
- Rollen: Admin, Mitglied, Dauergast (Stufen), Gast-Link, Kinder-Gerät, Display, Home-Assistant-Token, MCP (OAuth-Scopes read/write/health).
- Privat bleibt privat: private Listen, Wünsche, Ausgaben und Assistent-Verläufe sind für andere Mitglieder, Gäste, KI, MCP, Home Assistant und Exporte unsichtbar.
- Betrieb (betrieb.tohuus…): nur `OPERATOR_EMAILS`, Passwort plus TOTP, nur Aggregate, Audit-Log, kein Zugriff auf Haushaltsinhalte.

## Das Schlimmste, was passieren kann

1. Ein Haushalt sieht Daten eines anderen (Mandantenbruch).
2. Hausinfo-Codes, Gesundheits- oder Kinderdaten gelangen nach außen (KI, Logs, Export, Fremde).
3. Ein übernommenes Konto bleibt trotz Passwortwechsel übernommen.

## Abnahmetests (A01/A07)

| Nr. | Test | Erwartung | automatisiert? |
|---|---|---|---|
| T1 | Haushalt B ruft jede GET-Route mit IDs/Markern von A | 404 / keine Marker | ja (`test/cloud-isolation.test.ts`) |
| T2 | Mitglied B ruft private Einträge von Mitglied A | 404 | teilweise (`privacy`, `list-privacy`, `security-wave5`) |
| T3 | Passwortwechsel (Browser und App) und Reset | alle anderen Sitzungen, App-Token, OAuth/MCP-Verbindungen, CalDAV-Passwörter und private Kalender-Links → 401/404; beim Reset alles | ja (`test/security-a07-revoke.test.ts`, `test/security-a07-selfhost.test.ts`) |
| T4 | Abmelden in Web und App | Sitzung bzw. App-Token serverseitig weg | ja (Web: `auth`, App: `security-a07-*`) |
| T5 | App-Token 180 Tage nicht genutzt | 401, nächtlich gelöscht; Nutzung verlängert | ja (`security-a07-*`) |
| T6 | Konto löschen | keine Zeile mit E-Mail/ID in accounts.db; Haushalt inkl. Backups geschreddert | teilweise |
| T7 | Login, Reset, Link- und Code-Versand | Rate-Limit pro IP und pro Adresse; gleiche Antwort für bekannt/unbekannt | ja |
| T8 | Gast-, Display- und Kinder-Links | nur gefilterter Ausschnitt, widerrufbar | ja |

## Bewusste Ausnahmen

- Die Cloud läuft vorerst auf heidrich-infra-01 neben anderen Diensten (Standard Abschnitt 4 verlangt Trennung). Neubewertung ab 50 Haushalten oder spätestens 31.12.2026.
- CSP `style-src 'unsafe-inline'` (React-Inline-Styles), bis auf Nonces umgestellt ist.
- Haushaltsweite Token ohne Person (Home Assistant, Listen-Token, MCP-Pfad-Token des Admins) bleiben beim Passwortwechsel eines Mitglieds bestehen: Sie gehören dem Haushalt, Admins verwalten und widerrufen sie.

## Meldung von Lücken

security@tillheidrich.de — Antwort binnen einer Woche.
