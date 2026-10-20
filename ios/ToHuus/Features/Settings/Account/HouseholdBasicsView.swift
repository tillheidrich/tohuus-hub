import SwiftUI

/// Mehr › Haushalt (web: Settings › Haushalt – Household, HouseholdAppearanceCard, RegionCard, ModulesCard):
/// the household's name and language, how the app looks, where you shop, and which areas you use.
/// Admins change; everyone else sees the values.
struct HouseholdBasicsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var settings: HouseholdSettings?
    @State private var region: RegionInfo?
    @State private var name = ""
    @State private var error: String?
    @State private var toast: ToastMessage?
    @FocusState private var nameFocused: Bool

    /// web: server/languages.ts LANGUAGES
    private let languages = ["en", "de"]
    private func languageName(_ code: String) -> String { code == "de" ? "Deutsch" : "English" }

    private var nameChanged: Bool {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        return !n.isEmpty && n != (settings?.household ?? "")
    }

    var body: some View {
        Form {
            if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.empty) } }
            Section {
                if app.isAdmin {
                    HStack {
                        TextField(L("Household name"), text: $name)
                            .focused($nameFocused)
                            .submitLabel(.done)
                            .onSubmit { Task { await saveName() } }
                        if nameChanged {
                            Button(L("Save")) { Task { await saveName() } }.buttonStyle(.borderless)
                        }
                    }
                } else {
                    LabeledContent(L("Household name"), value: settings?.household ?? "–")
                }
                Picker(selection: Binding(get: { settings?.language ?? "de" }, set: { v in Task { await saveLanguage(v) } })) {
                    ForEach(languages, id: \.self) { l in Text(languageName(l)).tag(l) }
                } label: {
                    Label(L("Language"), systemImage: "character.bubble")
                }
                .disabled(!app.isAdmin)
            } header: {
                Text(L("Household"))
            } footer: {
                Text(L("The household language is used for mails, notifications and new categories. The app itself follows the language of your iPhone."))
            }
            // Darstellung, Region, Was nutzt ihr?, Kochstil, Wochenfrage, Extras, Sterne: own rows in Einstellungen
            // (Ich, Haushalt, Bereiche & Orte – SettingsHome.swift), so this screen is only name and language
            if !app.isAdmin { Section { Text(L("Only admins can change this.")).font(.footnote).foregroundStyle(Theme.ink3) } }
        }
        .themedList()
        .navigationTitle(L("Name & language"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
    }

    private func load() async {
        do {
            settings = try await api.householdSettings()
            if !nameFocused { name = settings?.household ?? "" }
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
        region = try? await api.region()
    }

    private func saveName() async {
        let n = name.trimmingCharacters(in: .whitespacesAndNewlines)
        guard app.isAdmin, nameChanged else { return }
        do {
            _ = try await api.send("PATCH", "api/settings", json: ["household": String(n.prefix(60))], as: Ignored.self)
            nameFocused = false
            toast = ToastMessage(text: L("Saved"))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func saveLanguage(_ code: String) async {
        guard app.isAdmin, code != settings?.language else { return }
        do {
            _ = try await api.send("PATCH", "api/settings", json: ["language": code], as: Ignored.self)
            toast = ToastMessage(text: L("Saved"))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Darstellung (web: AppearanceSettings.tsx): one appearance for the household (admins), optionally everyone picks
/// their own (PATCH /api/appearance/household { theme, userChoice }, PATCH /api/appearance/me { theme | null }).
/// The answer's `theme` is applied on this iPhone right away; "Nur auf diesem iPhone" overrides it for this device.
struct AppearanceSettingsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @AppStorage(AppAppearance.storageKey) private var device = AppAppearance.system.rawValue
    @State private var info: AppearanceInfo?
    @State private var error: String?
    @State private var toast: ToastMessage?

    private let themes = ["light", "dark", "system"]

    var body: some View {
        Form {
            if let error { Section { Label(error, systemImage: "exclamationmark.triangle").foregroundStyle(Theme.empty) } }
            if let i = info {
                Section {
                    ThemeChoice(selected: i.household ?? "light", enabled: app.isAdmin) { t in
                        Task { await saveHousehold(["theme": t]) }
                    }
                    if app.isAdmin {
                        Toggle(isOn: Binding(get: { i.userChoice == true }, set: { v in Task { await saveHousehold(["userChoice": v]) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Let everyone choose for themselves"))
                                Text(L("Then everyone picks light or dark under Settings › Me › Appearance & readability.")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                    }
                } header: {
                    Text(L("For the household"))
                } footer: {
                    Text(app.isAdmin ? L("Applies to everyone in the household. “Like the device” follows each phone’s light or dark setting.")
                                     : L("Your admin chooses the appearance for the household."))
                }
                if i.userChoice == true {
                    Section {
                        Picker(L("For me"), selection: Binding(get: { i.mine ?? "" }, set: { v in Task { await saveMine(v.isEmpty ? nil : v) } })) {
                            Text(L("Use the household setting")).tag("")
                            ForEach(themes, id: \.self) { t in Text(title(t)).tag(t) }
                        }
                        .pickerStyle(.inline)
                        .labelsHidden()
                    } header: {
                        Text(L("For me"))
                    } footer: {
                        Text(i.mine != nil ? L("Only for you, on all your devices.") : LF("You are using the household setting: %@.", title(i.household ?? "light")))
                    }
                }
            } else if error == nil {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            }
            Section {
                AppearancePicker()
            } header: {
                Text(L("Only on this iPhone"))
            } footer: {
                Text(L("Changes only this device, for example dark in the evening on the kitchen iPad."))
            }
        }
        .themedList()
        .navigationTitle(L("Appearance"))
        .task { await load() }
        .toast($toast)
    }

    private func title(_ t: String) -> String {
        t == "light" ? L("Light") : t == "dark" ? L("Dark") : L("Like the device")
    }

    private func load() async {
        do {
            info = try await api.appearance()
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func apply(_ a: AppearanceInfo) {
        info = a
        if let t = a.theme, AppAppearance(rawValue: t) != nil { device = t }
    }

    private func saveHousehold(_ body: [String: Any]) async {
        do {
            apply(try await api.send("PATCH", "api/appearance/household", json: body, as: AppearanceInfo.self))
            toast = ToastMessage(text: L("Saved"))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func saveMine(_ theme: String?) async {
        do {
            apply(try await api.send("PATCH", "api/appearance/me", json: ["theme": theme.map { $0 as Any } ?? NSNull()], as: AppearanceInfo.self))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// Three small drawn screens – light, dark, like the device – to pick from (web: ThemePicker with swatches).
struct ThemeChoice: View {
    let selected: String
    let enabled: Bool
    let onPick: (String) -> Void

    var body: some View {
        HStack(spacing: Theme.Space.s3) {
            ForEach(["light", "dark", "system"], id: \.self) { t in
                Button { if enabled { onPick(t) } } label: {
                    VStack(spacing: Theme.Space.s2) {
                        swatch(t)
                        HStack(spacing: 4) {
                            if selected == t { Image(systemName: "checkmark").font(.caption.weight(.bold)) }
                            Text(title(t)).font(.caption).lineLimit(2).multilineTextAlignment(.center)
                        }
                        .foregroundStyle(selected == t ? Theme.primaryText : Theme.ink2)
                    }
                    .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.plain)
                .disabled(!enabled)
                .accessibilityLabel(title(t))
                .accessibilityAddTraits(selected == t ? .isSelected : [])
            }
        }
        .padding(.vertical, Theme.Space.s2)
    }

    private func title(_ t: String) -> String {
        t == "light" ? L("Light") : t == "dark" ? L("Dark") : L("Like the device")
    }

    private func swatch(_ t: String) -> some View {
        let light = (bg: Color(white: 0.97), card: Color.white, bar: Color(white: 0.85))
        let dark = (bg: Color(red: 0.06, green: 0.08, blue: 0.07), card: Color(red: 0.09, green: 0.13, blue: 0.11), bar: Color(white: 0.3))
        return HStack(spacing: 0) {
            half(t == "dark" ? dark : light)
            half(t == "light" ? light : dark)
        }
        .frame(height: 64)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.base).stroke(selected == t ? Theme.primary : Theme.line, lineWidth: selected == t ? 2 : 1))
        .accessibilityHidden(true)
    }

    private func half(_ c: (bg: Color, card: Color, bar: Color)) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            RoundedRectangle(cornerRadius: 2).fill(c.bar).frame(height: 5)
            RoundedRectangle(cornerRadius: 3).fill(c.card).frame(height: 18)
            Capsule().fill(Theme.primary).frame(width: 18, height: 6)
        }
        .padding(6)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(c.bg)
    }
}
