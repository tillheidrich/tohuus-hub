# Release checklist – ToHuus Hub for Home Assistant

The folder `ha-integration/` of the ToHuus Hub repository **is** the repository `tillheidrich/tohuus-hub-ha` (MIT). Publish by copying it as is; never edit the published repo by hand without bringing the change back here.

## Before the first public release (0.3.0)

- [ ] Server side is live: ToHuus Cloud (`https://cloud.tohuus.heidrich-digital.de`) runs a build with `POST /api/ha/pair/start` / `claim` and the `/api/ha/v1/state` fields `due`, `money`, `sync`. Check: `curl -s -X POST https://cloud.tohuus.heidrich-digital.de/api/ha/pair/claim -H 'content-type: application/json' -d '{"code":"AAAA-AAAA"}'` answers `404 {"code":"invalid_code"}` (not 401).
- [ ] Create the GitHub repository `tillheidrich/tohuus-hub-ha` (public, no template, description "ToHuus Hub for Home Assistant – shopping list, week plan, sensors and notifications", topics `home-assistant`, `hacs`, `hacs-integration`, `shopping-list`).
- [ ] Copy the folder contents (including `.github/`, `.gitignore`, `brands/`, `docs/`, `dashboards/`, `tests/`, `scripts/`) to the repository root:
      `rsync -a --delete --exclude __pycache__ ha-integration/ ../tohuus-hub-ha/` (keep the target's `.git`).
- [ ] Push to `main`. All three workflows must be green: **hassfest**, **HACS** (brands ignored for now), **Tests**.
- [ ] Repository settings: Issues on; "Releases" visible; branch protection on `main` (require the three checks).

## Every release

1. Bump the version in **both** `custom_components/tohuus_hub/manifest.json` (`version`) and `custom_components/tohuus_hub/const.py` (`VERSION`). Semantic versioning: new entities/options = minor, fixes = patch.
2. `CHANGELOG.md`: new section on top with the date.
3. Locally (from the ToHuus Hub repo root):
   - `python3 ha-integration/scripts/validate.py`
   - `cd ha-integration && pip install -r requirements_test.txt && python -m pytest -q`
   - `node ha-integration/scripts/render_brand.mjs` if the app icon changed (renders from `web/public/icon.svg`).
   - Server side green: `npx vitest run test/ha.test.ts test/ha2.test.ts test/ha-pair.test.ts test/cloud-isolation.test.ts`.
4. Copy to the published repo (see above), commit "Release vX.Y.Z", push, wait for green CI.
5. Tag and release: `git tag vX.Y.Z && git push --tags`, then a GitHub release **vX.Y.Z** with the changelog section as notes. HACS offers the release to users from the tag.
6. Smoke test in a real Home Assistant (a test instance, not the family one):
   - HACS › Custom repositories › `https://github.com/tillheidrich/tohuus-hub-ha` › download › restart.
   - Add integration › **ToHuus Cloud** › code from a test household → device "ToHuus Hub" with sensors, to-do, calendar, selects.
   - Add a second entry › **Own server** › local Docker ToHuus Hub + code.
   - Tick an item in HA → gone in ToHuus within 2 s; add in ToHuus → appears in HA within 2 s.
   - Options › notify service `notify.persistent_notification`, kind "Test" → *Settings › Notifications › Test* in ToHuus shows up in HA.
   - Download diagnostics → no token, URL, household name or notify service names in the file.
   - Revoke the access in ToHuus (*Access & AI*) → HA asks to re-authenticate → new code works.
7. Screenshots for the README (`docs/`): the config flow menu (Cloud / Own server), the device page with entities, the Kitchen dashboard from `dashboards/tohuus-core.yaml` on a phone (390 px) and the Wall view on a tablet. Use test data only (households "Familie Berg", names Mira/Mika/Sam/Ben), never the family instance. Replace the text description in README › Dashboards.

## Brands and the HACS default list (after 0.3.0 is out)

- [ ] Pull request to `home-assistant/brands`: copy `brands/custom_integrations/tohuus_hub/` (icon, logo, dark variants, @2x) to `custom_integrations/tohuus_hub/` in a fork; follow their checklist (PNG, trimmed, icon 256×256 square, logo max. 256 px high). Instructions: `brands/README.md`.
- [ ] Once merged: remove `ignore: brands` from `.github/workflows/hacs.yml`, release a patch version.
- [ ] Pull request to `hacs/default`: add `tillheidrich/tohuus-hub-ha` to the `integration` file (alphabetical). Requirements: public repo, a GitHub release, green HACS action, description and topics set, brands merged.
- [ ] After the HACS PR is merged: in the ToHuus help page "Home Assistant verbinden", step "Benutzerdefiniertes Repository" becomes optional (search "ToHuus Hub" directly in HACS). Update `site/src/help.mjs` and `docs/home-assistant.md`.

## Never

- Never publish tokens, real household names, real receipts or screenshots of the family instance.
- Never send Hausinfo codes (door, alarm, Wi-Fi) through the integration: the server never includes them in `/api/ha/*`; keep it that way when adding fields.
