import SwiftUI
import UIKit

/// The five areas (Heute · Einkauf · Vorrat · Kochen · Geld) plus "Mehr".
enum AppArea: String, CaseIterable, Hashable, Identifiable {
    case today, shopping, pantry, cooking, money, more
    var id: String { rawValue }

    var title: String {
        switch self {
        case .today: return L("Today")
        case .shopping: return L("Shopping")
        case .pantry: return L("Pantry")
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
        case .cooking: return "fork.knife"
        case .money: return "eurosign.circle"
        case .more: return "ellipsis.circle"
        }
    }

    static func from(_ s: String?) -> AppArea? {
        guard let s else { return nil }
        return AppArea(rawValue: s)
    }
}

/// iPhone (compact width): tab bar with five tabs, "Mehr" behind the avatar on Heute.
/// iPad and wide windows (regular width): a sidebar with the five areas and "Mehr" (NavigationSplitView).
/// The layout follows the size class, so Split View, Slide Over and Stage Manager switch between both on the fly.
struct MainTabView: View {
    @Environment(AppModel.self) private var app
    @Environment(\.horizontalSizeClass) private var sizeClass
    let store: ServerStore
    @State private var area: AppArea = .today
    @State private var showSettings = false

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
        .onAppear {
            applyRequestedTab(app.requestedTab)
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
        .onChange(of: app.addRequest) { _, _ in area = .shopping }
        .onChange(of: app.searchRequest) { _, _ in if area != .cooking && area != .pantry { area = .pantry } }
        .sheet(isPresented: $app.showAssistant) {
            AssistantSheet(store: store)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView(store: store)
        }
        .sheet(isPresented: $app.showPaywall) {
            PaywallView()
        }
        .fullScreenCover(isPresented: $app.showKitchen) {
            KitchenModeView(store: store)
        }
    }

    // MARK: iPhone

    private var tabLayout: some View {
        TabView(selection: $area) {
            TodayView(store: store, openSettings: { showSettings = true }, openTab: { area = $0 })
                .tabItem { Label(AppArea.today.title, systemImage: AppArea.today.icon) }
                .tag(AppArea.today)
            ShoppingView(store: store)
                .tabItem { Label(AppArea.shopping.title, systemImage: AppArea.shopping.icon) }
                .badge(store.list.openCount)
                .tag(AppArea.shopping)
            PantryView(store: store)
                .tabItem { Label(AppArea.pantry.title, systemImage: AppArea.pantry.icon) }
                .tag(AppArea.pantry)
            CookingView(store: store)
                .tabItem { Label(AppArea.cooking.title, systemImage: AppArea.cooking.icon) }
                .tag(AppArea.cooking)
            MoneyView(store: store)
                .tabItem { Label(AppArea.money.title, systemImage: AppArea.money.icon) }
                .tag(AppArea.money)
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
                    ForEach(AppArea.allCases.filter { $0 != .more }) { a in
                        NavigationLink(value: a) {
                            Label(a.title, systemImage: a.icon)
                                .badge(a == .shopping ? store.list.openCount : 0)
                        }
                    }
                }
                Section {
                    NavigationLink(value: AppArea.more) { Label(AppArea.more.title, systemImage: AppArea.more.icon) }
                    Button {
                        app.showKitchen = true
                    } label: {
                        Label(L("Kitchen mode"), systemImage: "frying.pan")
                    }
                    .keyboardShortcut("k", modifiers: [.command, .shift])
                }
            }
            .navigationTitle(app.activeHousehold?.name ?? "ToHuus")
            .navigationSplitViewColumnWidth(min: 220, ideal: 250, max: 300)
            .safeAreaInset(edge: .bottom) {
                Button {
                    app.showAssistant = true
                } label: {
                    Label(L("Speak"), systemImage: "mic.fill")
                }
                .buttonStyle(PrimaryButtonStyle())
                .padding(Theme.Space.s4)
                .hoverEffect(.lift)
            }
        } detail: {
            detail(area)
                .id(area)
        }
        .navigationSplitViewStyle(.balanced)
    }

    @ViewBuilder
    private func detail(_ a: AppArea) -> some View {
        switch a {
        case .today: TodayView(store: store, openSettings: { area = .more }, openTab: { area = $0 })
        case .shopping: ShoppingView(store: store)
        case .pantry: PantryView(store: store)
        case .cooking: CookingView(store: store)
        case .money: MoneyView(store: store)
        case .more: SettingsView(store: store, embedded: true)
        }
    }
}

extension MainTabView {
    func applyRequestedTab(_ t: String?) {
        guard let t else { return }
        area = AppArea.from(t) ?? .today
        app.requestedTab = nil
    }
}

struct AssistantButton: View {
    let action: () -> Void

    var body: some View {
        Button(action: action) {
            Image(systemName: "mic.fill")
                .font(.system(size: 20, weight: .semibold))
                .foregroundStyle(Theme.onPrimary)
                .frame(width: 56, height: 56)
                .background(Theme.primary, in: Circle())
                .shadow(color: .black.opacity(0.25), radius: 12, y: 6)
        }
        .hoverEffect(.lift)
        .accessibilityLabel(L("Speak"))
        .accessibilityHint(L("Speak or type what you need"))
    }
}
