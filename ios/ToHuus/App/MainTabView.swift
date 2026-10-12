import SwiftUI

/// Five tabs (Heute · Einkauf · Vorrat · Kochen · Geld) and the floating assistant button.
struct MainTabView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    @State private var tab: Tab = .today
    @State private var showSettings = false

    enum Tab: Hashable { case today, shopping, pantry, cooking, money }

    var body: some View {
        @Bindable var app = app
        TabView(selection: $tab) {
            TodayView(store: store, openSettings: { showSettings = true }, openTab: { tab = $0 })
                .tabItem { Label(L("Today"), systemImage: "sun.max") }
                .tag(Tab.today)
            ShoppingView(store: store)
                .tabItem { Label(L("Shopping"), systemImage: "cart") }
                .badge(store.list.openCount)
                .tag(Tab.shopping)
            PantryView(store: store)
                .tabItem { Label(L("Pantry"), systemImage: "cabinet") }
                .tag(Tab.pantry)
            CookingView(store: store)
                .tabItem { Label(L("Cooking"), systemImage: "fork.knife") }
                .tag(Tab.cooking)
            MoneyView(store: store)
                .tabItem { Label(L("Money"), systemImage: "eurosign.circle") }
                .tag(Tab.money)
        }
        .overlay(alignment: .bottomTrailing) {
            // always there: without a model the assistant still reads the common sentences (basic mode)
            AssistantButton { app.showAssistant = true }
                .padding(.trailing, Theme.Space.s4)
                .padding(.bottom, 64)
        }
        .onAppear {
            applyRequestedTab(app.requestedTab)
            #if DEBUG
            if UserDefaults.standard.bool(forKey: "debugSettings") { showSettings = true }
            if UserDefaults.standard.bool(forKey: "debugPaywall") { app.showPaywall = true }
            #endif
        }
        .onChange(of: app.requestedTab) { _, t in applyRequestedTab(t) }
        .sheet(isPresented: $app.showAssistant) {
            AssistantSheet(store: store)
        }
        .sheet(isPresented: $showSettings) {
            SettingsView()
        }
        .sheet(isPresented: $app.showPaywall) {
            PaywallView()
        }
    }
}

extension MainTabView {
    func applyRequestedTab(_ t: String?) {
        guard let t else { return }
        switch t {
        case "shopping": tab = .shopping
        case "pantry": tab = .pantry
        case "cooking": tab = .cooking
        case "money": tab = .money
        default: tab = .today
        }
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
        .accessibilityLabel(L("Assistant"))
        .accessibilityHint(L("Speak or type what you need"))
    }
}
