import SwiftUI

/// Mehr (UX audit 2026-10 Paket A, docs/navigation.md): the groups Alltag · (Zuhause) · Familie & Gäste ·
/// Kopf & Fairness · Einstellungen & Hilfe from shared/functions.json › more – the same rules as moreMenu() in
/// web/src/search/functions.ts (test/functions-registry.test.ts compares both): the person must be allowed to see a
/// row (role, guest level, "Was nutzt ihr?"), a row whose area is in the bar is left out, at most `max` rows a group.
/// The Zuhause doors become a group when the Zuhause tab is not in the bar. The rest is under "Alle Funktionen".
enum MoreMenu {
    struct Group: Identifiable {
        let id: String
        let title: String
        let rows: [FunctionRegister.Fn]
    }

    /// bar area → register function ("orders" is "Bring mir was")
    static func functionId(_ a: AppArea) -> String { a == .orders ? "treats" : a.rawValue }

    /// the guest level / route check (MoreAccess, the port of the web's guestAllows + moduleOfPath)
    @MainActor static func allows(_ f: FunctionRegister.Fn, app: AppModel) -> Bool {
        guard let web = f.web else { return true }
        return MoreAccess.guestAllows(app.isGuest ? (app.guestLevel ?? "paused") : nil, web) && MoreAccess.moduleAllows(app.modules, web)
    }

    /// `bar`: the areas this layout already shows (iPhone tab bar, iPad sidebar)
    @MainActor static func groups(app: AppModel, bar: [AppArea]) -> [Group] {
        let reg = FunctionRegister.shared
        guard let spec = reg.more else { return [] }
        let inBar = Set(bar.map(functionId))
        let seen = Dictionary(FunctionRegister.visible(app: app).map { ($0.id, $0) }, uniquingKeysWith: { a, _ in a })
        var out: [Group] = []
        for g in spec.groups {
            if let w = g.whenNotInBar, inBar.contains(w) { continue }
            let rows = g.rows.compactMap { seen[$0] }
                .filter { !inBar.contains($0.id) && !(app.singleHousehold && $0.id == "treats") && allows($0, app: app) }
            if !rows.isEmpty { out.append(Group(id: g.id, title: groupTitle(g.id), rows: Array(rows.prefix(spec.max)))) }
        }
        return out
    }

    static func groupTitle(_ id: String) -> String {
        guard let g = FunctionRegister.shared.groups?.first(where: { $0.id == id }) else { return id }
        return FunctionRegister.german ? g.de : g.en
    }

    /// the doors of the Zuhause tab (group "zuhause"), in register order
    @MainActor static func zuhauseDoors(app: AppModel) -> [FunctionRegister.Fn] {
        FunctionRegister.visible(app: app).filter { $0.group == "zuhause" && allows($0, app: app) }
    }

    static func title(_ f: FunctionRegister.Fn) -> String {
        FunctionRegister.german ? f.title.de : f.title.en
    }

    /// the row title in Mehr (Wünsche: „Wunschlisten & Geschenke“)
    static func moreTitle(_ f: FunctionRegister.Fn) -> String {
        guard let m = f.more else { return title(f) }
        return FunctionRegister.german ? m.de : m.en
    }
}

/// The sections of Mehr built from the register (SettingsView puts the profile row and search on top).
struct MoreMenuSections: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    let store: ServerStore

    var body: some View {
        let bar = sizeClass == .regular ? app.sidebarAreas : app.barAreas
        ForEach(MoreMenu.groups(app: app, bar: bar)) { g in
            Section(g.title) {
                ForEach(g.rows) { f in FunctionLink(fn: f, store: store, title: MoreMenu.moreTitle(f)) }
                if g.id == "hilfe" {
                    NavigationLink { AllFunctionsView(store: store) } label: { Label(L("All functions"), systemImage: "square.grid.2x2") }
                }
            }
        }
    }
}

/// One function of the register as a row: a tab, the settings, a sheet (Wo ist was?, Küchenmodus) or a screen –
/// the same targets as the search (GlobalSearchView.functionRow).
struct FunctionLink: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let fn: FunctionRegister.Fn
    let store: ServerStore
    var title: String?
    @State private var showFind = false
    @State private var product: Int?

    /// a button row looks like a link row: tinted symbol, ink text, the chevron at the end
    private var buttonLabel: some View {
        HStack {
            Label {
                Text(title ?? MoreMenu.title(fn)).foregroundStyle(Theme.ink)
            } icon: {
                Image(systemName: fn.icon.ios).foregroundStyle(Theme.accent)
            }
            Spacer(minLength: 0)
            Image(systemName: "chevron.right").font(.footnote.weight(.semibold)).foregroundStyle(Color(uiColor: .tertiaryLabel)).accessibilityHidden(true)
        }
        .contentShape(Rectangle())
    }

    var body: some View {
        let label = Label(title ?? MoreMenu.title(fn), systemImage: fn.icon.ios)
        let target = fn.ios ?? ""
        if target.hasPrefix("tab:") {
            Button {
                app.requestedTab = String(target.dropFirst(4))
                app.showMore = false
                dismiss()
            } label: { buttonLabel }
        } else if target == "settings" {
            NavigationLink(value: SettingsRoute.home) { label }
        } else if target == "kitchen" {
            Button { app.showMore = false; dismiss(); app.showKitchen = true } label: { buttonLabel }
        } else if target == "find" {
            Button { showFind = true } label: { buttonLabel }
                .sheet(isPresented: $showFind) {
                    FindView(store: store) { id in
                        showFind = false
                        // the next sheet only after this one has gone
                        Task { try? await Task.sleep(nanoseconds: 500_000_000); product = id }
                    }
                }
                .sheet(item: Binding(get: { product.map(ProductPick.init) }, set: { product = $0?.id })) { p in
                    NavigationStack {
                        ProductDetailView(productId: p.id, store: store)
                            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { product = nil } } }
                    }
                }
        } else if let t = SearchRegistry.Target(rawValue: target) {
            NavigationLink { SearchRegistry.destination(t, store: store) } label: { label }
        }
    }
}

private struct ProductPick: Identifiable { let id: Int }

/// "Alle Funktionen": every function of the register this person may use, in the groups of Mehr (web: /mehr/alle).
struct AllFunctionsView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore

    var body: some View {
        let list = FunctionRegister.visible(app: app).filter { MoreMenu.allows($0, app: app) }
        Form {
            ForEach(FunctionRegister.shared.groups ?? [], id: \.id) { g in
                let rows = list.filter { $0.group == g.id }
                if !rows.isEmpty {
                    Section(MoreMenu.groupTitle(g.id)) {
                        ForEach(rows) { f in FunctionLink(fn: f, store: store) }
                    }
                }
            }
        }
        .themedList()
        .navigationTitle(L("All functions"))
        .navigationBarTitleDisplayMode(.inline)
    }
}
