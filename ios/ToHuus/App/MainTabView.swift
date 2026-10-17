import SwiftUI
import UIKit

/// The five areas (UX benchmark 2.1: Heute · Einkauf · Kochen · Zuhause · Geld) plus "Mehr".
/// `pantry` stays for old links and widgets – it opens Zuhause on the Vorrat side.
enum AppArea: String, CaseIterable, Hashable, Identifiable {
    case today, shopping, cooking, home, money, pantry, more
    /// the tabs, in order
    static let tabs: [AppArea] = [.today, .shopping, .cooking, .home, .money]
    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: return L("Today")
        case .shopping: return L("Shopping")
        case .pantry: return L("Pantry")
        case .home: return L("Home")
        case .cooking: return L("Cooking")
        case .money: return L("Money")
        case .more: return L("More")
        }
    }

    var icon: String {
        switch self {
        case .today: return "sun.max"
        case .shopping: return "cart"
        case .pantry: return "cabinet"
        case .home: return "house"
        case .cooking: return "fork.knife"
        case .money: return "eurosign.circle"
        case .more: return "ellipsis.circle"
        }
    }

    /// the module that switches this area off ("Was nutzen wir?"); nil = always there
    var module: String? {
        switch self {
        case .pantry: return "stock"
        case .cooking: return "cook"
        case .money: return "money"
        default: return nil
        }
    }

    static func from(_ s: String?) -> AppArea? {
        guard let s else { return nil }
        switch s {
        case "pantry", "stock", "tasks", "care": return .home
        default: return AppArea(rawValue: s)
        }
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
    @State private var showSettings = false
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
            case .pantry: app.assistantContext = "stock"
            case .home: break // HomeView sets "tasks" or "stock"
            case .cooking: app.assistantContext = "cook"
            case .money: app.assistantContext = "money"
            // Heute: "Was steht heute an?" (web: "/" → tasks)
            case .today: app.assistantContext = "tasks"
            // Mehr: the screens set their own (Wünsche "wishes", Urlaub/unterwegs "tasks"; Einstellungen none)
            default: app.assistantContext = nil
            }
        }
        .onAppear {
            applyRequestedTab(app.requestedTab)
            if AppTourView.due { showTour = true }
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "debugSettings") { showSettings = true }
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
        .onChange(of: app.modules) { _, _ in if !visible(area) { area = .today } }
        .onChange(of: app.addRequest) { _, _ in area = .shopping }
        .onChange(of: app.searchRequest) { _, _ in
            if area != .cooking && area != .home {
                if visible(.home) && app.moduleOn("stock") { app.homeSegment = "stock"; area = .home } else { area = .cooking }
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
        .sheet(isPresented: $app.showPaywall) {
            PaywallView()
        }
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
        TabView(selection: $area) {
            TodayView(store: store, openSettings: { showSettings = true }, openTab: { area = $0 })
                .tabEntrance()
                .tabItem { Label(AppArea.today.title, systemImage: AppArea.today.icon) }
                .tag(AppArea.today)
            ShoppingView(store: store)
                .tabEntrance()
                .tabItem { Label(AppArea.shopping.title, systemImage: AppArea.shopping.icon) }
                .badge(store.list.openCount)
                .tag(AppArea.shopping)
            if visible(.cooking) {
                CookingView(store: store)
                    .tabEntrance()
                    .tabItem { Label(AppArea.cooking.title, systemImage: AppArea.cooking.icon) }
                    .tag(AppArea.cooking)
            }
            if visible(.home) {
                HomeView(store: store)
                    .tabEntrance()
                    .tabItem { Label(AppArea.home.title, systemImage: AppArea.home.icon) }
                    .tag(AppArea.home)
            }
            if visible(.money) {
                MoneyView(store: store)
                    .tabEntrance()
                    .tabItem { Label(AppArea.money.title, systemImage: AppArea.money.icon) }
                    .tag(AppArea.money)
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
                    ForEach(AppArea.tabs.filter { visible($0) }) { a in
                        NavigationLink(value: a) {
                            Label(a.title, systemImage: a.icon)
                                .badge(a == .shopping ? store.list.openCount : 0)
                        }
                    }
                }
                Section {
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
        case .today: TodayView(store: store, openSettings: { area = .more }, openTab: { area = $0 })
        case .shopping: ShoppingView(store: store)
        case .pantry: HomeView(store: store)
        case .home: HomeView(store: store)
        case .cooking: CookingView(store: store)
        case .money: MoneyView(store: store)
        case .more: SettingsView(store: store, embedded: true)
        }
    }
}

extension MainTabView {
    func visible(_ a: AppArea) -> Bool {
        let level = app.isGuest ? (app.guestLevel ?? "paused") : nil
        switch a {
        // Zuhause: tasks always, stock when switched on – guests only with a level that opens one of them
        case .home: return MoreAccess.guestAllows(level, "/aufgaben") || (app.moduleOn("stock") && MoreAccess.guestAllows(level, "/bestand"))
        case .cooking: return app.moduleOn("cook") && MoreAccess.guestAllows(level, "/kochen")
        case .money: return app.moduleOn("money") && MoreAccess.guestAllows(level, "/geld")
        case .today: return true
        default: return a.module.map { app.moduleOn($0) } ?? true
        }
    }

    func applyRequestedTab(_ t: String?) {
        guard let t else { return }
        if t == "pantry" || t == "stock" { app.homeSegment = "stock" }
        if t == "tasks" || t == "care" { app.homeSegment = "tasks" }
        let a = AppArea.from(t) ?? .today
        area = visible(a) ? a : .today
        app.requestedTab = nil
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
