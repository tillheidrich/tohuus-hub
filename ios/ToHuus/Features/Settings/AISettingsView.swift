import SwiftUI

/// Mehr › Mit oder ohne KI: what the household has, the personal switch, and the locked state children see.
struct AISettingsView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Form {
            Section {
                LabeledContent(L("In this household"), value: app.aiAvailable ? L("available") : L("off"))
                if app.aiLocked {
                    Label(L("Switched off for you by an adult in the household."), systemImage: "lock.fill")
                        .foregroundStyle(Theme.ink2)
                } else {
                    Toggle(L("Use AI for me"), isOn: Binding(get: { app.personalAI }, set: { on in Task { await app.setPersonalAI(on) } }))
                        .disabled(!app.aiAvailable)
                }
            } footer: {
                Text(app.aiLocked ? L("You can still use everything else – the list, “Sprechen” with simple sentences, recipes.")
                                  : L("Only for you. The others decide for themselves; admins switch it off for the whole household in the web app."))
            }
            Section {
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Label(L("Works without AI"), systemImage: "checkmark.circle").font(.headline)
                    Text(L("The shared list, shop mode, what ToHuus remembers from receipts and ticks, recipes, money, “Sprechen” with simple sentences, receipts read on this iPhone."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                VStack(alignment: .leading, spacing: Theme.Space.s2) {
                    Label(L("AI adds"), systemImage: "sparkles").font(.headline)
                    Text(L("Free sentences to the assistant, photos of receipts and fridges read on the server, cooking help from what's at home."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                HelpLink(slug: "ki-an-oder-aus", title: L("More about AI in ToHuus"))
            }
        }
        .navigationTitle(L("With or without AI"))
        .task { await app.loadAIState() }
    }
}
