import SwiftUI

/// „Wie kocht ihr?“ (web: pages/CookStyle.tsx, server/lib/cook-style.ts): stove and oven, Thermomix, Monsieur Cuisine
/// or another cooking machine. Recipes for machines the household does not have stay out of suggestions, ideas, the
/// week plan and ToHuus-Rezepte; saved recipes stay in the library. GET/PUT /api/cook2/style (PUT admins).
struct CookStyleInfo: Decodable, Sendable {
    var styles: [String]
    var asked: Bool?
    var machineRecipes: [String: Int]?
}

enum CookStyleOption: String, CaseIterable, Identifiable {
    case normal, thermomix, monsieurCuisine = "monsieur-cuisine", otherMachine = "other-machine"
    var id: String { rawValue }

    /// localized here (literal keys), so gen_strings.py finds them
    var label: String {
        switch self {
        case .normal: return LC("Just normal, on the stove and in the oven")
        case .thermomix: return "Thermomix"
        case .monsieurCuisine: return "Monsieur Cuisine"
        case .otherMachine: return LC("Another cooking machine")
        }
    }

    var hint: String {
        switch self {
        case .normal: return LC("Pots, pans, a baking tray.")
        case .thermomix: return LC("Recipes with Thermomix settings and Cookidoo.")
        case .monsieurCuisine: return LC("The cooking machine from Lidl.")
        case .otherMachine: return LC("For example Bosch Cookit, Kenwood or a Companion.")
        }
    }

    var symbol: String { self == .normal ? "frying.pan" : "gearshape.2" }
}

/// Loads and saves the household's answer.
@MainActor @Observable
final class CookStyleModel {
    var styles: [String] = ["normal"]
    var counts: [String: Int] = [:]
    var asked = false
    var loaded = false
    var error: String?

    func load(_ api: APIClient) async {
        do {
            let i: CookStyleInfo = try await api.get("api/cook2/style")
            styles = i.styles
            counts = i.machineRecipes ?? [:]
            asked = i.asked ?? false
            loaded = true
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    func save(_ api: APIClient, _ next: [String]) async {
        let before = styles
        // nothing chosen means "normal" – never an empty answer
        styles = next.isEmpty ? ["normal"] : next
        do {
            let i: CookStyleInfo = try await api.send("PUT", "api/cook2/style", json: ["styles": styles], as: CookStyleInfo.self)
            styles = i.styles
            asked = true
            error = nil
        } catch {
            styles = before
            self.error = APIError.from(error).localizedDescription
        }
    }

    func toggled(_ o: CookStyleOption, _ on: Bool) -> [String] {
        let rest = styles.filter { $0 != o.rawValue }
        // keep the server's order (normal, thermomix, monsieur-cuisine, other-machine)
        let set = Set(on ? rest + [o.rawValue] : rest)
        return CookStyleOption.allCases.map(\.rawValue).filter { set.contains($0) }
    }
}

/// One toggle row per way of cooking.
struct CookStylePicker: View {
    let model: CookStyleModel
    var disabled = false
    let change: ([String]) -> Void

    var body: some View {
        ForEach(CookStyleOption.allCases) { o in
            Toggle(isOn: Binding(get: { model.styles.contains(o.rawValue) }, set: { on in change(model.toggled(o, on)) })) {
                HStack(spacing: Theme.Space.s3) {
                    Image(systemName: o.symbol).font(.title3).foregroundStyle(Theme.primaryText).frame(width: 30).accessibilityHidden(true)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(o.label).font(.body.weight(.semibold))
                        Text(hint(o)).font(.caption).foregroundStyle(Theme.ink2).fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
            .tint(Theme.primary)
            .disabled(disabled)
            .frame(minHeight: 44)
        }
    }

    private func hint(_ o: CookStyleOption) -> String {
        let n = o == .normal ? 0 : (model.counts[o.rawValue] ?? 0)
        guard n > 0, !model.styles.contains(o.rawValue) else { return o.hint }
        return o.hint + " " + (n == 1 ? LC("1 of your recipes is written for it.") : LCF("%d of your recipes are written for it.", n))
    }
}

/// Settings › Haushalt › „Wie kocht ihr?“
struct CookStyleSettingsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var model = CookStyleModel()

    var body: some View {
        List {
            Section {
                CookStylePicker(model: model, disabled: !app.isAdmin) { next in Task { await model.save(api, next) } }
            } footer: {
                Text(app.isAdmin ? LC("ToHuus only suggests recipes for kitchen machines you have. Saved recipes stay where they are.")
                                 : LC("ToHuus only suggests recipes for kitchen machines you have. Saved recipes stay where they are.") + " " + L("Only admins can change this."))
            }
            if let e = model.error { Section { Text(e).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(LC("How do you cook?"))
        .task { await model.load(api) }
    }
}
