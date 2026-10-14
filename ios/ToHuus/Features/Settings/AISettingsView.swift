import SwiftUI

/// GET /api/ai/settings → { configured, household, mcp, mine, effective, reason, admin, kids?: [{ id, name, ai }] }
struct AISettings: Decodable, Sendable {
    /// which AI models the server has: { text, vision, audio }
    var configured: Configured?
    var household: Bool?
    var mcp: Bool?
    var mine: Bool?
    var effective: Bool?
    var reason: String?
    var admin: Bool?
    var kids: [Kid]?
    /// ToHuus Cloud: AI only after the person agreed (server/lib/ai-policy.ts); nil on self-hosted servers
    var consent: Consent?

    struct Consent: Decodable, Sendable, Hashable {
        var required: Bool
        var given: Bool
        var household: Bool?
        var processor: String?
        var privacyUrl: String?
    }

    struct Configured: Decodable, Sendable, Hashable {
        var text: Bool?
        var vision: Bool?
        var audio: Bool?
    }

    /// false when the server has no AI model at all (older servers without `configured`: assume one)
    var anyModel: Bool {
        guard let c = configured else { return true }
        return c.text == true || c.vision == true || c.audio == true
    }

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
    /// GET /api/assistant/settings – health data for the assistant (Art. 9 GDPR), household-wide, admins change
    @State private var healthShare: Bool?
    /// GET /api/settings › features – what the server itself can read (vision model, e-mail)
    @State private var server: HouseholdSettings?

    var body: some View {
        Form {
            if let c = settings?.consent, c.required, app.aiAvailable {
                Section {
                    Text(AIConsentView.explanation(c.processor))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    if c.given {
                        Button(L("Withdraw consent"), role: .destructive) { Task { await app.setAIConsent(false); await load() } }
                    } else {
                        Button(L("Agree and use AI")) { Task { await app.setAIConsent(true); await load() } }
                    }
                    if let u = c.privacyUrl.flatMap(URL.init(string:)) { Link(L("Privacy"), destination: u) }
                } header: {
                    Text(c.given ? L("You agreed to AI") : L("Use AI? You decide."))
                }
            }
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
                Text(app.aiLocked ? L("You can still use everything else – the list, the assistant with simple sentences, recipes.")
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
            Group {
                if settings?.anyModel == false {
                    Section {
                        Text(L("No AI model is set up on this server. ToHuus works without one: the list, stock, receipts as PDF, barcodes and text recognition on the server."))
                            .font(.subheadline).foregroundStyle(Theme.ink2)
                    }
                }
                if let share = healthShare, !app.isGuest {
                    Section {
                        Toggle(isOn: Binding(get: { share }, set: { v in Task { await setHealthShare(v) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Share allergies and children’s details with the assistant"))
                                Text(L("Then it can take them into account when it suggests dishes. Off: unsuitable dishes are still left out, without saying why."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .tint(Theme.primary)
                        .disabled(settings?.admin != true)
                    } header: {
                        Text(L("Assistant & privacy"))
                    } footer: {
                        Text(L("The assistant knows your list, what you buy and your recipes. Allergies, children’s ages and anything health-related stay at home – unless you switch this on.") + " "
                             + L("This applies to everyone in the household. Off by default.")
                             + (settings?.admin == true ? "" : " " + L("Only an admin can change this.")))
                    }
                }
                if let api = app.api, !app.isGuest {
                    Section {
                        NavigationLink { ConnectAssistantView(api: api) } label: {
                            Label(L("Connect with Claude or ChatGPT"), systemImage: "powerplug")
                        }
                        if settings?.admin == true {
                            NavigationLink { AccessTokensView(api: api) } label: {
                                Label(L("Access keys"), systemImage: "key")
                            }
                        }
                    } header: {
                        Text(L("Your own assistants"))
                    } footer: {
                        Text(L("Claude, ChatGPT and co. may reach ToHuus with an access you create. This is separate from the built-in AI: ToHuus itself calls no model for it."))
                    }
                }
                if let f = server?.features {
                    Section {
                        LabeledContent(L("Image recognition"), value: f.vision == true ? LF("active (%@)", f.visionModel ?? "") : L("not set up"))
                        if let ocr = app.instance?.features?.ocr?.bool {
                            LabeledContent(L("Text recognition on the server"), value: ocr ? L("active") : L("not set up"))
                        }
                        LabeledContent(L("E-mail"), value: f.email == true ? L("active") : L("not set up"))
                        if let store = app.store {
                            NavigationLink { ReceiptRecognitionView(store: store) } label: {
                                Label(L("Receipt recognition"), systemImage: "doc.text.viewfinder")
                            }
                        }
                    } header: {
                        Text(L("On the server"))
                    } footer: {
                        if f.vision != true { Text(L("Without image recognition, photos go through your own AI assistant or are read as text on this iPhone.")) }
                    }
                }
            }
            Section {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Label(L("Works without AI"), systemImage: "checkmark.circle").font(.headline)
                    Text(L("The shared list, shop mode, what ToHuus remembers from receipts and ticks, recipes, money, the assistant with simple sentences, receipts read on this iPhone (with Apple Intelligence if you like)."))
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
        guard !app.isGuest else { return }
        healthShare = (try? await api.get("api/assistant/settings", as: JSONValue.self))?["healthShare"]?.bool
        server = try? await api.householdSettings()
    }

    /// PATCH /api/assistant/settings { healthShare } (admins)
    private func setHealthShare(_ on: Bool) async {
        guard let api, settings?.admin == true else { return }
        do {
            let r = try await api.send("PATCH", "api/assistant/settings", json: ["healthShare": on], as: JSONValue.self)
            healthShare = r["healthShare"]?.bool ?? on
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private var api: APIClient? { app.api }

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

/// One-time question after sign-in in ToHuus Cloud (App Store guideline 5.1.2(i)): may ToHuus send what this person
/// types or photographs to the AI service? "Ohne KI weiter" keeps everything else working; Settings › KI asks again.
struct AIConsentView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @State private var busy = false

    /// Who gets what (App Store guideline 5.1.2(i)): the receiver comes from the server (`consent.processor`).
    static func explanation(_ processor: String?) -> String {
        L("When you use AI (free sentences and voice messages to the assistant, receipt and fridge photos, recipe imports), ToHuus sends what you write, say or photograph to {processor} – together with what the answer needs from your household, such as the list, stock or recipes. Allergies and children’s details only if your household allows it separately. Nothing is used to train models. Without AI everything else keeps working.")
            .replacingOccurrences(of: "{processor}", with: processor ?? L("Mistral AI (France), routed through OpenRouter (USA)"))
    }

    var body: some View {
        NavigationStack {
            ScrollView {
                VStack(alignment: .leading, spacing: Theme.Space.s4) {
                    Image(systemName: "sparkles").font(.largeTitle).foregroundStyle(Theme.primary).accessibilityHidden(true)
                    Text(L("Use AI? You decide.")).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
                    Text(Self.explanation(app.aiProcessor)).foregroundStyle(Theme.ink2)
                    Text(L("You can change this any time under More › With or without AI.")).font(.footnote).foregroundStyle(Theme.ink3)
                    Button {
                        busy = true
                        Task { await app.setAIConsent(true); busy = false; dismiss() }
                    } label: { Text(L("Agree and use AI")).frame(maxWidth: .infinity) }
                        .buttonStyle(PrimaryButtonStyle())
                        .disabled(busy)
                    Button { dismiss() } label: { Text(L("Continue without AI")).frame(maxWidth: .infinity) }
                        .buttonStyle(SecondaryButtonStyle())
                }
                .padding(Theme.Space.s5)
            }
            .background(Theme.canvas)
        }
        .interactiveDismissDisabled(busy)
        .onDisappear { AIConsentView.setAsked(app) }
    }

    /// Asked once per person and household on this device (the consent itself is stored per member on the server);
    /// Settings › KI and the assistant stay the places to change it later.
    private static func askedKey(_ app: AppModel) -> String {
        let s = app.session
        return "aiConsentAsked.\(s?.serverURL.host() ?? "")|\(s?.householdId ?? "")|\(app.userName ?? "")"
    }
    static func wasAsked(_ app: AppModel) -> Bool { UserDefaults.standard.bool(forKey: askedKey(app)) }
    static func setAsked(_ app: AppModel) { UserDefaults.standard.set(true, forKey: askedKey(app)) }
}

/// In the assistant, when this person has not agreed to AI yet (ToHuus Cloud): say so and offer the consent right there.
struct AIConsentPrompt: View {
    @Environment(AppModel.self) private var app
    @State private var showConsent = false

    var body: some View {
        if app.aiConsentNeeded && app.aiAvailable && !app.isChild && !app.isGuest {
            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                Label(L("For free questions, ToHuus needs your OK to use AI."), systemImage: "sparkles")
                    .font(.footnote.weight(.semibold)).foregroundStyle(Theme.ink)
                Button(L("Read and decide")) { showConsent = true }
                    .font(.footnote.weight(.semibold))
            }
            .padding(Theme.Space.s3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .sheet(isPresented: $showConsent) { AIConsentView() }
        }
    }
}
