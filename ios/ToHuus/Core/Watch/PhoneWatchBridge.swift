import Foundation
import WatchConnectivity

/// The iPhone side of the watch link (messages in Shared/WatchLink.swift).
/// - sends the list (with queued changes applied) as application context whenever it changes,
/// - hands the sign-in to the watch: a token of its own when the server allows minting one from the app token
///   (separately revocable under "Signed-in apps"), otherwise the iPhone's token,
/// - queues ticks and sentences the watch could not deliver itself.
final class PhoneWatchBridge: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = PhoneWatchBridge()
    private static let watchTokenAccount = "watch.token"

    private let lock = NSLock()
    private var lastContextHash: Int?

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        if s.activationState != .activated { s.activate() }
    }

    private var watchReady: Bool {
        guard WCSession.isSupported() else { return false }
        let s = WCSession.default
        return s.activationState == .activated && s.isPaired && s.isWatchAppInstalled
    }

    // MARK: list → watch

    @MainActor
    func publish(list: ShopList, nextDue: String?, household: String?, ackOps: [String] = []) {
        guard watchReady else { return }
        let data = try? JSONCoding.encoder().encode(list)
        var hasher = Hasher()
        hasher.combine(data)
        hasher.combine(nextDue)
        hasher.combine(ackOps)
        let hash = hasher.finalize()
        lock.lock()
        let same = hash == lastContextHash
        lastContextHash = hash
        lock.unlock()
        if same { return }
        let ctx = WatchLink.Context(list: data, open: list.openCount, nextDue: nextDue, household: household, ackOps: ackOps, signedIn: true)
        try? WCSession.default.updateApplicationContext(ctx.dictionary)
    }

    // MARK: session → watch

    /// The session for the watch, or nil when signed out.
    private func currentSession() -> WatchLink.Session? {
        guard let s = SessionInfo.load(), let token = Keychain.read(account: Self.watchTokenAccount) ?? SessionInfo.token else { return nil }
        return WatchLink.Session(server: s.serverURL, mode: s.mode, household: s.householdId, token: token)
    }

    /// Mints a watch token once (if the server allows it) and sends the session to the watch.
    @MainActor
    func handOverSession(api: APIClient?) async {
        guard watchReady else { return }
        // a client without the sign-out hook: a refused mint (401 in the cloud) must not sign the iPhone out
        if Keychain.read(account: Self.watchTokenAccount) == nil, let api, let s = SessionInfo.load(),
           let res = try? await APIClient(baseURL: api.baseURL, token: api.token, householdId: api.householdId).mintDeviceToken(device: "ToHuus watchOS · Apple Watch", household: s.householdId) {
            Keychain.save(res.token, account: Self.watchTokenAccount)
        }
        guard let session = currentSession() else { return }
        if WCSession.default.isReachable {
            WCSession.default.sendMessage(session.dictionary, replyHandler: nil) { _ in
                WCSession.default.transferUserInfo(session.dictionary)
            }
        } else {
            WCSession.default.transferUserInfo(session.dictionary)
        }
    }

    func signOut() {
        Keychain.delete(account: Self.watchTokenAccount)
        lock.lock(); lastContextHash = nil; lock.unlock()
        guard watchReady else { return }
        try? WCSession.default.updateApplicationContext(
            WatchLink.Context(list: nil, open: 0, nextDue: nil, household: nil, ackOps: [], signedIn: false).dictionary)
        WCSession.default.transferUserInfo([WatchLink.kind: WatchLink.Kind.signout.rawValue])
    }

    /// Household switch: the watch token belongs to the old household.
    func forgetWatchToken() { Keychain.delete(account: Self.watchTokenAccount) }

    // MARK: watch → iPhone

    private func handle(_ d: [String: Any]) {
        if let ops = WatchLink.decodeOps(d) {
            Task { @MainActor in await WatchHost.app?.receiveWatchOps(ops) }
        } else if d[WatchLink.kind] as? String == WatchLink.Kind.say.rawValue, let text = d["text"] as? String {
            Task { @MainActor in await WatchHost.app?.store?.add(text: text) }
        } else if let a = WatchLink.decodeAction(d) {
            Task { @MainActor in await WatchHost.app?.runNotificationAction(a.action, data: a.data) }
        }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        Task { @MainActor in WatchHost.app?.watchBecameAvailable() }
    }

    func sessionDidBecomeInactive(_ session: WCSession) {}
    func sessionDidDeactivate(_ session: WCSession) { session.activate() }
    func sessionWatchStateDidChange(_ session: WCSession) {
        Task { @MainActor in WatchHost.app?.watchBecameAvailable() }
    }

    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) { handle(userInfo) }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { handle(message) }

    func session(_ session: WCSession, didReceiveMessage message: [String: Any], replyHandler: @escaping ([String: Any]) -> Void) {
        if message[WatchLink.kind] as? String == WatchLink.Kind.hello.rawValue {
            replyHandler(currentSession()?.dictionary ?? [:])
            return
        }
        handle(message)
        replyHandler([:])
    }
}

/// The app model the bridge talks to (set once at sign-in).
@MainActor
enum WatchHost {
    static weak var app: AppModel?
}
