import Foundation
import UserNotifications

/// Notification categories and buttons, shared by the iPhone and the watch app.
///
/// Expected APNs payload (server side, see docs/ios-push.md):
/// `{ "aps": { "alert": {…}, "category": "TOHUUS_ADDON", "thread-id": "shopping" }, "event": "shopping.addon",
///    "data": { "request_id": "12" }, "url": "tohuus://shopping" }`
/// A button runs `POST /api/push/action { action, data }` as the member who tapped it – the same endpoint Web Push uses.
enum NotifyKit {
    enum Category: String, CaseIterable {
        /// someone asks for something extra while I'm shopping ("Bringst du Milch mit?")
        case addon = "TOHUUS_ADDON"
        /// ToHuus remembers something is probably due
        case due = "TOHUUS_DUE"
        /// the store-arrival hint (local, from region monitoring)
        case arrival = "TOHUUS_ARRIVAL"
    }

    enum Action: String {
        case addonAccept = "ADDON_ACCEPT"
        case addonDecline = "ADDON_DECLINE"
        case dueAdd = "DUE_ADD"
        case openList = "OPEN_LIST"

        /// The action name for POST /api/push/action (nil = handled locally, e.g. opening the list).
        var serverAction: String? {
            switch self {
            case .addonAccept: return "addon-accept"
            case .addonDecline: return "addon-decline"
            case .dueAdd: return "shop-add"
            case .openList: return nil
            }
        }
    }

    static func categories() -> Set<UNNotificationCategory> {
        let accept = UNNotificationAction(identifier: Action.addonAccept.rawValue, title: L("I'll get it"), options: [])
        let decline = UNNotificationAction(identifier: Action.addonDecline.rawValue, title: L("Can't do it"), options: [])
        let add = UNNotificationAction(identifier: Action.dueAdd.rawValue, title: L("Put it on the list"), options: [])
        let open = UNNotificationAction(identifier: Action.openList.rawValue, title: L("Open the list"), options: [.foreground])
        return [
            UNNotificationCategory(identifier: Category.addon.rawValue, actions: [accept, decline], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Category.due.rawValue, actions: [add], intentIdentifiers: [], options: []),
            UNNotificationCategory(identifier: Category.arrival.rawValue, actions: [open], intentIdentifiers: [], options: []),
        ]
    }

    /// `data` of a notification as flat strings (numbers become strings; the server reads both).
    static func data(from userInfo: [AnyHashable: Any]) -> [String: String] {
        guard let raw = userInfo["data"] as? [String: Any] else { return [:] }
        var out: [String: String] = [:]
        for (k, v) in raw {
            if let s = v as? String { out[k] = s } else if let n = v as? NSNumber { out[k] = n.stringValue }
        }
        return out
    }

    /// The body for POST /api/push/action; ids that look like numbers are sent as numbers.
    static func actionBody(_ action: String, data: [String: String]) -> [String: Any] {
        var d: [String: Any] = [:]
        for (k, v) in data { d[k] = Int(v).map { $0 as Any } ?? v }
        return ["action": action, "data": d]
    }
}
