import SwiftUI

/// GET /api/ai/settings → { configured, household, mcp, mine, effective, reason, admin, kids?: [{ id, name, ai }] }
struct AISettings: Decodable, Sendable {
    var household: Bool?
    var mcp: Bool?
    var mine: Bool?
    var effective: Bool?
    var reason: String?
    var admin: Bool?
    var kids: [Kid]?

    struct Kid: Decodable, Sendable, Identifiable, Hashable {
        var id: Int
        var name: String
        var ai: Bool
    }
}

/// Mehr › Mit oder ohne KI: the personal switch, the household switch (admins), children (parents), and the locked state.
struct AISettingsView: View {
    @Environment(AppModel.self) private var app
    @State private var settings: AISettings?
    @State private var error: String?

    var body: some View {
        Form {
            Section {
                LabeledContent(L("In this household"), value: app.aiAvailable ? L("available") : L("off"))
                if app.aiLocked {
                    Label(L("Switched off for you by an adult in the household."), systemImage: "lock.fill")
                        .foregroundStyle(Theme.ink2)
                } else {
                    Toggle(L("Use AI for me"), isOn: Binding(get: { settings?.mine ?? app.personalAI }, set: { on in
                        settings?.mine = on
                        Task { await app.setPersonalAI(on); await load() }
                    }))
                    .disabled(!app.aiAvailable)
                }
            } footer: {
                Text(app.aiLocked ? L("You can still use everything else – the list, “Sprechen” with simple sentences, recipes.")
                                  : L("Only for you. The others decide for themselves."))
            }
            OnDeviceAISection()
            if settings?.admin == true {
                Section {
                    Toggle(L("AI for the whole household"), isOn: Binding(get: { settings?.household ?? true }, set: { on in
                        Task { await patch(household: on) }
                    }))
                    Toggle(L("Own assistants (Claude, ChatGPT) may read the household"), isOn: Binding(get: { settings?.mcp ?? true }, set: { on in
                        Task { await patch(mcp: on) }
                    }))
                } header: {
                    Text(L("Household (admins)"))
                }
            }
            if let kids = settings?.kids, !kids.isEmpty {
                Section {
                    ForEach(kids) { k in
                        Toggle(k.name, isOn: Binding(get: { k.ai }, set: { on in Task { await setKid(k, on) } }))
                    }
                } header: {
                    Text(L("Children"))
                } footer: {
                    Text(L("A child's tablet shows AI as locked when you switch it off here."))
                }
            }
            Section {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Label(L("Works without AI"), systemImage: "checkmark.circle").font(.headline)
                    Text(L("The shared list, shop mode, what ToHuus remembers from receipts and ticks, recipes, money, “Sprechen” with simple sentences, receipts read on this iPhone (with Apple Intelligence if you like)."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Label(L("AI adds"), systemImage: "sparkles").font(.headline)
                    Text(L("Free sentences to the assistant, photos of receipts and fridges read on the server, cooking help from what's at home."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                HelpLink(slug: "ki-an-oder-aus", title: L("More about AI in ToHuus"))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("With or without AI"))
        .task {
            await app.loadAIState()
            await load()
        }
    }

    private func load() async {
        guard let api = app.api else { return }
        settings = try? await api.get("api/ai/settings", as: AISettings.self)
    }

    private func patch(household: Bool? = nil, mcp: Bool? = nil) async {
        guard let api = app.api else { return }
        var body: [String: Any] = [:]
        if let household { body["household"] = household }
        if let mcp { body["mcp"] = mcp }
        do {
            _ = try await api.send("PATCH", "api/ai/settings", json: body, as: Ignored.self)
            await app.loadAIState()
            await load()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func setKid(_ k: AISettings.Kid, _ on: Bool) async {
        guard let api = app.api else { return }
        do {
            _ = try await api.send("PUT", "api/kids/\(k.id)/ai", json: ["enabled": on], as: Ignored.self)
            await load()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Apple Intelligence on this iPhone: the person's own choice, off by default (OnDeviceAI.swift).
struct OnDeviceAISection: View {
    @Environment(AppModel.self) private var app
    @State private var on = OnDeviceAI.chosen

    var body: some View {
        let state = OnDeviceAI.state
        Section {
            if app.aiLocked {
                Label(L("Switched off for you by an adult in the household."), systemImage: "lock.fill")
                    .foregroundStyle(Theme.ink2)
            } else {
                Toggle(isOn: $on) {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(L("Apple Intelligence on this iPhone"))
                        Text(stateText(state)).font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
                .disabled(state == .notSupported)
                .onChange(of: on) { _, v in OnDeviceAI.chosen = v }
            }
        } header: {
            Text(L("On this iPhone"))
        } footer: {
            Text(L("Tidies up receipt photos and handwritten lists right on this iPhone before only the text goes to ToHuus. Nothing leaves the device for this step, and it works with the household’s AI switched off. Only for this device, you can turn it off any time."))
        }
    }

    private func stateText(_ s: OnDeviceAI.State) -> String {
        switch s {
        case .available: return L("Ready on this iPhone")
        case .notEnabled: return L("Switch on Apple Intelligence in the iPhone settings first.")
        case .notReady: return L("Apple Intelligence is still getting ready on this iPhone.")
        case .notSupported: return L("Not available on this iPhone.")
        }
    }
}
