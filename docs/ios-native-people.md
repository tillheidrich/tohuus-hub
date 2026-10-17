# iOS natively: people, children, permanent guests, sign-in, kid mode

Status 14 Oct 2026. Everything the web shows under Settings › Members (people/People.tsx, DataSettings.tsx `Members`,
AuthSettings.tsx `SignInAdmin`, KidsSettings.tsx) and the kid tablet (Kids.tsx, `/kids/:token`) now exists in the
iPhone/iPad app. Code: `ios/ToHuus/Features/Household/HouseholdView.swift` and `ios/ToHuus/Features/Household/People/`.
German strings: `ios/tools/strings_de_people.json`.

## Screens

| Screen | File | Web counterpart |
|---|---|---|
| Unser Haushalt (people grouped Familie/WG/Haushalt, Kinder, Dauergäste; add menu; kids; sign-in; names on the sign-in screen) | `HouseholdView.swift` | Settings › Members (`PeopleSection`, `Members`, `KidsSection`) |
| One person: picture (photo with square crop, initials, 8 animals), colour, child name + year, allergies/dislikes/likes (health-data consent), guest access, sign-in link, member ⇄ permanent guest, remove | `People/PersonAdminView.swift`, `People/PhotoCropSheet.swift` | `PersonSheet`, `FaceEditor`, `CropSheet`, `PrefsEditor`, `ChildDetails`, `KindSwitch` |
| Likes, dislikes, most cooked | `PersonProfileView` in `PersonAdminView.swift` | `Ratings.tsx PersonProfileSheet` |
| Guest access: level picker with what is never visible, the areas the level opens, "for a while" (3 presets + any level until a time, max. 92 days), end now | `People/GuestAccessView.swift` | `GuestAccess`, `LevelPicker` |
| Sign-in link (e-mail when the server has SMTP, otherwise QR code, share, copy) | `LoginLinkSheet` in `GuestAccessView.swift` | `LoginLinkSheet` |
| Add a child / a permanent guest / with a password (self-hosted) | `People/AddPersonSheets.swift` | `AddChildSheet`, `AddGuestSheet`, `AddWithPassword` |
| Ways to sign in, SSO, how members sign in (reset link by e-mail or QR, sign out everywhere, remove TOTP / PIN / SSO link) – self-hosted only | `People/SignInAdminView.swift` | `SignInAdmin`, `SsoSettings`, `MemberSheet` |
| Kids: profiles, wishes waiting (approve / not now, also by swipe), kid detail, profile form, rules, "Where is …?" with place photos, pairing, tablets, AI per child | `People/KidsAdminView.swift`, `People/KidRulesView.swift` | `KidsSettings`, `KidWishesCard`, `KidForm`, `RulesSheet`, `FindSheet`, `PairSheet` |
| Kid mode on this iPad/iPhone | `People/KidModeView.swift`, `People/KidArt.swift` | `Kids.tsx KidMode`, `ExitPad`, `KidArt.tsx` |

Invitations stay in `InvitesView.swift` (already complete: create, mail or link/QR, renew, resend, withdraw).

## Endpoints (all existing, same as the web)

- People: `GET /api/people`, `GET /api/people/person/:key`, `PUT /api/people/{me|person/:key}/{face,color,prefs}`,
  `POST|DELETE /api/people/{me|person/:key}/photo` (multipart `image`, 512 px JPEG cropped on the device),
  `POST /api/people/children`, `PATCH|DELETE /api/people/children/:id`, `POST /api/people/guests`,
  `PATCH /api/people/guests/:id { level } | { override: { level, until } | null }`, `PUT /api/people/users/:id/kind`,
  `POST /api/people/users/:id/login-link { deliver, email? }`, `DELETE /api/users/:id`, `POST /api/users` (self-hosted).
  Allergies answer `409 { code: 'health_consent' }` until the household confirmed once – the app asks and repeats with `consent: true`.
- Sign-in (admins, self-hosted; the cloud answers 404 for most of these, so the screen is only linked when `!app.isCloud`):
  `GET|PATCH /api/auth/policy`, `PUT /api/auth/sso`, `POST /api/auth/sso/test`, `GET /api/auth/members`,
  `POST /api/auth/members/:id/reset-link|signout`, `DELETE /api/auth/members/:id/totp|pin|sso`,
  `GET|PATCH /api/data/settings { showNames }`, `GET /api/auth/me` (`mail`).
- Kids: `GET /api/kids`, `POST /api/kids`, `PATCH|DELETE /api/kids/:id`, `PUT /api/kids/:id/ai`, `POST /api/kids/:id/devices`,
  `DELETE /api/kids/devices/:id`, `GET /api/kids/wishes`, `POST /api/kids/wishes/:id`, `GET /api/kids/places`,
  `POST|DELETE /api/kids/places/:id/photo`.
- Kid tablet (no sign-in, token in the path; in the cloud the token's routing prefix names the household):
  `GET /api/kid/:token`, `POST /api/kid/:token/wish { product_id }`, `POST /api/kid/:token/exit { pin }`.

No server change was needed.

## Kid mode on the device (kid lock)

- An admin opens Kinder › a kid › "Dieses iPad als Kinder-Tablet nutzen". The app pairs the device like a tablet
  (`POST /api/kids/:id/devices`, label "Dieses iPad") and stores server address + device token in `UserDefaults`
  (`kidMode.base`, `kidMode.token`, `KidModeStore`). A link made on another phone can be pasted under
  "Kinder-Tablet-Link auf diesem Gerät öffnen" (`…/kids/<token>`).
- While a token is stored, `.kidModeGate()` on the root view shows only `KidModeView` – also after a relaunch, and
  also when nobody is signed in. Sheets and tabs of the grown-up app are gone.
- Leaving: the lock button → parent PIN (`/exit`, 5 tries per 10 minutes on the server). Without a PIN, a parent removes
  the tablet on another device; the next refresh gets 404 and the tablet shows "no longer in kid mode" → "ToHuus öffnen".
- Like the web: big picture tiles (photo or the web's food drawings), confirm with ✓ / ✕, "Gefragt!" overlay,
  tile states later/enough/busy/quiet with the reason, wish strip (waiting / coming / here / maybe later), quiet hours
  with a moon, "Wo ist …?" with place photos, read aloud (AVSpeechSynthesizer in the household language, parents
  switch it on per kid, the kid can mute it). Refresh every 20 s and on returning to the app. Home indicator and status
  bar hidden; Guided Access is recommended in the confirmation text (iOS cannot lock the home gesture for an app).
- The kid tablet never sees the assistant; the AI switch per child is in the kid detail (and in Access & AI).

## Debug

No new launch args. `-debugMore people` (with `-debugSettings YES`) opens Unser Haushalt as before.
To leave a stuck kid mode in the simulator: `xcrun simctl spawn booted defaults delete de.heidrichdigital.tohuus kidMode.token`.
