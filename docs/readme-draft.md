# Entwurf: neuer Kopf für README.md (18.10.2026)

Nur ein Vorschlag, README.md selbst ist unverändert. Till entscheidet, ob und wann er übernommen wird. Ersetzt
würde der Teil von `<p align="center">` bis einschließlich „## Screenshots“ (Tabelle und Satz darunter). Alles ab
„## Features“ bleibt. Grund: Die README beschreibt ToHuus noch als App rund um Vorrat und Einkauf. Seit Build 15 gilt
der Kernsatz „Ein Ort für den Haushalt … Einkaufen ist der Einstieg, nicht die ganze App“. Keine echten Namen, keine
anderen Apps im Kopf.

---

```markdown
<p align="center">
  <img src="web/public/icon.svg" width="88" alt="ToHuus Hub logo" />
</p>

<h1 align="center">ToHuus Hub</h1>

<p align="center"><a href="https://tohuus.heidrich-digital.de">Website</a> · <a href="https://tohuus.heidrich-digital.de/de/">Deutsch</a> · <a href="https://apps.apple.com/app/tohuus/id6822059656">App Store</a></p>

<p align="center">
  <b>One place for the household.</b><br/>
  What is missing, what is coming up, what needs doing, what it costs and what you know about your home.
</p>

<p align="center">
  <a href="LICENSE"><img alt="AGPL-3.0" src="https://img.shields.io/badge/license-AGPL--3.0-1d9a63"></a>
  <img alt="Docker" src="https://img.shields.io/badge/docker-ready-17181a">
  <img alt="MCP" src="https://img.shields.io/badge/MCP-106%20tools-17181a">
  <a href="https://github.com/tillheidrich/tohuus-hub-ha"><img alt="Home Assistant" src="https://img.shields.io/badge/Home%20Assistant-HACS%20integration-17181a"></a>
</p>

---

## What it is

ToHuus Hub is the memory of your home, for people who live alone, as a couple, as a family or in a shared flat. Shopping is where it starts, not the whole app: next to the shared list there are chores and appointments, the pantry, cooking, money, home knowledge and an assistant.

You put things in, ToHuus sorts them, and you find them again:

1. **Put it in.** Type it, say it or snap a receipt: “We’re out of milk”, “Recycling bin every two weeks”, “Mika’s shoe size is 12 now”.
2. **ToHuus sorts it.** The milk goes on the list, the bin into the chores, the shoe size into the home knowledge.
3. **Find it any time.** Today shows what is coming up, everything else is one search or one question away.

No folders, no categories, nothing to maintain. ToHuus replaces neither your calendar nor your notes app: it reads bin collection days from your calendar if you like, writes chores back, and sends lists as text wherever you want.

*To Huus* is Low German for "at home". The app speaks English and German.

It runs as one Docker container with a SQLite file. No account with us, no telemetry, no cloud service required. If you would rather not run a server, the same app runs in ToHuus Cloud (servers in Germany, 14 days free, then a subscription per household).

## Screenshots

<table>
  <tr>
    <td><img src="site/assets/shots/en/today-480.webp" width="200" alt="Today with Coming up" /></td>
    <td><img src="site/assets/shots/en/shopping-480.webp" width="200" alt="Shopping list" /></td>
    <td><img src="site/assets/shots/en/tasks-480.webp" width="200" alt="Chores" /></td>
  </tr>
  <tr>
    <td align="center">Today</td>
    <td align="center">List</td>
    <td align="center">Chores</td>
  </tr>
  <tr>
    <td><img src="site/assets/shots/en/knowledge-480.webp" width="200" alt="Home knowledge" /></td>
    <td><img src="site/assets/shots/en/pantry-480.webp" width="200" alt="Pantry" /></td>
    <td><img src="site/assets/shots/en/assistant-480.webp" width="200" alt="Assistant" /></td>
  </tr>
  <tr>
    <td align="center">Home knowledge</td>
    <td align="center">Pantry</td>
    <td align="center">Assistant</td>
  </tr>
</table>

The screenshots show a demo household with invented names and receipts. German versions are in [`site/assets/shots/de/`](site/assets/shots/de/).
```
