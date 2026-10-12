import Foundation

/// The message format between the iPhone app and the Apple Watch app (WatchConnectivity). Compiled into both.
///
/// iPhone → Watch
/// - application context `{ t: "ctx", list: Data(JSON ShopList), open, nextDue?, household?, ackOps: [opId], signedIn }` –
///   the latest list (with the iPhone's queued changes applied), so the watch works without its own network.
/// - message / user info `{ t: "session", server, mode, household?, token, device }` – the sign-in for direct server
///   sync from the watch. WatchConnectivity only talks to the paired watch and is encrypted by the system; the watch
///   stores the token in its own keychain right away and nowhere else.
/// - user info `{ t: "signout" }`.
///
/// Watch → iPhone
/// - message `{ t: "hello" }` – a watch without a session asks for one (reply: the session dictionary).
/// - user info `{ t: "ops", ops: Data(JSON [PendingOp]) }` – ticks and additions made on the wrist while the watch had
///   no network; the iPhone queues them (op ids make a second delivery harmless) and acknowledges them in `ackOps`.
/// - user info `{ t: "say", text }` – a spoken sentence, handled by the iPhone's assistant.
/// - user info `{ t: "action", action, data: Data(JSON) }` – a notification button tapped on the watch.
enum WatchLink {
    static let kind = "t"

    enum Kind: String {
        case ctx, session, signout, hello, ops, say, action
    }

    /// Session handover payload.
    struct Session: Sendable, Equatable {
        var server: URL
        var mode: String
        var household: String?
        var token: String

        var dictionary: [String: Any] {
            var d: [String: Any] = [kind: Kind.session.rawValue, "server": server.absoluteString, "mode": mode, "token": token]
            if let household { d["household"] = household }
            return d
        }

        init(server: URL, mode: String, household: String?, token: String) {
            self.server = server
            self.mode = mode
            self.household = household
            self.token = token
        }

        init?(_ d: [String: Any]) {
            guard d[kind] as? String == Kind.session.rawValue, let s = d["server"] as? String, let url = URL(string: s),
                  let token = d["token"] as? String, token.hasPrefix("sw_") else { return nil }
            server = url
            mode = d["mode"] as? String ?? "cloud"
            household = d["household"] as? String
            self.token = token
        }
    }

    /// What the watch shows and the complication reads.
    struct Context: Sendable {
        var list: Data?
        var open: Int
        var nextDue: String?
        var household: String?
        var ackOps: [String]
        var signedIn: Bool

        var dictionary: [String: Any] {
            var d: [String: Any] = [kind: Kind.ctx.rawValue, "open": open, "ackOps": ackOps, "signedIn": signedIn,
                                    // a changing stamp makes WatchConnectivity deliver identical lists again
                                    "at": Date().timeIntervalSince1970]
            if let list { d["list"] = list }
            if let nextDue { d["nextDue"] = nextDue }
            if let household { d["household"] = household }
            return d
        }

        init(list: Data?, open: Int, nextDue: String?, household: String?, ackOps: [String], signedIn: Bool) {
            self.list = list
            self.open = open
            self.nextDue = nextDue
            self.household = household
            self.ackOps = ackOps
            self.signedIn = signedIn
        }

        init?(_ d: [String: Any]) {
            guard d[kind] as? String == Kind.ctx.rawValue else { return nil }
            list = d["list"] as? Data
            open = d["open"] as? Int ?? 0
            nextDue = d["nextDue"] as? String
            household = d["household"] as? String
            ackOps = d["ackOps"] as? [String] ?? []
            signedIn = d["signedIn"] as? Bool ?? true
        }
    }

    static func ops(_ ops: [PendingOp]) -> [String: Any]? {
        guard let data = try? JSONEncoder().encode(ops) else { return nil }
        return [kind: Kind.ops.rawValue, "ops": data]
    }

    static func decodeOps(_ d: [String: Any]) -> [PendingOp]? {
        guard d[kind] as? String == Kind.ops.rawValue, let data = d["ops"] as? Data else { return nil }
        return try? JSONDecoder().decode([PendingOp].self, from: data)
    }

    static func say(_ text: String) -> [String: Any] { [kind: Kind.say.rawValue, "text": text] }

    static func action(_ action: String, data: [String: String]) -> [String: Any] {
        [kind: Kind.action.rawValue, "action": action, "data": (try? JSONEncoder().encode(data)) ?? Data()]
    }

    static func decodeAction(_ d: [String: Any]) -> (action: String, data: [String: String])? {
        guard d[kind] as? String == Kind.action.rawValue, let a = d["action"] as? String else { return nil }
        let data = (d["data"] as? Data).flatMap { try? JSONDecoder().decode([String: String].self, from: $0) } ?? [:]
        return (a, data)
    }
}
