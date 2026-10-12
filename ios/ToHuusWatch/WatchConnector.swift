import Foundation
import WatchConnectivity

/// WatchConnectivity on the watch side (see Shared/WatchLink.swift for the messages).
final class WatchConnector: NSObject, WCSessionDelegate, @unchecked Sendable {
    static let shared = WatchConnector()
    private let lock = NSLock()
    private var waiting: [[String: Any]] = []

    func activate() {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        s.delegate = self
        if s.activationState != .activated { s.activate() }
    }

    /// Reliable delivery (queued by the system until the iPhone is reachable).
    func send(_ payload: [String: Any]) {
        guard WCSession.isSupported() else { return }
        let s = WCSession.default
        guard s.activationState == .activated else {
            lock.lock(); waiting.append(payload); lock.unlock()
            activate()
            return
        }
        s.transferUserInfo(payload)
    }

    /// Asks the iPhone for a session when the watch has none yet.
    func requestSession() {
        guard WCSession.isSupported(), WCSession.default.activationState == .activated, WCSession.default.isReachable else { return }
        WCSession.default.sendMessage([WatchLink.kind: WatchLink.Kind.hello.rawValue], replyHandler: { reply in
            if let session = WatchLink.Session(reply) {
                Task { @MainActor in WatchStore.shared.adopt(session) }
            }
        }, errorHandler: nil)
    }

    private func handle(_ d: [String: Any]) {
        switch d[WatchLink.kind] as? String {
        case WatchLink.Kind.ctx.rawValue:
            if let ctx = WatchLink.Context(d) { Task { @MainActor in WatchStore.shared.apply(ctx) } }
        case WatchLink.Kind.session.rawValue:
            if let session = WatchLink.Session(d) { Task { @MainActor in WatchStore.shared.adopt(session) } }
        case WatchLink.Kind.signout.rawValue:
            Task { @MainActor in WatchStore.shared.signOut() }
        default:
            break
        }
    }

    // MARK: WCSessionDelegate

    func session(_ session: WCSession, activationDidCompleteWith activationState: WCSessionActivationState, error: Error?) {
        guard activationState == .activated else { return }
        lock.lock(); let pending = waiting; waiting.removeAll(); lock.unlock()
        for p in pending { session.transferUserInfo(p) }
        if !session.receivedApplicationContext.isEmpty { handle(session.receivedApplicationContext) }
        if SessionInfo.load() == nil { requestSession() }
    }

    func session(_ session: WCSession, didReceiveApplicationContext applicationContext: [String: Any]) { handle(applicationContext) }
    func session(_ session: WCSession, didReceiveUserInfo userInfo: [String: Any] = [:]) { handle(userInfo) }
    func session(_ session: WCSession, didReceiveMessage message: [String: Any]) { handle(message) }

    func sessionReachabilityDidChange(_ session: WCSession) {
        if session.isReachable && SessionInfo.load() == nil { requestSession() }
    }
}
