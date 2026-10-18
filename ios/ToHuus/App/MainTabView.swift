import SwiftUI
import UIKit

/// The areas (18 Oct 2026: Heute · Einkauf · Kochen · Aufgaben · Vorrat, then Geld) plus "Mehr" behind the avatar.
/// Aufgaben and Vorrat used to share one tab "Zuhause" behind a switch – now each is a tab of its own (web: nav.tsx).
/// The iPhone tab bar holds five: a sixth would bring the system's own "More" tab next to the avatar's Mehr. So Geld
/// – the area people open least – takes a place only when Kochen or Vorrat is switched off; otherwise it is the first
/// row in Mehr and opens as a sheet. iPad sidebar: all areas.
/// "Deine Leiste" (18 Oct 2026, NavBarSettings.swift, docs/navigation.md): each person may pick up to four areas next
/// to Heute in their own order (Haushaltswissen too); then the tab bar and the top of the iPad sidebar show exactly
/// those, and every other area is a row at the top of Mehr. The raw values are the ids the server stores.
enum AppArea: String, CaseIterable, Hashable, Identifiable {
    case today, shopping, cooking, tasks, stock, money, knowledge, more
    /// the areas, in order of the tab bar (the default – Haushaltswissen only comes in by an own choice)
    static let tabs: [AppArea] = [.today, .shopping, .cooking, .tasks, .stock, .money]
    /// the areas a person can put next to Heute ("Deine Leiste")
    static let pickable: [AppArea] = [.shopping, .cooking, .tasks, .stock, .money, .knowledge]
    /// places in the iPhone tab bar
    static let barLimit = 5
    /// places next to Heute
    static let slots = barLimit - 1
    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: return L("Today")
        case .shopping: return L("Shopping")
        case .tasks: return L("Tasks")
        case .stock: return L("Pantry")
        case .cooking: return L("Cooking")
        case .money: return L("Money")
        case .knowledge: return L("Knowledge")
        case .more: return L("More")
        }
    }

    var icon: String {
        switch self {
        case .today: return "sun.max"
        case .shopping: return "cart"
        case .tasks: return "checklist"
        case .stock: return "cabinet"
        case .cooking: return "fork.knife"
        case .money: return "eurosign.circle"
        case .knowledge: return "brain"
        case .more: return "ellipsis.circle"
        }
    }

    /// the module that switches this area off ("Was nutzen wir?"); nil = always there
    var module: String? {
        switch self {
        case .stock: return "stock"
        case .cooking: return "cook"
        case .money: return "money"
        case .knowledge: return "knowledge"
        default: return nil
        }
    }

    /// deep links, widgets, notifications, Siri: old names keep working ("home" was the shared tab, "pantry" Vorrat)
    static func from(_ s: String?) -> AppArea? {
        guard let s else { return nil }
        switch s {
        case "pantry", "stock": return .stock
        case "tasks", "care", "home": return .tasks
        case "knowledge", "wissen": return .knowledge
        default: return AppArea(rawValue: s)
        }
    }
}

extension AppModel {
    /// an area this person can use: switched on ("Was nutzt ihr?") and open for a guest's level
    func areaVisible(_ a: AppArea) -> Bool {
        let level = isGuest ? (guestLevel ?? "paused") : nil
        switch a {
        case .tasks: return MoreAccess.guestAllows(level, "/aufgaben")
        case .stock: return moduleOn("stock") && MoreAccess.guestAllows(level, "/bestand")
        case .cooking: return moduleOn("cook") && MoreAccess.guestAllows(level, "/kochen")
        case .money: return moduleOn("money") && MoreAccess.guestAllows(level, "/geld")
        case .knowledge: return moduleOn("knowledge") && MoreAccess.guestAllows(level, "/wissen")
        case .today, .shopping, .more: return true
        }
    }

    /// the default iPhone tab bar: at most five, Geld gives way first
    var defaultBarAreas: [AppArea] {
        let all = AppArea.tabs.filter { areaVisible($0) }
        return all.count > AppArea.barLimit ? all.filter { $0 != .money } : all
    }

    /// the person's own areas ("Deine Leiste") or nil for the default; guests always get the default
    var ownBar: [AppArea]? { isGuest ? nil : NavBarPrefs.shared.tabs }

    /// the iPhone tab bar: Heute first, then the person's own areas (switched-off ones are left out) or the default
    var barAreas: [AppArea] {
        guard let own = ownBar else { return defaultBarAreas }
        return Array(([AppArea.today] + own.filter { areaVisible($0) }).prefix(AppArea.barLimit))
    }

    /// the iPad sidebar's areas: every area by default, the person's own bar once they chose one
    var sidebarAreas: [AppArea] { ownBar == nil ? AppArea.tabs.filter { areaVisible($0) } : barAreas }

    /// areas without a place in the bar → rows at the top of Mehr. Default: only Geld (when five others are on).
    /// With an own bar: every area that isn't in it – except Haushaltswissen, which has its row in Mehr › Haushalt.
    var areasInMore: [AppArea] {
        guard ownBar != nil else { return moneyInMore ? [.money] : [] }
        return AppArea.pickable.filter { $0 != .knowledge && areaVisible($0) && !barAreas.contains($0) }
    }

    /// Geld is there but has no place in the default iPhone tab bar → first row in Mehr
    var moneyInMore: Bool { areaVisible(.money) && !defaultBarAreas.contains(.money) }
}

/// set on an area opened as a sheet (Geld from Mehr on the iPhone): RootChrome shows "Fertig" with it
struct CloseAreaKey: EnvironmentKey { static let defaultValue: (() -> Void)? = nil }
extension EnvironmentValues {
    var closeArea: (() -> Void)? {
        get { self[CloseAreaKey.self] }
        set { self[CloseAreaKey.self] = newValue }
    }
}

/// iPhone (compact width): tab bar with five tabs, "Mehr" behind the avatar at the top right of every root screen.
/// iPad and wide windows (regular width): a sidebar with the five areas and "Mehr" (NavigationSplitView).
/// The layout follows the size class, so Split View, Slide Over and Stage Manager switch between both on the fly.
struct MainTabView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    let store: ServerStore
    @State private var area: AppArea = .today
    /// an area without a place in the iPhone tab bar (Geld when all others are on), shown as a sheet
    @State private var overflow: AppArea?
    @State private var showSettings = false
    /// "Deine Leiste" from a long press on the tab bar
    @State private var showBarEditor = false
    @State private var showTour = false
    @State private var showAIConsent = false
    /// "Was ist neu" (beta): entries this person hasn't seen yet
    @State private var whatsNew: WhatsNew?
    /// "Später" – not again until the next app start
    @State private var whatsNewLater = false
    @Environment(\.scenePhase) private var scenePhase

    /// kept for the tab version (Heute opens tabs through it)
    typealias Tab = AppArea

    var body: some View {
        @Bindable var app = app
        Group {
            if sizeClass == .regular {
                sidebarLayout
            } else {
                tabLayout
            }
        }
        .onChange(of: area, initial: true) { _, a in
            // the assistant gets the tab's screen, like the web's floating button (assistant-areas.ts CONTEXTS)
            switch a {
            case .shopping: app.assistantContext = "shopping"
            case .tasks: app.assistantContext = "tasks"
            case .stock: app.assistantContext = "stock"
            case .cooking: app.assistantContext = "cook"
            case .money: app.assistantContext = "money"
            // Heute: "Was steht heute an?" (web: "/" → tasks)
            case .today: app.assistantContext = "tasks"
            // Mehr: the screens set their own (Wünsche "wishes", Urlaub/unterwegs "tasks"; Einstellungen none)
            default: app.assistantContext = nil
            }
        }
        .onChange(of: overflow) { _, o in
            // Geld as a sheet: the assistant talks about money while it is open, then about the tab again
            if o == .money { app.assistantContext = "money" } else if o == nil { restoreContext() }
        }
        .sheet(item: $overflow) { a in
            detail(a).environment(\.closeArea, { overflow = nil })
        }
        .onAppear {
            // the shared tab "Zuhause" remembered its side – each side is a tab of its own now (18 Oct 2026)
            UserDefaults.standard.removeObject(forKey: "home.segment")
            applyRequestedTab(app.requestedTab)
            if AppTourView.due { showTour = true }
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "debugSettings") { showSettings = true }
            // simulator check: "Deine Leiste" as after a long press on the tab bar
            if UserDefaults.standard.bool(forKey: "debugNavBar") { showBarEditor = true }
            if UserDefaults.standard.bool(forKey: "debugPaywall") { app.showPaywall = true }
            if UserDefaults.standard.bool(forKey: "debugKitchen") { app.showKitchen = true }
            // screenshots without a Simulator window: -debugLandscape YES turns the iPad interface
            if UserDefaults.standard.bool(forKey: "debugLandscape") {
                Task {
                    try? await Task.sleep(nanoseconds: 1_500_000_000)
                    for case let scene as UIWindowScene in UIApplication.shared.connectedScenes {
                        scene.keyWindow?.rootViewController?.setNeedsUpdateOfSupportedInterfaceOrientations()
                        scene.requestGeometryUpdate(.iOS(interfaceOrientations: .landscapeRight)) { _ in }
                    }
                }
            }
            #endif
        }
        .onChange(of: app.requestedTab) { _, t in applyRequestedTab(t) }
        #if DEBUG
        // StoreKit Testing screenshot (ToHuusTests/PaywallStoreKitTests): the hosted test opens the paywall
        .onReceive(NotificationCenter.default.publisher(for: .toHuusDebugShowPaywall)) { _ in app.showPaywall = true }
        #endif
        .onChange(of: app.modules) { _, _ in keepAreaInBar() }
        .onChange(of: NavBarPrefs.shared.tabs) { _, _ in keepAreaInBar() }
        .onChange(of: app.addRequest) { _, _ in area = .shopping }
        .onChange(of: app.searchRequest) { _, _ in
            if area != .cooking && area != .stock {
                area = visible(.stock) ? .stock : .cooking
            }
        }
        .sheet(isPresented: $app.showAssistant) {
            AssistantSheet(store: store)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(store: store)
        }
        .sheet(isPresented: $app.showMore) {
            SettingsView(store: store)
        }
        .sheet(isPresented: $app.showSearch) {
            GlobalSearchView(store: store)
        }
        .sheet(item: Binding(get: { app.pendingLabel.map(ScannedLabel.init) }, set: { app.pendingLabel = $0?.raw })) { l in
            LabelQuickActionView(raw: l.raw, store: store)
        }
        .sheet(isPresented: $app.showPaywall, onDismiss: { app.paywallReason = nil }) {
            PaywallView()
        }
        // end of the trial, read-only card, review dialog (Features/Paywall/PlanMoments.swift)
        .planMoments(store: store)
        .sheet(isPresented: $showTour, onDismiss: {
            // swiped away also counts as seen – the tour comes once per version
            AppTourView.markSeen()
            Task { await askAIConsent(); await checkWhatsNew() }
        }) {
            AppTourView()
        }
        .sheet(isPresented: $showAIConsent, onDismiss: { Task { await checkWhatsNew() } }) {
            AIConsentView()
        }
        .sheet(item: $whatsNew, onDismiss: { whatsNewLater = true }) { w in
            WhatsNewSheet(data: w, api: store.api)
        }
        .task {
            if !showTour {
                await askAIConsent()
                await checkWhatsNew()
            }
        }
        .onChange(of: scenePhase) { _, phase in
            if phase == .active { Task { await checkWhatsNew() } }
        }
        .onChange(of: app.askSampleData) { _, asking in if !asking { Task { await askAIConsent() } } }
        .sheet(item: Binding(get: { store.cookidooDraft }, set: { store.cookidooDraft = $0 })) { d in
            CookidooConfirmView(store: store, request: d) { _ in store.cookidooDraft = nil }
        }
        .fullScreenCover(isPresented: $app.showKitchen) {
            KitchenModeView(store: store)
        }
    }

    /// ToHuus Cloud: ask once whether AI may be used (App Store guideline 5.1.2(i)); never over the tour or for children
    private func askAIConsent() async {
        guard !AIConsentView.wasAsked(app), !app.isChild, !app.isGuest, !app.askSampleData else { return }
        await app.loadAIState()
        if app.aiConsentNeeded && app.aiAvailable && !showTour { showAIConsent = true }
    }

    /// "Was ist neu": after the tour and the AI question, on start and when the app becomes active again – never over
    /// another sheet, never for guests or children, never in UI test and screenshot runs.
    private func checkWhatsNew() async {
        guard !showTour, !showAIConsent, whatsNew == nil, !whatsNewLater, !app.isGuest, !app.isChild, !AppTourView.due,
              UserDefaults.standard.string(forKey: "debugToken") == nil || UserDefaults.standard.bool(forKey: "debugWhatsNew") else { return }
        // guests and children never get it (asked fresh: the app's own state may not be loaded yet)
        if let me = try? await store.api.me(), me.isGuest || me.isChild { return }
        guard let w = try? await store.api.whatsNew(), !w.entries.isEmpty, w.latest != nil else { return }
        // the tour or the AI question may have opened in the meantime
        guard !showTour, !showAIConsent, !app.showPaywall, !app.showAssistant else { return }
        whatsNew = w
    }

    // MARK: iPhone

    private var tabLayout: some View {
        // the bar of this person (AppModel.barAreas): the default or "Deine Leiste", in their order
        TabView(selection: $area) {
            ForEach(app.barAreas) { a in
                Group {
                    if a == .today {
                        TodayView(store: store, openSettings: { showSettings = true }, openTab: { select($0) })
                    } else {
                        detail(a)
                    }
                }
                .tabEntrance()
                // a long press on the bar opens "Deine Leiste" (not for guests – they keep the default)
                .background(TabBarLongPress { if !app.isGuest { showBarEditor = true } })
                .tabItem { Label(a.title, systemImage: a.icon) }
                .badge(a == .shopping ? store.list.openCount : 0)
                .tag(a)
            }
        }
        .sheet(isPresented: $showBarEditor) {
            NavigationStack {
                NavBarSettingsView()
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { showBarEditor = false } } }
            }
        }
        .overlay(alignment: .bottomTrailing) {
            // always there: without a model the assistant still reads the common sentences (basic mode)
            AssistantButton { app.showAssistant = true }
                .padding(.trailing, Theme.Space.s4)
                .padding(.bottom, 64)
        }
    }

    // MARK: iPad

    private var sidebarLayout: some View {
        NavigationSplitView {
            List(selection: Binding<AppArea?>(get: { area }, set: { if let a = $0 { area = a } })) {
                Section {
                    ForEach(app.sidebarAreas) { a in
                        NavigationLink(value: a) {
                            Label(a.title, systemImage: a.icon)
                                .badge(a == .shopping ? store.list.openCount : 0)
                        }
                    }
                }
                Section {
                    // "Deine Leiste": the areas not in it come next, before Mehr
                    if app.ownBar != nil {
                        ForEach(app.areasInMore) { a in
                            NavigationLink(value: a) { Label(a.title, systemImage: a.icon) }
                        }
                    }
                    NavigationLink(value: AppArea.more) { Label(AppArea.more.title, systemImage: AppArea.more.icon) }
                    if visible(.cooking) {
                        Button {
                            app.showKitchen = true
                        } label: {
                            Label(L("Kitchen mode"), systemImage: "frying.pan")
                        }
                        .keyboardShortcut("k", modifiers: [.command, .shift])
                    }
                }
            }
            .navigationTitle(app.activeHousehold?.name ?? "ToHuus")
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 300)
            .safeAreaInset(edge: .bottom) {
                Button {
                    app.showAssistant = true
                } label: {
                    Label(L("Assistant"), systemImage: "sparkles")
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(Theme.Space.s4)
                .hoverEffect(.lift)
            }
        } detail: {
            detail(area)
                .id(area)
                .tabEntrance()
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private func detail(_ a: AppArea) -> some View {
        switch a {
        case .today: TodayView(store: store, openSettings: { area = .more }, openTab: { select($0) })
        case .shopping: ShoppingView(store: store)
        case .tasks: TasksAreaView(store: store)
        case .stock: StockAreaView(store: store)
        case .cooking: CookingView(store: store)
        case .money: MoneyView(store: store)
        case .knowledge:
            // Haushaltswissen as an area of its own ("Deine Leiste") – otherwise a row in Mehr › Haushalt
            if let api = app.api {
                NavigationStack { KnowledgeView(api: api).rootChrome() }
            }
        case .more: SettingsView(store: store, embedded: true)
        }
    }
}

extension MainTabView {
    func visible(_ a: AppArea) -> Bool { app.areaVisible(a) }

    /// open an area: a tab, Mehr (a sheet on the iPhone) or – without a place in the tab bar – a sheet of its own
    func select(_ a: AppArea) {
        guard visible(a) else { area = .today; return }
        if sizeClass == .regular { area = a; return }
        if a == .more { app.showMore = true; return }
        if app.barAreas.contains(a) { area = a; return }
        // after Mehr (or another sheet) has gone – two sheets at once don't show
        Task { try? await Task.sleep(nanoseconds: 450_000_000); overflow = a }
    }

    func applyRequestedTab(_ t: String?) {
        guard let t else { return }
        select(AppArea.from(t) ?? .today)
        app.requestedTab = nil
    }

    /// the assistant's screen after the Geld sheet closed: the tab's again
    func restoreContext() {
        switch area {
        case .shopping: app.assistantContext = "shopping"
        case .tasks, .today: app.assistantContext = "tasks"
        case .stock: app.assistantContext = "stock"
        case .cooking: app.assistantContext = "cook"
        case .money: app.assistantContext = "money"
        case .knowledge, .more: app.assistantContext = nil
        }
    }

    /// the open area left the bar (switched off, or taken out of "Deine Leiste") → back to Heute
    func keepAreaInBar() {
        if !visible(area) || (sizeClass != .regular && !app.barAreas.contains(area)) || (sizeClass == .regular && area != .more && !app.sidebarAreas.contains(area) && !app.areasInMore.contains(area)) {
            area = .today
        }
    }
}

extension Notification.Name {
    /// debug builds: opens the paywall (StoreKit Testing screenshot run)
    static let toHuusDebugShowPaywall = Notification.Name("ToHuusDebugShowPaywall")
}

struct AssistantButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "sparkles")
                .font(.system(size: 22, weight: .semibold))
                .foregroundStyle(Theme.onPrimary)
                .frame(width: 56, height: 56)
                .background(Theme.primary, in: Circle())
                .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
        }
        .hoverEffect(.lift)
        .accessibilityLabel(L("Assistant"))
        .accessibilityHint(L("Ask, say or type what you need"))
    }
}
