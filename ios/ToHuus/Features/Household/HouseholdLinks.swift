import SwiftUI

/// Mehr (UX audit 2026-10 Paket A, docs/navigation.md): the groups of the one Mehr list, built from
/// shared/functions.json like the web (MoreMenu.swift); SettingsView adds the profile row and the search. Same filters
/// as the web (role, guest level and the switched-off areas of "Was nutzt ihr?"). Every entry is native.
struct MoreSections: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    let api: APIClient
    @State private var open: String?
    @State private var showFind = false
    @State private var showCheck = false
    @State private var findProduct: ProductKey?
    @Environment(\.dismiss) private var dismiss
    @Environment(\.horizontalSizeClass) private var sizeClass

    var body: some View {
        Group {
            // main areas an own bar ("Deine Leiste") left out: first rows here. Geld has its row in Alltag below.
            let areas = app.areasInMore.filter { $0 != .money }
            if sizeClass != .regular && !areas.isEmpty {
                Section(areas.count == 1 ? areas[0].title : L("More areas")) {
                    ForEach(areas) { a in
                        Button {
                            app.requestedTab = a.rawValue
                            app.showMore = false
                            dismiss()
                        } label: { Label(a.title, systemImage: a.icon) }
                        .foregroundStyle(Theme.ink)
                    }
                }
            }
            // Alltag · (Zuhause) · Familie & Gäste · Kopf & Fairness · Einstellungen & Hilfe – from shared/functions.json,
            // the same rows as the web's Mehr (Paket A, MoreMenu.swift)
            MoreMenuSections(store: store)
        }
        .sheet(isPresented: $showFind) { FindView(store: store) { id in
                showFind = false
                // the next sheet only after this one has gone
                Task { try? await Task.sleep(nanoseconds: 500_000_000); findProduct = ProductKey(id: id) }
            } }
        .sheet(isPresented: $showCheck) { QuickCheckView(store: store) }
        .sheet(item: $findProduct) { p in
            NavigationStack {
                ProductDetailView(productId: p.id, store: store)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { findProduct = nil } } }
            }
        }
        .sheet(item: Binding(get: { open.map(DebugKey.init) }, set: { open = $0?.id })) { k in
            NavigationStack {
                switch k.id {
                case "invites": InvitesView(api: api)
                case "memory": KnowledgeView(api: api)
                case "treats": TreatsView(api: api)
                case "guests": GuestLinksView(api: api, guestsArea: true)
                case "guestlinks", "guestlink-new": GuestLinksView(api: api)
                case "house", "housecard-new", "housecard-edit", "housecode-new", "house-templates", "house-log": HouseGuideView()
                case "care": CareView(api: api)
                case "away": AwayView(store: store)
                default: HouseholdView(api: api)
                }
            }
        }
        .onAppear {
            #if DEBUG
            // simulator checks: -debugMore people | invites | memory | treats | guests | guestlinks | house… | care | away (with -debugSettings YES)
            if open == nil, let d = UserDefaults.standard.string(forKey: "debugMore"),
               ["people", "invites", "memory", "treats", "guests", "guestlinks", "guestlink-new", "house", "housecard-new", "housecard-edit",
                "housecode-new", "house-templates", "house-log", "care", "away"].contains(d) {
                open = d
            }
            #endif
        }
    }

    /// "Bring mir was" needs someone at home to ask: hidden for a household of one and when switched off
    private var showTreats: Bool { !app.singleHousehold && allows("/bestellen") }

    private func allows(_ path: String) -> Bool {
        MoreAccess.guestAllows(app.isGuest ? (app.guestLevel ?? "paused") : nil, path) && MoreAccess.moduleAllows(app.modules, path)
    }
}

/// Port of web/src/people/access.ts `guestAllows` and web/src/nav.tsx `moduleOfPath` – keep the three in step
/// (server/lib/people-policy.ts is the source of truth).
enum MoreAccess {
    static func guestAllows(_ level: String?, _ path: String) -> Bool {
        guard let level else { return true }
        if level == "paused" { return false }
        let p = path.split(separator: "?").first.map(String.init) ?? path
        if p == "/einkauf/wuensche" || p.hasPrefix("/einkauf/wuensche/") { return false }
        let order = ["/bestellen", "/einkauf", "/einstellungen", "/hilfe", "/hausinfo", "/uebergabe", "/so-funktioniert-tohuus", "/gut-zu-wissen", "/wissen"]
        let stock = ["/", "/bestand", "/wo", "/abgleich", "/scan", "/q/"]
        let recipes = ["/kochen", "/rezepte", "/lieblinge"]
        let familyDeny = ["/import", "/ausgaben", "/geld", "/merkt-sich", "/pflege", "/aufgaben", "/etiketten", "/willkommen", "/urlaub"]
        func starts(_ list: [String]) -> Bool {
            list.contains { x in
                x == "/" ? p == "/" : x.hasSuffix("/") ? p.hasPrefix(x) : (p == x || p.hasPrefix(x + "/"))
            }
        }
        if level == "family" { return !starts(familyDeny) }
        if starts(order) { return true }
        if (level == "stock" || level == "recipes") && starts(stock) { return true }
        if level == "recipes" && starts(recipes) { return true }
        return false
    }

    /// "Was nutzt ihr?": which switchable area a path belongs to (nil = always there)
    static func moduleOf(_ path: String) -> String? {
        let p = path.split(separator: "?").first.map(String.init) ?? path
        if p.hasPrefix("/bestand") || p.hasPrefix("/abgleich") || p == "/wo" || p.hasPrefix("/scan") { return "stock" }
        if p.hasPrefix("/kochen") || p.hasPrefix("/rezepte") { return "cook" }
        if p.hasPrefix("/geld") || p.hasPrefix("/ausgaben") { return "money" }
        if p.hasPrefix("/bestellen") { return "treats" }
        if p.hasPrefix("/bar") { return "guests" }
        if p.hasPrefix("/pflege") { return "homeinfo" }
        if p.hasPrefix("/wissen") || p.hasPrefix("/merkt-sich") { return "knowledge" }
        if path.contains("tab=ha") { return "ha" }
        return nil
    }

    static func moduleAllows(_ modules: [String: Bool], _ path: String) -> Bool {
        guard let m = moduleOf(path) else { return true }
        return modules[m] ?? true
    }
}

private struct DebugKey: Identifiable { let id: String }
private struct ProductKey: Identifiable { let id: Int }
