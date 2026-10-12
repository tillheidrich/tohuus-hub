import SwiftUI
import UserNotifications
import WatchKit

@main
struct ToHuusWatchApp: App {
    @WKApplicationDelegateAdaptor(WatchAppDelegate.self) private var delegate
    @Environment(\.scenePhase) private var scenePhase
    @State private var store = WatchStore.shared

    var body: some Scene {
        WindowGroup {
            NavigationStack { WatchListView() }
                .environment(store)
                .tint(Color("AccentColor"))
                .task {
                    WatchConnector.shared.activate()
                    await store.refresh()
                    await store.flush()
                }
                .onChange(of: scenePhase) { _, phase in
                    if phase == .active { Task { await store.refresh(); await store.flush() } }
                }
        }
    }
}

/// Notification buttons on the wrist ("Mach ich", "Auf die Liste"): straight to the server when the watch has a
/// session, otherwise through the iPhone.
final class WatchAppDelegate: NSObject, WKApplicationDelegate, UNUserNotificationCenterDelegate {
    func applicationDidFinishLaunching() {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(NotifyKit.categories())
        WatchConnector.shared.activate()
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        guard let action = NotifyKit.Action(rawValue: response.actionIdentifier)?.serverAction else { return }
        let data = NotifyKit.data(from: response.notification.request.content.userInfo)
        await WatchAppDelegate.run(action, data: data)
    }

    @MainActor
    static func run(_ action: String, data: [String: String]) async {
        if let api = WatchStore.shared.api {
            do {
                _ = try await api.send("POST", "api/push/action", json: NotifyKit.actionBody(action, data: data), as: Ignored.self)
                await WatchStore.shared.refresh()
                return
            } catch let e as APIError where !e.isOffline {
                return
            } catch {}
        }
        WatchConnector.shared.send(WatchLink.action(action, data: data))
    }
}
