import SwiftUI
import UIKit

@main
struct ToHuusApp: App {
    @UIApplicationDelegateAdaptor(AppDelegate.self) private var appDelegate
    @State private var app = AppModel()
    @State private var storeKit = StoreManager()
    @Environment(\.scenePhase) private var scenePhase
    /// light / dark / like the device (Design/Appearance.swift)
    @AppStorage(AppAppearance.storageKey) private var appearance = AppAppearance.system.rawValue

    init() {
        let tab = UITabBarAppearance()
        tab.configureWithOpaqueBackground()
        // white tab bar in light mode, the dark surface in dark mode (a white bar on a dark app glared)
        tab.backgroundColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x17201C) : .white }
        tab.shadowColor = UIColor { $0.userInterfaceStyle == .dark ? UIColor(hex: 0x26312C) : UIColor(hex: 0xDEDCD3) }
        UITabBar.appearance().standardAppearance = tab
        UITabBar.appearance().scrollEdgeAppearance = tab
    }

    var body: some Scene {
        WindowGroup {
            RootView()
                // a device in kid mode stays locked to the kid screen, even after a relaunch (KidModeView.swift)
                .kidModeGate()
                .environment(app)
                .environment(storeKit)
                .tint(Theme.accent)
                .preferredColorScheme(AppAppearance(rawValue: appearance)?.scheme)
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
        .commands {
            // hardware keyboard on iPad (and iPhone): ⌘N adds to the list, ⌘F searches
            CommandGroup(after: .newItem) {
                Button(L("Add to the list")) { app.requestAdd() }
                    .keyboardShortcut("n", modifiers: .command)
                    .disabled(app.phase != .signedIn)
                Button(L("Search")) { app.requestSearch() }
                    .keyboardShortcut("f", modifiers: .command)
                    .disabled(app.phase != .signedIn)
                Button(L("Assistant")) { app.showAssistant = true }
                    .keyboardShortcut("k", modifiers: .command)
                    .disabled(app.phase != .signedIn)
            }
        }
    }

    /// tohuus://assistant, tohuus://shopping (widget) and the other tabs
    private func handle(_ url: URL) {
        // a ToHuus QR label scanned with the camera app (universal link of the cloud host): https://…/q/<code>
        if url.scheme == "https", url.path.hasPrefix("/q/") {
            if app.phase == .signedIn { app.pendingLabel = url.absoluteString }
            return
        }
        guard url.scheme == "tohuus" else { return }
        // tohuus://connect?server=…&code=… (QR code from the web app) – also before anyone is signed in
        if ConnectInbox.shared.receive(url) { return }
        guard app.phase == .signedIn else { return }
        switch url.host() {
        case "assistant": app.showAssistant = true
        case "shopping", "today", "pantry", "cooking", "money", "more": app.requestedTab = url.host()
        case "kitchen": app.showKitchen = true
        default: break
        }
    }
}

struct RootView: View {
    @Environment(AppModel.self) private var app

    /// MIN_IOS_BUILD on the server: an older build only says "please update" (an API change it can't follow)
    private var tooOld: Bool {
        guard let min = app.instance?.minIosBuild,
              let build = Int(Bundle.main.object(forInfoDictionaryKey: "CFBundleVersion") as? String ?? "") else { return false }
        return build < min
    }

    var body: some View {
        Group {
            if tooOld {
                UpdateNeededView()
            } else {
            switch app.phase {
            case .launching:
                ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity).canvasBackground()
            case .start:
                StartView()
            case .signedIn:
                if let store = app.store {
                    MainTabView(store: store)
                        // a new household is asked once about sample data (package D)
                        .sheet(isPresented: Binding(get: { app.askSampleData }, set: { app.askSampleData = $0 })) {
                            SampleQuestionView().interactiveDismissDisabled()
                        }
                        // then the first-run setup for an admin of a new household (Start/FirstRunView.swift)
                        .firstRunSetup(store: store)
                } else {
                    ProgressView()
                }
            }
            }
        }
        .animation(.easeInOut(duration: 0.2), value: app.phase)
        // "Mit tohuus.example.de verbinden?" for links from the camera (Start/OwnServerView.swift)
        .connectLinkSheet()
    }
}

/// Shown instead of the app when the server needs a newer build.
struct UpdateNeededView: View {
    var body: some View {
        VStack(spacing: Theme.Space.s4) {
            Image(systemName: "arrow.down.app").font(.largeTitle).foregroundStyle(Theme.primary).accessibilityHidden(true)
            Text(L("Please update ToHuus")).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Text(L("This version no longer fits ToHuus Cloud. Install the latest build in TestFlight or the App Store – your data is safe."))
                .multilineTextAlignment(.center).foregroundStyle(Theme.ink2)
            if let url = URL(string: "itms-beta://") {
                Link(L("Open TestFlight"), destination: url).buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(Theme.Space.s6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .canvasBackground()
    }
}
