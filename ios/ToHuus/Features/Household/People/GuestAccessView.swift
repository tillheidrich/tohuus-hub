import SwiftUI

/// A permanent guest's access (admins): the normal level, and a change "for a while" that ends by itself
/// (full access until Sunday evening, only ordering this weekend, paused until tonight, or any level until a time).
/// Web: people/People.tsx GuestAccess + LevelPicker. PATCH /api/people/guests/:id.
struct GuestAccessSections: View {
    let api: APIClient
    let person: Person
    let access: GuestAccessInfo
    let saved: (String) -> Void
    let failed: (String) -> Void
    @State private var custom = false
    @State private var customLevel = "family"
    @State private var customUntil = GuestPresets.nextSunday(20, 0)
    @State private var busy = false

    var body: some View {
        Section {
            LevelPickerRows(value: access.base) { level in
                Task { await send(L("Saved")) { try await api.setGuestLevel(person.id, level: level) } }
            }
        } header: { Text(LF("What %@ can see", person.name)) } footer: {
            VStack(alignment: .leading, spacing: 6) {
                if !access.areas.isEmpty {
                    Text(LF("Right now: %@", access.areas.map(GuestLevels.areaName).joined(separator: ", ")))
                } else if access.level == "paused" {
                    Text(L("Right now: paused, nothing is visible."))
                }
                Text(GuestLevels.alwaysHidden)
            }
        }

        Section {
            if access.hasOverride, let l = access.overrideLevel {
                Label {
                    Text(LF("%@ until %@, then back to “%@” by itself.", GuestLevels.title(l), PeopleText.when(access.overrideUntil), GuestLevels.title(access.base)))
                } icon: { Image(systemName: "clock") }
                Button { Task { await send(L("Back to normal")) { try await api.setGuestOverride(person.id, level: nil, until: nil) } } } label: {
                    Label(L("End now"), systemImage: "arrow.uturn.backward")
                }
            }
            ForEach(GuestPresets.all(), id: \.label) { p in
                Button {
                    Task { await send(L("Saved")) { try await api.setGuestOverride(person.id, level: p.level, until: p.until) } }
                } label: {
                    Label(p.label, systemImage: p.level == "paused" ? "pause.circle" : p.level == "family" ? "house" : "hand.raised")
                }
            }
            DisclosureGroup(L("Other …"), isExpanded: $custom) {
                Picker(L("Level"), selection: $customLevel) {
                    ForEach(GuestLevels.all, id: \.self) { Text(GuestLevels.title($0)).tag($0) }
                    Text(L("Paused")).tag("paused")
                }
                DatePicker(L("Until"), selection: $customUntil, in: Date()...Date().addingTimeInterval(90 * 86400))
                Button(LF("Set until %@", customUntil.formatted(.dateTime.weekday(.abbreviated).day().month(.abbreviated).hour().minute()))) {
                    Task { await send(L("Saved")) { try await api.setGuestOverride(person.id, level: customLevel, until: customUntil) } }
                }
                .disabled(customUntil <= Date())
            }
        } header: { Text(L("For a while")) } footer: {
            if !access.hasOverride {
                Text(L("Changes for a weekend or a holiday end by themselves – nobody has to remember to switch back."))
            }
        }
        .disabled(busy)
    }

    private func send(_ msg: String, _ work: () async throws -> Void) async {
        busy = true
        defer { busy = false }
        do {
            try await work()
            custom = false
            Haptics.success()
            saved(msg)
        } catch {
            failed(APIError.from(error).localizedDescription)
        }
    }
}

/// The four levels as rows with a check mark and the explaining line (web: LevelPicker).
struct LevelPickerRows: View {
    let value: String
    let onPick: (String) -> Void

    var body: some View {
        ForEach(GuestLevels.all, id: \.self) { l in
            Button { onPick(l) } label: {
                HStack(alignment: .top, spacing: Theme.Space.s3) {
                    Image(systemName: value == l ? "checkmark.circle.fill" : "circle")
                        .foregroundStyle(value == l ? Theme.primary : Theme.ink3)
                        .font(.title3)
                        .accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(GuestLevels.title(l)).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                        Text(GuestLevels.text(l)).font(.footnote).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.vertical, 2)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityAddTraits(value == l ? [.isButton, .isSelected] : .isButton)
        }
    }
}

/// The ready-made "for a while" choices of the web.
enum GuestPresets {
    struct Preset { let label: String; let level: String; let until: Date }

    static func all() -> [Preset] {
        [Preset(label: L("Full access until Sunday evening"), level: "family", until: nextSunday(20, 0)),
         Preset(label: L("Only ordering this weekend"), level: "order", until: nextSunday(23, 59)),
         Preset(label: L("Pause until tonight"), level: "paused", until: tonight())]
    }

    /// next Sunday (today if it is Sunday and not yet that late) at hh:mm
    static func nextSunday(_ h: Int, _ m: Int) -> Date {
        let cal = Calendar.current
        let now = Date()
        let add = (8 - cal.component(.weekday, from: now)) % 7
        let day = cal.date(byAdding: .day, value: add, to: now) ?? now
        var d = cal.date(bySettingHour: h, minute: m, second: 0, of: day) ?? day
        if d <= now { d = cal.date(byAdding: .day, value: 7, to: d) ?? d }
        return d
    }

    static func tonight() -> Date {
        Calendar.current.date(bySettingHour: 23, minute: 59, second: 0, of: Date()) ?? Date().addingTimeInterval(3600)
    }
}

/// "Send login link": by e-mail when the server can send mail, otherwise a link and a QR code to hand over.
/// Works once and for 3 days. Web: people/People.tsx LoginLinkSheet. POST /api/people/users/:id/login-link.
struct LoginLinkSheet: View {
    let api: APIClient
    let person: Person
    @Environment(\.dismiss) private var dismiss
    @State private var mail = false
    @State private var email = ""
    @State private var result: LoginLinkResult?
    @State private var busy = false
    @State private var error: String?
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                if result == nil {
                    Section {
                        Text(LF("%@ opens the link and is signed in on that device – no password. It works once and for 3 days.", person.name))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                    if mail {
                        Section {
                            TextField(L("name@example.org"), text: $email)
                                .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                                .textContentType(.emailAddress)
                            Button { Task { await go("email") } } label: { Label(L("Send by e-mail"), systemImage: "envelope") }
                                .disabled(busy || email.trimmingCharacters(in: .whitespaces).isEmpty)
                        } header: { Text(L("E-mail")) }
                    }
                    Section {
                        Button { Task { await go("link") } } label: { Label(L("Show link & QR code"), systemImage: "qrcode") }
                            .disabled(busy)
                    } footer: {
                        if !mail { Text(L("E-mail is not set up on this server – show the QR code or send the link yourself.")) }
                    }
                    if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                }
                if let r = result, r.sent == true {
                    Section {
                        Label(LF("Sent to %@.", r.email ?? email), systemImage: "envelope.badge")
                            .font(.body.weight(.semibold))
                        Text(LF("Once %@ opens it, the address is confirmed and they can ask for new links themselves.", person.name))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                }
                if let url = result?.url {
                    Section {
                        VStack(spacing: Theme.Space.s3) {
                            if let qr = QRCode.image(url) {
                                Image(uiImage: qr).interpolation(.none).resizable().scaledToFit()
                                    .frame(width: 220, height: 220)
                                    .padding(Theme.Space.s3)
                                    .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                                    .accessibilityLabel(L("QR code of the sign-in link"))
                            }
                            Text(url).font(.caption.monospaced()).foregroundStyle(Theme.ink3).multilineTextAlignment(.center).textSelection(.enabled)
                            ShareLink(item: url, subject: Text(L("Sign in")), message: Text(L("Your sign-in link for our household app:"))) {
                                Label(L("Share"), systemImage: "square.and.arrow.up")
                            }
                            .buttonStyle(PrimaryButtonStyle())
                            Button {
                                UIPasteboard.general.string = url
                                copied = true
                            } label: { Label(copied ? L("Link copied") : L("Copy link"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                                .buttonStyle(SecondaryButtonStyle())
                            Text(LF("Scan it with %@’s phone. Works once, for 3 days. It is shown only now.", person.name))
                                .font(.caption).foregroundStyle(Theme.ink3).multilineTextAlignment(.center)
                        }
                        .frame(maxWidth: .infinity)
                        .listRowBackground(Color.clear)
                    }
                }
            }
            .themedList()
            .navigationTitle(LF("Sign-in link for %@", person.name))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task {
                email = person.email ?? ""
                mail = await api.mailAvailable()
            }
        }
    }

    private func go(_ deliver: String) async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            result = try await api.personLoginLink(person.id, deliver: deliver, email: deliver == "email" ? email.trimmingCharacters(in: .whitespaces) : nil)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
