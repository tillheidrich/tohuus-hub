import SwiftUI

/// Mehr (UX benchmark 2.3, docs/design/ux-benchmark-2026-10-14.md): the household and the devices groups of the one
/// Mehr list; SettingsView adds the profile row, search, settings and help. What used to be "Rund ums Zuhause",
/// "Bons & Rezepte" lives in its tab now (Zuhause, Geld, Kochen, Einkauf). Same filters as the web (guest level and the
/// switched-off areas of "Was nutzt ihr?"). Every entry is native.
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
            // areas without a place in the iPhone tab bar (AppModel.areasInMore): Geld by default, with "Deine Leiste"
            // every area not in it – first rows here, and the shortcut to change the bar
            if sizeClass != .regular && (!app.areasInMore.isEmpty || app.ownBar != nil) {
                Section {
                    ForEach(app.areasInMore) { a in
                        Button {
                            app.requestedTab = a.rawValue
                            app.showMore = false
                            dismiss()
                        } label: { Label(a.title, systemImage: a.icon) }
                        .foregroundStyle(Theme.ink)
                    }
                    if !app.isGuest {
                        NavigationLink { NavBarSettingsView() } label: { Label(L("Adjust the bar"), systemImage: "dock.rectangle") }
                            .foregroundStyle(Theme.ink2)
                    }
                }
            }
            // Haushalt: the people and the guests (UX benchmark 2.3 – one list, every function at most two taps away)
            Section(L("Household")) {
                // Wunschlisten (20 Oct 2026): first row – hard to find behind the door on top of Einkauf before.
                // Permanent guests never see wish lists.
                if !app.isGuest {
                    NavigationLink { WishesView(api: api) } label: { Label(L("Wish lists & gifts"), systemImage: "gift") }
                }
                // Haushaltswissen (18 Oct 2026): first row, its own symbol; guests see what is shared with them
                if allows("/wissen") {
                    NavigationLink { KnowledgeView(api: api) } label: { Label(L("What ToHuus remembers"), systemImage: "brain") }
                }
                if allows("/einstellungen/haushalt/leute") {
                    NavigationLink { HouseholdView(api: api) } label: { Label(L("People"), systemImage: "person.2") }
                    // GET/POST /api/invites are for admins (server/routes/invites.ts) – a member would only see "forbidden"
                    if !app.isGuest && app.isAdmin {
                        NavigationLink { InvitesView(api: api) } label: { Label(L("Invite someone"), systemImage: "person.badge.plus") }
                    }
                }
                if allows("/bar") {
                    NavigationLink { GuestLinksView(api: api, guestsArea: true) } label: { Label(L("Guests"), systemImage: "wineglass") }
                }
                if showTreats {
                    NavigationLink { TreatsView(api: api) } label: { Label(L("Treats"), systemImage: "hand.raised") }
                }
            }
            // permanent guests: what the Zuhause tab shows members (Hausinfo, Wo ist was?) and their handover
            if app.isGuest {
                Section(L("Around the home")) {
                    if allows("/wo") {
                        Button { showFind = true } label: { Label(L("Where’s what?"), systemImage: "mappin.and.ellipse") }
                            .foregroundStyle(Theme.ink)
                    }
                    if allows("/hausinfo") {
                        NavigationLink { HouseGuideView() } label: { Label(L("House info"), systemImage: "info.circle") }
                    }
                    if allows("/uebergabe") {
                        NavigationLink { HandoverGuestView(api: api) } label: { Label(L("Handover"), systemImage: "suitcase") }
                    }
                }
            }
            // Geräte & Verbindungen moved into Einstellungen › Verbindungen & Geräte, Kalender into Mitteilungen & Kalender,
            // angemeldete Geräte into Ich › Anmeldung & Sicherheit (Paket C, SettingsHome.swift)
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
