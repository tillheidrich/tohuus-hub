import Foundation

/// Per-event notification switches for this member and quiet hours.
///
/// Read from `GET /api/notify/prefs` (personal, preferred) – shapes accepted:
/// `{ events: [{ event|key, label?, push|on|enabled, locked? }], quietHours: { enabled, from: "22:00", to: "07:00" } }`
/// or `{ events: { "stock.low": { push: true } | true } }`.
/// Fallback for servers without it: the household matrix in `GET /api/settings` → `notify.events` (push column; only
/// admins can change it there).
struct NotifyPrefs: Decodable, Sendable, Equatable {
    var events: [EventPref]
    var quietHours: QuietHours?
    /// all optional ToHuus mails (e-mail summary, renewal reminders) switched off for this person; nil = server too old
    var mailOff: Bool?
    /// channels.apns.configured – false: the server has no APNs key, so nothing reaches the iPhone
    var apnsConfigured: Bool?
    /// true when read from the household matrix (fallback)
    var household = false
    /// household matrix rows as the server sent them (needed to PATCH /api/settings without losing other channels)
    var raw: [String: JSONValue] = [:]

    struct EventPref: Sendable, Equatable, Identifiable {
        var key: String
        var label: String?
        var on: Bool
        var locked = false
        /// "nur wenn ich zu Hause bin"
        var homeOnly = false
        var id: String { key }

        var title: String { label ?? NotifyPrefs.title(for: key) }
    }

    struct QuietHours: Codable, Sendable, Equatable {
        var enabled: Bool
        var from: String
        var to: String
    }

    init(events: [EventPref], quietHours: QuietHours? = nil, household: Bool = false, raw: [String: JSONValue] = [:]) {
        self.events = events
        self.quietHours = quietHours
        self.household = household
        self.raw = raw
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: AnyKey.self)
        let ev = c.first(JSONValue.self, "events", "prefs") ?? .null
        events = Self.parseEvents(ev)
        mailOff = try? c.decodeIfPresent(Bool.self, forKey: AnyKey("mailOff"))
        apnsConfigured = c.first(JSONValue.self, "channels")?["apns"]?["configured"]?.bool
        // real shape: `quiet: { from, to } | null`; older shape: `quietHours: { enabled, from, to }`
        if let q = c.first(JSONValue.self, "quietHours", "quiet") {
            quietHours = QuietHours(enabled: q["enabled"]?.bool ?? true, from: q.first("from", "start")?.string ?? "22:00",
                                    to: q.first("to", "end")?.string ?? "07:00")
        } else if c.contains(AnyKey("quiet")) {
            quietHours = QuietHours(enabled: false, from: "22:00", to: "07:00")
        }
    }

    static func parseEvents(_ v: JSONValue) -> [EventPref] {
        if let arr = v.array {
            return arr.compactMap { e in
                guard let key = e.first("event", "key", "id")?.string else { return nil }
                // `apns` is the iPhone channel (`push` = the browser)
                return EventPref(key: key, label: e.first("label", "title")?.string,
                                 on: e.first("apns", "on", "enabled", "push")?.bool ?? false, locked: e["locked"]?.bool ?? false,
                                 homeOnly: e["homeOnly"]?.bool ?? false)
            }
        }
        if let obj = v.object {
            return obj.keys.sorted().compactMap { k in
                guard k != "test", let val = obj[k] else { return nil }
                let on = val.bool ?? val.first("push", "on", "enabled")?.bool ?? false
                return EventPref(key: k, label: val["label"]?.string, on: on)
            }
        }
        return []
    }

    /// Household matrix from GET /api/settings.
    static func fromSettings(_ settings: JSONValue) -> NotifyPrefs? {
        guard let events = settings["notify"]?["events"]?.object else { return nil }
        let list = events.keys.sorted().filter { $0 != "test" }.map { k in
            EventPref(key: k, label: nil, on: events[k]?["push"]?.bool ?? false)
        }
        return NotifyPrefs(events: list, household: true, raw: events)
    }

    /// German/English titles for the server's event keys (the server may send its own `label`).
    static func title(for key: String) -> String {
        switch key {
        case "trip.addon", "shopping.addon": return L("Someone asks for something extra while I'm shopping")
        case "trip.started", "shopping.live": return L("Someone is out shopping")
        case "plan.reminder": return L("What's planned for today")
        case "guest.order": return L("A guest wishes for something")
        case "shopping.added": return L("Something was added to the list")
        case "rhythm.due", "shopping.due": return L("Probably due (ToHuus remembers)")
        case "stock.low": return L("Running low")
        case "stock.empty": return L("Used up")
        case "stock.expiring": return L("Use soon")
        case "import.review": return L("A receipt waits for a look")
        case "order.new": return L("New wish from the sofa")
        case "order.status": return L("My wish was answered")
        case "digest.daily": return L("Daily overview")
        case "care.due": return L("Care is due")
        case "party.ending": return L("Party ends soon")
        case "kids.wish": return L("A child made a wish")
        case "auth.new_device": return L("New sign-in")
        case "budget.warning": return L("Budget nearly used")
        case "plan.vote": return L("Food vote")
        case "plan.rotation": return L("Week plan filled")
        case "billing.trial": return L("Trial ends soon")
        default: return key
        }
    }
}
