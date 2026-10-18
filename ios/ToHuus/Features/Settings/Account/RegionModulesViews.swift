import SwiftUI

/// Region (web: RegionSettings.tsx RegionCard): where the household shops – currency, number format, units, first day
/// of the week, which receipts are read, the typical stores. Separate from the app language.
/// GET/PATCH /api/region, POST /api/region/stores (admins).
struct RegionSettingsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var r: RegionInfo?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var busy = false
    @State private var more = false

    private static let receipts: [String: String] = [
        "de": "German till receipts and REWE documents",
        "uk": "UK till receipts (Clubcard, Nectar, multibuy savings)",
        "us": "US till receipts (sales tax, coupons, bottle deposits, lb weights)",
        "se": "Swedish till receipts (moms, pant, Stammis and member prices)",
    ]

    var body: some View {
        Form {
            if let error {
                Section {
                    Text(L("Region settings could not be loaded.")).foregroundStyle(Theme.empty)
                    Text(error).font(.caption).foregroundStyle(Theme.ink3)
                    Button(L("Try again")) { Task { await load() } }
                }
            }
            if let r {
                Section {
                    Picker(selection: Binding(get: { r.code }, set: { v in Task { await save(["code": v]) } })) {
                        ForEach(r.options?.regions ?? []) { o in Text(L(o.name)).tag(o.code) }
                    } label: {
                        Label(L("Region"), systemImage: "globe.europe.africa")
                    }
                    .disabled(!app.isAdmin || busy)
                } footer: {
                    Text(L("Where you shop – separate from the app language. Sets currency, number format, units and which receipts are read."))
                }
                Section {
                    LabeledContent(L("Prices"), value: Self.sample(1234.5, locale: r.locale, currency: r.currency))
                    LabeledContent(L("Units"), value: r.units == "us" ? L("US customary (oz, lb, cups)") : L("Metric (g, kg, ml)"))
                    LabeledContent(L("Week starts"), value: r.weekStartDay == 0 ? L("Sunday") : L("Monday"))
                    LabeledContent(L("Receipts")) {
                        Text(r.receiptGrammar.flatMap { Self.receipts[$0] }.map(L) ?? L("Photos and PDFs via the vision model"))
                            .multilineTextAlignment(.trailing)
                    }
                }
                if app.isAdmin {
                    Section {
                        DisclosureGroup(isExpanded: $more) {
                            Picker(L("Currency"), selection: Binding(get: { r.currency }, set: { v in Task { await save(["currency": v]) } })) {
                                ForEach(unique([r.currency] + (r.options?.currencies ?? [])), id: \.self) { c in
                                    Text("\(c) · \(Self.sample(3.49, locale: r.locale, currency: c))").tag(c)
                                }
                            }
                            Picker(L("Number and date format"), selection: Binding(get: { r.locale }, set: { v in Task { await save(["locale": v]) } })) {
                                ForEach(unique([r.locale] + (r.options?.locales ?? [])), id: \.self) { l in
                                    Text("\(Self.sample(1234.5, locale: l, currency: r.currency)) · \(Self.date(l))").tag(l)
                                }
                            }
                            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                                Text(L("Units in recipes"))
                                Picker(L("Units in recipes"), selection: Binding(get: { r.units ?? "metric" }, set: { v in Task { await save(["units": v]) } })) {
                                    Text(L("Metric")).tag("metric")
                                    Text(L("US customary")).tag("us")
                                }
                                .pickerStyle(.segmented)
                                .labelsHidden()
                                Text(L("Only changes how amounts are shown. Saved recipes stay as they are.")).font(.caption).foregroundStyle(Theme.ink3)
                            }
                            VStack(alignment: .leading, spacing: Theme.Space.s2) {
                                Text(L("First day of the week"))
                                Picker(L("First day of the week"), selection: Binding(get: { r.weekStartDay ?? 1 }, set: { v in Task { await save(["weekStart": v]) } })) {
                                    Text(L("Monday")).tag(1)
                                    Text(L("Sunday")).tag(0)
                                }
                                .pickerStyle(.segmented)
                                .labelsHidden()
                            }
                        } label: {
                            Text(r.customised == true ? L("Adjusted – show details") : L("Adjust currency, format and units"))
                        }
                        .disabled(busy)
                    }
                    if !r.typicalStores.isEmpty {
                        Section {
                            Button {
                                Task { await addStores() }
                            } label: {
                                Label(L("Add to store mode"), systemImage: "storefront")
                            }
                            .disabled(busy)
                        } footer: {
                            Text(LF("Typical stores here: %@", r.typicalStores.joined(separator: ", ")))
                        }
                    }
                } else {
                    Section { Text(L("Only admins can change this.")).foregroundStyle(Theme.ink3) }
                }
            } else if error == nil {
                Section { HStack { Spacer(); ProgressView(); Spacer() } }
            }
        }
        .themedList()
        .navigationTitle(L("Region"))
        .task { await load() }
        .toast($toast)
    }

    private func unique(_ xs: [String]) -> [String] {
        var seen = Set<String>()
        return xs.filter { seen.insert($0).inserted }
    }

    static func sample(_ amount: Double, locale: String, currency: String) -> String {
        let f = NumberFormatter()
        f.numberStyle = .currency
        f.locale = Locale(identifier: locale.replacingOccurrences(of: "-", with: "_"))
        f.currencyCode = currency
        return f.string(from: NSNumber(value: amount)) ?? "\(amount) \(currency)"
    }

    static func date(_ locale: String) -> String {
        let f = DateFormatter()
        f.locale = Locale(identifier: locale.replacingOccurrences(of: "-", with: "_"))
        f.dateStyle = .short
        return f.string(from: DateComponents(calendar: .current, year: 2026, month: 10, day: 31).date ?? Date())
    }

    private func load() async {
        do {
            r = try await api.region()
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func save(_ body: [String: Any]) async {
        busy = true
        defer { busy = false }
        do {
            let res = try await api.send("PATCH", "api/region", json: body, as: RegionInfo.self)
            let added = res.storesAdded ?? []
            toast = ToastMessage(text: added.isEmpty ? L("Region saved") : LF("Region saved. Added to store mode: %@", added.joined(separator: ", ")))
            await load()
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }

    private func addStores() async {
        busy = true
        defer { busy = false }
        do {
            let res = try await api.send("POST", "api/region/stores", json: [:], as: JSONValue.self)
            let added = res["added"]?.array?.compactMap(\.string) ?? []
            toast = ToastMessage(text: added.isEmpty ? L("All typical stores are already there") : LF("Added to store mode: %@", added.joined(separator: ", ")))
        } catch { toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true) }
    }
}

/// "Was nutzt ihr?" (web: Modules.tsx ModulesCard): whole areas on or off. The shopping list always stays; switched-off
/// areas leave the navigation, "Heute" and notifications, their data stays. GET/PUT /api/modules (PUT admins).
struct ModulesView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var modules: [String: Bool] = [:]
    @State private var error: String?
    @State private var toast: ToastMessage?

    private struct Item: Identifiable {
        let key: String
        let label: String
        let hint: String
        let icon: String
        var id: String { key }
    }

    /// localized here (literal keys), so gen_strings.py finds them
    private var items: [Item] { [
        Item(key: "stock", label: L("Pantry"), hint: L("What is at home and what should be eaten soon."), icon: "shippingbox"),
        Item(key: "cook", label: L("Cook"), hint: L("Recipes, ideas from what you have, a week plan if you like."), icon: "frying.pan"),
        Item(key: "money", label: L("Money"), hint: L("What food and household cost, from your receipts."), icon: "eurosign.circle"),
        Item(key: "treats", label: L("Treats"), hint: L("Wishes from the sofa: tea, a snack, a drink."), icon: "cup.and.saucer"),
        Item(key: "homeinfo", label: L("Home info"), hint: L("Care tasks and things to know about the home."), icon: "wrench.and.screwdriver"),
        Item(key: "knowledge", label: L("What ToHuus remembers"), hint: L("Sizes, measurements, numbers. So nobody has to ask you."), icon: "brain"),
        Item(key: "guests", label: L("Guests & party"), hint: L("Guest links, a party board, orders from guests."), icon: "party.popper"),
        Item(key: "ha", label: "Home Assistant", hint: L("Only if you run Home Assistant."), icon: "house"),
    ] }

    var body: some View {
        List {
            Section {
                row(icon: "basket", label: L("Shopping"), hint: L("The shared list – always on.")) {
                    Text(L("always")).font(.subheadline).foregroundStyle(Theme.ink3)
                }
                ForEach(items) { i in
                    row(icon: i.icon, label: i.label, hint: i.hint) {
                        Toggle(i.label, isOn: Binding(get: { modules[i.key] ?? true }, set: { v in Task { await set(i.key, v) } }))
                            .labelsHidden()
                            .tint(Theme.primary)
                            .disabled(!app.isAdmin)
                    }
                }
            } footer: {
                Text(app.isAdmin ? L("Switched-off areas disappear from the app and stay quiet. Nothing is deleted.")
                                 : L("Switched-off areas disappear from the app and stay quiet. Nothing is deleted.") + " " + L("Only admins can change this."))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("What do you use?"))
        .task { await load() }
        .toast($toast)
    }

    private func row<Trailing: View>(icon: String, label: String, hint: String, @ViewBuilder trailing: () -> Trailing) -> some View {
        HStack(spacing: Theme.Space.s3) {
            Image(systemName: icon).font(.title3).foregroundStyle(Theme.primaryText).frame(width: 30).accessibilityHidden(true)
            VStack(alignment: .leading, spacing: 2) {
                Text(label)
                Text(hint).font(.caption).foregroundStyle(Theme.ink3)
            }
            Spacer(minLength: Theme.Space.s2)
            trailing()
        }
        .frame(minHeight: 44)
    }

    private func load() async {
        do {
            modules = try await api.get("api/modules", as: [String: Bool].self)
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func set(_ key: String, _ on: Bool) async {
        guard app.isAdmin else { return }
        let before = modules
        modules[key] = on
        do {
            modules = try await api.send("PUT", "api/modules", json: [key: on], as: [String: Bool].self)
            // the tabs and "Mehr" follow /api/me modules
            await app.loadAIState()
        } catch {
            modules = before
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}
