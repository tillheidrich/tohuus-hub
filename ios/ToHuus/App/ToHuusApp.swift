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
        // „Öffnen in ToHuus“ from Files, Mail or Notes: a knowledge file (.md, .txt, .csv, .json) → import with preview
        if url.isFileURL { openFile(url); return }
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
        // tasks (also tohuus://tasks/<id> from a calendar entry) and stock; pantry/home/care for old links (AppArea.from)
        case "shopping", "today", "pantry", "stock", "tasks", "care", "home", "cooking", "money", "more": app.requestedTab = url.host()
        case "kitchen": app.showKitchen = true
        default: break
        }
    }

    /// A knowledge file handed to ToHuus: read the copy, then the import sheet shows what would be taken over.
    private func openFile(_ url: URL) {
        let scoped = url.startAccessingSecurityScopedResource()
        defer {
            if scoped { url.stopAccessingSecurityScopedResource() }
            // the system's copy in Documents/Inbox is ours to clean up
            if url.path.contains("/Inbox/") { try? FileManager.default.removeItem(at: url) }
        }
        // a cold start still restores the session (.launching): the file waits for the signed-in app (RootView)
        guard app.phase != .start else {
            app.openFileNotice = L("Sign in to ToHuus first, then open the file again.")
            return
        }
        guard !(app.phase == .signedIn && app.isGuest) else {
            app.openFileNotice = L("Only people who live here can import into the household knowledge.")
            return
        }
        guard let data = try? Data(contentsOf: url) else {
            app.openFileNotice = L("ToHuus couldn’t read this file.")
            return
        }
        guard data.count <= APIClient.knowledgeImportMaxBytes else {
            app.openFileNotice = LF("The file is too big (at most %lld KB).", APIClient.knowledgeImportMaxBytes / 1024)
            return
        }
        app.openedKnowledgeFile = OpenedKnowledgeFile(source: KnowledgeImportSource(filename: url.lastPathComponent, data: data))
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
        // a file opened with „Öffnen in ToHuus“: not signed in, too big, or what the import took over
        // a file opened during a cold start, but nobody is signed in after all
        .onChange(of: app.phase) { _, phase in
            if phase == .start, app.openedKnowledgeFile != nil {
                app.openedKnowledgeFile = nil
                app.openFileNotice = L("Sign in to ToHuus first, then open the file again.")
            }
        }
        .alert(app.openFileNotice ?? "", isPresented: Binding(get: { app.openFileNotice != nil }, set: { if !$0 { app.openFileNotice = nil } })) {
            Button(L("OK"), role: .cancel) {}
        }
    }
}

/// Shown instead of the app when the server needs a newer build.
struct UpdateNeededView: View {
    var body: some View {
        VStack(spacing: Theme.Space.s4) {
            Image(systemName: "arrow.down.app").font(.largeTitle).foregroundStyle(Theme.primary).accessibilityHidden(true)
            Text(L("Please update ToHuus")).font(.title2.weight(.semibold)).accessibilityAddTraits(.isHeader)
            Text(L("This version no longer fits ToHuus Cloud. Install the latest version from the App Store – your data is safe."))
                .multilineTextAlignment(.center).foregroundStyle(Theme.ink2)
            if let url = URL(string: "itms-apps://apps.apple.com/app/id6822059656") {
                Link(L("Open in the App Store"), destination: url).buttonStyle(PrimaryButtonStyle())
            }
        }
        .padding(Theme.Space.s6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .canvasBackground()
    }
}
