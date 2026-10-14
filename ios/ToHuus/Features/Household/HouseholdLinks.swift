import SwiftUI

/// Mehr, grouped exactly like the web's "Mehr" (web/src/nav.tsx `moreGroups`): Rund ums Zuhause, Bons & Rezepte,
/// Bring mir was & Gäste, Haushalt & Einstellungen. Same entries, same order, same filters (guest level and the
/// switched-off areas of "Was nutzt ihr?"). Native screens where the app has them, otherwise the web page signed in
/// (WebPageView) – docs/ios-parity-2026-10-13.md lists which ones are still web pages.
struct MoreSections: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    let api: APIClient
    @State private var open: String?
    @State private var showFind = false
    @State private var showCheck = false
    @State private var findProduct: ProductKey?

    var body: some View {
        Group {
            Section(L("Around the home")) {
                if allows("/wo") {
                    Button { showFind = true } label: { Label(L("Where’s what?"), systemImage: "mappin.and.ellipse") }
                        .foregroundStyle(Theme.ink)
                }
                if allows("/hausinfo") {
                    NavigationLink { HouseGuideView() } label: { Label(L("House info"), systemImage: "info.circle") }
                }
                if allows("/einkauf/wuensche") {
                    NavigationLink { WishesView(api: api) } label: { Label(L("Wishes & Merkliste"), systemImage: "gift") }
                }
                if allows("/abgleich") {
                    Button { showCheck = true } label: { Label(L("Quick stock check"), systemImage: "checklist") }
                        .foregroundStyle(Theme.ink)
                }
                if allows("/pflege") {
                    NavigationLink { CareView(api: api) } label: { Label(L("Home & care"), systemImage: "wrench.and.screwdriver") }
                }
                if allows("/urlaub") {
                    NavigationLink { WebPageView(api: api, path: "/urlaub", title: L("Trip / away")) } label: { Label(L("Trip / away"), systemImage: "suitcase") }
                }
                // permanent guests chosen for a trip's handover (members use the trip page)
                if app.isGuest && allows("/uebergabe") {
                    NavigationLink { WebPageView(api: api, path: "/uebergabe", title: L("Handover")) } label: { Label(L("Handover"), systemImage: "suitcase") }
                }
            }
            if allows("/import") || allows("/lieblinge") || allows("/ausgaben") {
                Section(L("Receipts & recipes")) {
                    if allows("/import") {
                        NavigationLink { ImportsListView(store: store) } label: { Label(L("Receipts & imports"), systemImage: "doc.text") }
                    }
                    if allows("/lieblinge") {
                        NavigationLink { WebPageView(api: api, path: "/lieblinge", title: L("Favourites")) } label: { Label(L("Favourites"), systemImage: "heart") }
                    }
                    if allows("/ausgaben") {
                        NavigationLink { SpendView(store: store) } label: { Label(L("Spending in detail"), systemImage: "chart.bar") }
                    }
                }
            }
            if showTreats || allows("/bar") {
                Section(L("Treats & guests")) {
                    if showTreats {
                        NavigationLink { TreatsView(api: api) } label: { Label(L("Treats"), systemImage: "hand.raised") }
                    }
                    if allows("/bar") {
                        NavigationLink { WebPageView(api: api, path: "/bar", title: L("Guests & party")) } label: { Label(L("Guests & party"), systemImage: "wineglass") }
                        NavigationLink { GuestLinksView(api: api) } label: { Label(L("Guest links"), systemImage: "link") }
                    }
                }
            }
            Section(L("Household & settings")) {
                if allows("/einstellungen?tab=members") {
                    NavigationLink { HouseholdView(api: api) } label: { Label(L("People"), systemImage: "person.2") }
                    if !app.isGuest {
                        NavigationLink { InvitesView(api: api) } label: { Label(L("Invite someone"), systemImage: "person.badge.plus") }
                    }
                }
                if allows("/merkt-sich") {
                    NavigationLink { MemoryView(api: api) } label: { Label(L("What ToHuus remembers"), systemImage: "text.book.closed") }
                }
                if allows("/einstellungen?tab=displays") {
                    NavigationLink { WebPageView(api: api, path: "/einstellungen?tab=displays", title: L("Displays")) } label: { Label(L("Displays"), systemImage: "display") }
                }
                if allows("/einstellungen?tab=ha") {
                    NavigationLink { WebPageView(api: api, path: "/einstellungen?tab=ha", title: "Home Assistant") } label: { Label("Home Assistant", systemImage: "house") }
                }
                if allows("/etiketten") {
                    NavigationLink { WebPageView(api: api, path: "/etiketten", title: L("QR labels")) } label: { Label(L("QR labels"), systemImage: "qrcode") }
                }
                if allows("/einstellungen?tab=data") {
                    NavigationLink { WebPageView(api: api, path: "/einstellungen?tab=data", title: L("Data & backups")) } label: { Label(L("Data & backups"), systemImage: "externaldrive") }
                }
            }
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
                case "memory": MemoryView(api: api)
                case "treats": TreatsView(api: api)
                case "guestlinks", "guestlink-new": GuestLinksView(api: api)
                case "house", "housecard-new", "housecard-edit", "housecode-new", "house-templates", "house-log": HouseGuideView()
                case "care": CareView(api: api)
                default: HouseholdView(api: api)
                }
            }
        }
        .onAppear {
            #if DEBUG
            // simulator checks: -debugMore people | invites | memory | treats | guestlinks | house… | care (with -debugSettings YES)
            if open == nil, let d = UserDefaults.standard.string(forKey: "debugMore"),
               ["people", "invites", "memory", "treats", "guestlinks", "guestlink-new", "house", "housecard-new", "housecard-edit",
                "housecode-new", "house-templates", "house-log", "care"].contains(d) {
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
        let order = ["/bestellen", "/einkauf", "/einstellungen", "/hilfe", "/hausinfo", "/uebergabe", "/so-funktioniert-tohuus", "/gut-zu-wissen"]
        let stock = ["/", "/bestand", "/wo", "/abgleich", "/scan", "/q/"]
        let recipes = ["/kochen", "/rezepte", "/lieblinge"]
        let familyDeny = ["/import", "/ausgaben", "/geld", "/merkt-sich", "/pflege", "/etiketten", "/willkommen", "/urlaub"]
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
