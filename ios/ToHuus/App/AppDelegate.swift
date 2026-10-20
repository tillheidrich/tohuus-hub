import Observation
import UIKit
import UserNotifications

/// UIKit hooks SwiftUI has no API for: the APNs device token, notification buttons and taps, and region-monitoring
/// launches (the store-arrival hint). Set up in `application(_:didFinishLaunchingWithOptions:)` so a background launch
/// for a notification action or a region event finds its delegates in place.
final class AppDelegate: NSObject, UIApplicationDelegate, UNUserNotificationCenterDelegate {
    func application(_ application: UIApplication, didFinishLaunchingWithOptions launchOptions: [UIApplication.LaunchOptionsKey: Any]? = nil) -> Bool {
        let center = UNUserNotificationCenter.current()
        center.delegate = self
        center.setNotificationCategories(NotifyKit.categories())
        PhoneWatchBridge.shared.activate()
        StoreArrival.shared.start()
        Task { await PushManager.shared.refreshAuthorization(registerIfAllowed: true) }
        return true
    }

    func application(_ application: UIApplication, didRegisterForRemoteNotificationsWithDeviceToken deviceToken: Data) {
        let hex = deviceToken.map { String(format: "%02x", $0) }.joined()
        Task { await PushManager.shared.didRegister(hex) }
    }

    func application(_ application: UIApplication, didFailToRegisterForRemoteNotificationsWithError error: Error) {
        PushManager.shared.didFail(error.localizedDescription)
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, willPresent notification: UNNotification) async -> UNNotificationPresentationOptions {
        [.banner, .list, .sound]
    }

    nonisolated func userNotificationCenter(_ center: UNUserNotificationCenter, didReceive response: UNNotificationResponse) async {
        let info = response.notification.request.content.userInfo
        let data = NotifyKit.data(from: info)
        let url = (info["url"] as? String).flatMap(URL.init(string:))
        let actionId = response.actionIdentifier
        await PushManager.shared.handle(actionId: actionId, data: data, url: url)
    }
}

/// APNs registration and what a tapped notification does.
@MainActor
@Observable
final class PushManager {
    static let shared = PushManager()

    enum State: Equatable { case unknown, notAsked, allowed, denied }

    private(set) var state: State = .unknown
    /// false once the server answered 404 on /api/push/apns (no iPhone push there yet)
    private(set) var serverSupportsAPNs = true
    private(set) var lastError: String?
    private(set) var registered = false

    private static let tokenKey = "push.apnsToken"
    private var deviceToken: String? {
        get { SharedConfig.defaults.string(forKey: Self.tokenKey) }
        set { SharedConfig.defaults.set(newValue, forKey: Self.tokenKey) }
    }

    /// Debug builds talk to the APNs sandbox, TestFlight and App Store builds to production.
    static var environment: String {
        #if DEBUG
        "sandbox"
        #else
        "production"
        #endif
    }

    func refreshAuthorization(registerIfAllowed: Bool) async {
        let settings = await UNUserNotificationCenter.current().notificationSettings()
        switch settings.authorizationStatus {
        case .authorized, .provisional, .ephemeral: state = .allowed
        case .denied: state = .denied
        case .notDetermined: state = .notAsked
        @unknown default: state = .unknown
        }
        if state == .allowed && registerIfAllowed { UIApplication.shared.registerForRemoteNotifications() }
    }

    /// Asked from Mehr › Mitteilungen – never at launch.
    func enable() async {
        do {
            let ok = try await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound, .badge])
            state = ok ? .allowed : .denied
            if ok { UIApplication.shared.registerForRemoteNotifications() }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func didRegister(_ token: String) async {
        deviceToken = token
        await sendToken()
    }

    func didFail(_ message: String) {
        lastError = message
    }

    /// Sends the token for the signed-in member (again after every launch and sign-in – tokens can change).
    func sendToken() async {
        guard let token = deviceToken, let api = WatchHost.app?.api else { return }
        do {
            try await api.registerAPNs(token: token, environment: Self.environment, device: AppModel.deviceName)
            registered = true
            serverSupportsAPNs = true
            lastError = nil
        } catch APIError.notFound {
            serverSupportsAPNs = false
        } catch {
            lastError = APIError.from(error).localizedDescription
        }
    }

    /// Sign-out: this device should not get the household's messages any more.
    func forget(api: APIClient?) async {
        guard let token = deviceToken, let api else { return }
        try? await api.unregisterAPNs(token: token)
        registered = false
    }

    func handle(actionId: String, data: [String: String], url: URL?) async {
        if let action = NotifyKit.Action(rawValue: actionId) {
            if let server = action.serverAction {
                if let app = WatchHost.app, app.api != nil {
                    await app.runNotificationAction(server, data: data)
                } else if let s = SessionInfo.load(), let token = SessionInfo.token {
                    // launched in the background just for this button: no scene, no app model yet
                    let api = APIClient(baseURL: s.serverURL, token: token, householdId: s.householdId)
                    _ = try? await api.send("POST", "api/push/action", json: NotifyKit.actionBody(server, data: data), as: Ignored.self)
                }
            } else {
                WatchHost.app?.requestedTab = "shopping"
                if let store = data["store_id"].flatMap(Int.init) { WatchHost.app?.requestedStore = store }
            }
            return
        }
        // a plain tap opens the place the notification is about
        if actionId == UNNotificationDefaultActionIdentifier, let url, url.scheme == "tohuus" {
            // tohuus://more/settings/<page>/<row>: that place in Einstellungen (server/lib/apns.ts settingsDeepLink)
            if url.host() == "more", url.path.hasPrefix("/settings") { WatchHost.app?.requestedSettings = String(url.path.dropFirst("/settings".count)) }
            WatchHost.app?.requestedTab = url.host()
            if let store = data["store_id"].flatMap(Int.init) { WatchHost.app?.requestedStore = store }
        }
    }
}
