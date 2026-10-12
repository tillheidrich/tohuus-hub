import SwiftUI
import UIKit

@main
struct ToHuusApp: App {
    @State private var app = AppModel()
    @State private var storeKit = StoreManager()
    @Environment(\.scenePhase) private var scenePhase

    init() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        tab.backgroundColor = .white
        tab.shadowColor = UIColor(hex: 0xDEDCD3)
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                .environment(app)
                .environment(storeKit)
                .tint(Theme.primary)
                .task {
                    storeKit.report = { [app] jws in
                        guard app.purchasesAvailable, let api = app.api else { return nil }
                        guard let status = try? await api.postAppleTransaction(jws) else { return nil }
                        app.setBilling(status)
                        return status
                    }
                    storeKit.start()
                    await app.restore()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await app.becameActive() } }
                }
                .onOpenURL { url in handle(url) }
        }
    }

    /// tohuus://connect?url=https://… (QR on a self-hosted server) and tohuus://assistant
    private func handle(_ url: URL) {
        guard url.scheme == "tohuus" else { return }
        if url.host() == "assistant", app.phase == .signedIn { app.showAssistant = true }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app

    var body: some View {
        Group {
            switch app.phase {
            case .launching:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).canvasBackground()
            case .start:
                StartView()
            case .signedIn:
                if let store = app.store {
                    MainTabView(store: store)
                } else {
                    ProgressView()
                }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: app.phase)
    }
}
