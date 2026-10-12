import Foundation
import Observation
import WidgetKit

/// The shopping list on the wrist. Two ways to stay in sync, used together:
/// 1. directly with the server when the watch has network and a session (token in the watch keychain),
/// 2. through the iPhone (WatchConnectivity): the iPhone sends its list, the watch sends ticks it could not deliver
///    itself. Op ids make a change that arrives both ways harmless.
@MainActor
@Observable
final class WatchStore {
    static let shared = WatchStore()

    private(set) var list: ShopList = .empty
    private(set) var signedIn = false
    /// last direct server call worked
    private(set) var online = false
    private(set) var nextDue: String?
    private(set) var household: String?
    private(set) var lastUpdate: Date?
    private(set) var busy = false
    var reply: String?
    var undoItem: ShopItem?

    var storeId: Int? {
        didSet {
            UserDefaults.standard.set(storeId, forKey: "watch.store")
            Task { await refresh() }
        }
    }

    private var snapshot: ShopList = .empty
    private var ops: [PendingOp] = []
    /// ops already handed to the iPhone, waiting for its acknowledgement
    private var handed: Set<String> = []
    private var nextLocalId = -1
    private let cache = ShoppingCache(householdKey: "watch")
    @ObservationIgnored private var flushing = false

    var pendingCount: Int { ops.count }

    private init() {
        ops = cache.loadOps()
        if let s = cache.loadSnapshot() { snapshot = s }
        storeId = UserDefaults.standard.object(forKey: "watch.store") as? Int
        nextLocalId = min(-1, (ops.compactMap(\.localId).min() ?? 0) - 1)
        signedIn = SessionInfo.load() != nil || UserDefaults.standard.bool(forKey: "watch.phoneSignedIn")
        nextDue = UserDefaults.standard.string(forKey: "watch.nextDue")
        rebuild()
        #if DEBUG
        if UserDefaults.standard.bool(forKey: "debugDemo") { loadDemo() }
        #endif
    }

    /// Direct server access – only with a session handed over from the iPhone.
    var api: APIClient? {
        guard let s = SessionInfo.load(), let token = SessionInfo.token else { return nil }
        return APIClient(baseURL: s.serverURL, token: token, householdId: s.householdId) {
            Task { @MainActor in WatchStore.shared.signOut() }
        }
    }

    // MARK: session

    func adopt(_ session: WatchLink.Session) {
        SessionInfo(serverURL: session.server, mode: session.mode, householdId: session.household, deviceName: "ToHuus watchOS").save()
        SessionInfo.token = session.token
        signedIn = true
        Task { await refresh(); await flush() }
    }

    func signOut() {
        SessionInfo.clear()
        UserDefaults.standard.removeObject(forKey: "watch.phoneSignedIn")
        ShoppingCache.wipeAll()
        WidgetSnapshot.clear()
        ops = []
        handed = []
        snapshot = .empty
        signedIn = false
        online = false
        rebuild()
        WidgetCenter.shared.reloadAllTimelines()
    }

    // MARK: from the iPhone

    func apply(_ ctx: WatchLink.Context) {
        UserDefaults.standard.set(ctx.signedIn, forKey: "watch.phoneSignedIn")
        if !ctx.signedIn && SessionInfo.load() == nil { signOut(); return }
        signedIn = true
        if !ctx.ackOps.isEmpty {
            let acked = Set(ctx.ackOps)
            ops = OpQueueLogic.remove(answered: acked, from: ops)
            handed.subtract(acked)
            cache.saveOps(ops)
        }
        nextDue = ctx.nextDue
        UserDefaults.standard.set(ctx.nextDue, forKey: "watch.nextDue")
        household = ctx.household
        // the watch's own server view (sorted by the chosen shop) wins while it is online
        if !(online && api != nil), let data = ctx.list, let decoded = try? JSONCoding.decoder().decode(ShopList.self, from: data) {
            snapshot = decoded
            cache.saveSnapshot(data)
            lastUpdate = Date()
        }
        rebuild()
    }

    // MARK: server

    func refresh() async {
        guard let api else { return }
        do {
            let data = try await api.shopList(storeId: storeId)
            snapshot = try api.decode(ShopList.self, from: data)
            cache.saveSnapshot(data)
            online = true
            lastUpdate = Date()
            rebuild()
            if let t = try? await api.today() {
                nextDue = t.rhythm.first { ($0.dueInDays ?? 1) <= 0 && $0.onList != true }?.name ?? t.rhythm.first?.name
                UserDefaults.standard.set(nextDue, forKey: "watch.nextDue")
                publishComplication()
            }
        } catch {
            online = false
        }
    }

    // MARK: changes

    func toggle(_ item: ShopItem) {
        let on = !item.isChecked
        if on { undoItem = item }
        enqueue(.check(item.id, on: on, toStock: true))
    }

    func undo() {
        guard var item = undoItem else { return }
        undoItem = nil
        item.checkedAt = "x"
        enqueue(.check(item.id, on: false, toStock: true))
    }

    func add(_ text: String) {
        let parts = QuickAddParser.fragments(text).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        for part in parts {
            ops = OpQueueLogic.enqueue(.add(part, localId: nextLocalId), into: ops)
            nextLocalId -= 1
        }
        cache.saveOps(ops)
        rebuild()
        Task { await flush() }
    }

    /// "Sprechen" on the wrist: the assistant when the watch reaches the server, otherwise the built-in reader puts the
    /// products on the list (the same parser as quick add).
    func say(_ text: String) async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty else { return }
        busy = true
        defer { busy = false }
        if let api {
            do {
                let r = try await api.chat(t, conversationId: nil)
                reply = r.reply
                online = true
                await refresh()
                return
            } catch let e as APIError where !e.isOffline {
                reply = e.localizedDescription
                return
            } catch {
                online = false
            }
        }
        add(t)
        let names = QuickAddParser.parse(t).map(\.name)
        reply = names.isEmpty ? L("Nothing was added.") : LF("On the list: %@", names.joined(separator: ", "))
    }

    private func enqueue(_ op: PendingOp) {
        ops = OpQueueLogic.enqueue(op, into: ops)
        cache.saveOps(ops)
        rebuild()
        Task { await flush() }
    }

    func flush() async {
        guard !flushing, !ops.isEmpty else { return }
        flushing = true
        defer { flushing = false }
        if let api {
            let batch = Array(ops.prefix(200))
            do {
                let res = try await api.sync(batch)
                var answered = Set(res.results.map(\.opId))
                if answered.isEmpty { answered = Set(batch.map(\.opId)) }
                ops = OpQueueLogic.remove(answered: answered, from: ops)
                handed.subtract(answered)
                cache.saveOps(ops)
                online = true
                flushing = false
                await refresh()
                return
            } catch let e as APIError where !e.isOffline {
                if case .server(let status, _) = e, (400..<500).contains(status) {
                    ops = OpQueueLogic.remove(answered: Set(batch.map(\.opId)), from: ops)
                    cache.saveOps(ops)
                    rebuild()
                    return
                }
            } catch {
                online = false
            }
        }
        handToPhone()
    }

    /// No direct connection: the iPhone delivers the changes (queued by WatchConnectivity until it is reachable).
    private func handToPhone() {
        let fresh = ops.filter { !handed.contains($0.opId) }
        guard !fresh.isEmpty, let msg = WatchLink.ops(fresh) else { return }
        WatchConnector.shared.send(msg)
        handed.formUnion(fresh.map(\.opId))
    }

    // MARK: view state

    private func rebuild() {
        list = OpQueueLogic.apply(ops, to: snapshot)
        publishComplication()
    }

    @ObservationIgnored private var lastPublished: WidgetSnapshot?

    private func publishComplication() {
        let names = list.openItems.prefix(3).map { $0.productName ?? $0.text }
        let snap = WidgetSnapshot(open: list.openCount, items: Array(names), household: household, updatedAt: Date(), nextDue: nextDue)
        guard snap.open != lastPublished?.open || snap.items != lastPublished?.items || snap.nextDue != lastPublished?.nextDue else { return }
        lastPublished = snap
        snap.save()
        WidgetCenter.shared.reloadAllTimelines()
    }

    #if DEBUG
    /// Simulator screenshots without a paired iPhone: `-debugDemo YES`.
    private func loadDemo() {
        let mk: (Int, String, Double?, String) -> ShopItem = { id, text, qty, origin in
            ShopItem(id: id, text: text, qty: qty, origin: origin)
        }
        snapshot = ShopList(store: StoreRef(id: 1, name: "Lidl"), stores: [StoreRef(id: 1, name: "Lidl"), StoreRef(id: 2, name: "Aldi")],
                            sections: [
                                ShopSection(key: "produce", items: [mk(1, "Bananen", nil, "merkt sich: alle ~7 Tage"), mk(2, "Äpfel", 6, "Sam · heute 09:12")]),
                                ShopSection(key: "chilled", items: [mk(3, "Milch", 2, "Mira · gestern"), mk(4, "Joghurt", nil, "Ben · heute")]),
                                ShopSection(key: "bakery", items: [mk(5, "Brot", nil, "für „Sonntagsfrühstück“")]),
                            ])
        nextDue = "Haferflocken"
        signedIn = true
        rebuild()
    }
    #endif
}
