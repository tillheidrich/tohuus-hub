import Foundation
import Observation
import WidgetKit

/// Household data from a ToHuus server: the offline-capable shopping list and live refresh via SSE.
@MainActor
@Observable
final class ServerStore: HouseholdStore {
    let api: APIClient
    private(set) var list: ShopList = .empty
    private(set) var isOnline = true
    private(set) var lastError: String?
    private(set) var lastSynced: Date?
    private(set) var storeId: Int?
    private(set) var shopMode = false
    /// several lists: the one shown (nil = the main list)
    private(set) var listId: String? = SharedConfig.defaults.string(forKey: "list.current")
    /// who is out shopping (GET /api/shop/trips); false once the server answered 404
    private(set) var trips: [Trip] = []
    /// a shared Cookidoo link waiting for the person to confirm title + ingredients (cloud never reads Cookidoo)
    var cookidooDraft: CookidooDraftRequest?
    private(set) var tripsSupported = true

    private var snapshot: ShopList = .empty
    private var ops: [PendingOp] = []
    private var revisions: [String: Int] = [:]
    private var nextLocalId = -1
    private let cache: ShoppingCache
    @ObservationIgnored private var eventsTask: Task<Void, Never>?
    @ObservationIgnored private var flushing = false

    var pendingCount: Int { ops.count }

    init(api: APIClient, householdKey: String) {
        self.api = api
        cache = ShoppingCache(householdKey: householdKey)
        ops = cache.loadOps()
        if let cached = cache.loadSnapshot() { snapshot = cached }
        nextLocalId = min(-1, (ops.compactMap(\.localId).min() ?? 0) - 1)
        rebuild()
    }

    func revision(_ topic: String) -> Int { revisions[topic, default: 0] + revisions["*", default: 0] }

    func touch(_ topics: String...) {
        for t in topics { revisions[t, default: 0] += 1 }
    }

    // MARK: live updates

    func startEvents() {
        guard eventsTask == nil else { return }
        let stream = EventStream(client: api).topics()
        eventsTask = Task { [weak self] in
            for await topics in stream {
                guard let self else { return }
                self.isOnline = true
                if topics.contains("*") {
                    self.revisions["*", default: 0] += 1
                    await self.flush()
                    await self.refreshList()
                    continue
                }
                for t in topics { self.revisions[t, default: 0] += 1 }
                if topics.contains("shopping") || topics.contains("products") {
                    await self.refreshList()
                    await self.refreshTrips()
                }
            }
        }
    }

    func stopEvents() {
        eventsTask?.cancel()
        eventsTask = nil
    }

    // MARK: list

    func setList(_ id: String?) async {
        listId = id == "0" ? nil : id
        SharedConfig.defaults.set(id, forKey: "list.current")
        await refreshList()
    }

    func refreshTrips() async {
        guard tripsSupported else { return }
        do {
            trips = try await api.trips()
            // "Einkauf läuft" on the lock screen and in the Dynamic Island (LiveTripActivity.swift)
            LiveTripActivity.sync(trip: trips.first(where: \.isMine), open: list.openCount)
        } catch APIError.notFound {
            tripsSupported = false
        } catch {}
    }

    func setStore(_ id: Int?, shopMode: Bool) async {
        storeId = id
        self.shopMode = shopMode
        await refreshList()
    }

    func refreshList() async {
        do {
            let data = try await api.shopList(storeId: storeId, shopMode: shopMode, listId: listId)
            let decoded = try api.decode(ShopList.self, from: data)
            snapshot = decoded
            if storeId == nil && !shopMode && listId == nil { cache.saveSnapshot(data) }
            isOnline = true
            lastError = nil
            lastSynced = Date()
            rebuild()
        } catch let e as APIError {
            if e.isOffline { isOnline = false } else { lastError = e.localizedDescription }
        } catch {
            lastError = error.localizedDescription
        }
    }

    private func rebuild() {
        list = OpQueueLogic.apply(ops, to: snapshot)
        if !shopMode && storeId == nil && listId == nil {
            publishWidgetSnapshot()
            PhoneWatchBridge.shared.publish(list: list, nextDue: nextDue, household: householdName)
        }
    }

    /// what ToHuus remembers as probably due next (set by Heute; shown on the watch complication)
    var nextDue: String? {
        didSet { if nextDue != oldValue { rebuild() } }
    }
    var householdName: String?

    /// Ticks and additions made on the watch while it had no network of its own. They join this queue (op ids keep a
    /// second delivery harmless) and are acknowledged to the watch right away – the iPhone keeps them from here.
    func enqueueRemote(_ remote: [PendingOp]) async {
        guard !remote.isEmpty else { return }
        let known = Set(ops.map(\.opId))
        for var op in remote where !known.contains(op.opId) {
            if op.type == .add {
                op.localId = nextLocalId
                nextLocalId -= 1
            }
            ops = OpQueueLogic.enqueue(op, into: ops)
        }
        cache.saveOps(ops)
        rebuild()
        PhoneWatchBridge.shared.publish(list: list, nextDue: nextDue, household: householdName, ackOps: remote.map(\.opId))
        touch("shopping")
        await flush()
    }

    @ObservationIgnored private var lastWidget: WidgetSnapshot?

    /// The home-screen widget reads this from the App Group.
    private func publishWidgetSnapshot() {
        let names = list.openItems.prefix(3).map { item -> String in
            let n = item.productName ?? item.text
            return item.qtyLabel.map { "\($0) \(n)" } ?? n
        }
        let snap = WidgetSnapshot(open: list.openCount, items: Array(names), household: nil, updatedAt: Date())
        guard snap.open != lastWidget?.open || snap.items != lastWidget?.items else { return }
        lastWidget = snap
        snap.save()
        WidgetCenter.shared.reloadTimelines(ofKind: "ToHuusShopping")
    }

    private func enqueue(_ op: PendingOp) async {
        ops = OpQueueLogic.enqueue(op, into: ops)
        cache.saveOps(ops)
        rebuild()
        await flush()
    }

    func add(text: String) async {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        // one op per fragment, so each row can be ticked or removed on its own while offline
        let parts = QuickAddParser.fragments(trimmed).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        for part in parts.isEmpty ? [trimmed] : parts {
            var op = PendingOp.add(part, localId: nextLocalId)
            op.listId = listId.flatMap(Int.init)
            nextLocalId -= 1
            ops = OpQueueLogic.enqueue(op, into: ops)
        }
        cache.saveOps(ops)
        rebuild()
        touch("shopping")
        await flush()
    }

    /// `onShownList`: from the list screen, onto the list that is shown (else the main list, as before)
    func addProduct(_ productId: Int, name: String, qty: Double? = nil, onShownList: Bool = false) async {
        var op = PendingOp.add(name, productId: productId, qty: qty, localId: nextLocalId)
        if onShownList { op.listId = listId.flatMap(Int.init) }
        nextLocalId -= 1
        await enqueue(op)
    }

    /// `toStock`: "Beim Abhaken einräumen" (the person's switch on the list, default on)
    func setChecked(_ item: ShopItem, _ on: Bool, toStock: Bool = true) async {
        await enqueue(.check(item.id, on: on, toStock: on && toStock))
    }

    func setInBasket(_ item: ShopItem, _ on: Bool, storeId: Int?) async {
        await enqueue(.basket(item.id, on: on, storeId: storeId))
    }

    func delete(_ item: ShopItem) async {
        await enqueue(.delete(item.id))
    }

    /// Sends queued changes via POST /api/shop/sync (op ids make retries harmless), then reloads the list.
    func flush() async {
        guard !flushing, !ops.isEmpty else { return }
        flushing = true
        defer { flushing = false }
        let batch = Array(ops.prefix(200))
        do {
            let res = try await api.sync(batch)
            var answered = Set(res.results.map(\.opId))
            // a server that answered at all has seen every op in the batch
            if answered.isEmpty { answered = Set(batch.map(\.opId)) }
            ops = OpQueueLogic.remove(answered: answered, from: ops)
            cache.saveOps(ops)
            isOnline = true
            touch("shopping")
            await refreshList()
        } catch let e as APIError {
            if e.isOffline { isOnline = false }
            else if case .server(let status, _) = e, (400..<500).contains(status) {
                // a malformed batch would block the queue forever – drop it
                ops = OpQueueLogic.remove(answered: Set(batch.map(\.opId)), from: ops)
                cache.saveOps(ops)
                rebuild()
            } else {
                lastError = e.localizedDescription
            }
        } catch {
            lastError = error.localizedDescription
        }
    }

    func checkout(toStock: Bool) async {
        await flush()
        do {
            // "Einkauf fertig": ticked rows leave the list and the person's trip ends (older servers: checkout)
            try await api.finishShopping(storeId: storeId, toStock: toStock)
            touch("shopping", "stock")
            await refreshList()
            await refreshTrips()
        } catch {
            lastError = APIError.from(error).localizedDescription
        }
    }

    func clearDone() async {
        do {
            try await api.clearChecked()
            await refreshList()
        } catch {
            lastError = APIError.from(error).localizedDescription
        }
    }

    /// Sends files shared via the share extension while the app was closed or offline.
    func drainUploadQueue(session: SessionInfo) async {
        guard let token = api.token else { return }
        let uploader = ShareUploader(session: session, token: token)
        for item in UploadQueue.all() {
            if item.confirm == true {
                cookidooDraft = CookidooDraftRequest(url: item.url ?? "", text: item.text)
                UploadQueue.remove(id: item.id)
                continue
            }
            let files = item.files.compactMap { UploadQueue.data(for: $0) }
            do {
                try await uploader.upload(item, files: files)
                UploadQueue.remove(id: item.id)
                touch("imports", "recipes")
            } catch ShareUploader.UploadError.offline {
                return
            } catch ShareUploader.UploadError.needsConfirm {
                cookidooDraft = CookidooDraftRequest(url: item.url ?? "", text: item.text)
                UploadQueue.remove(id: item.id)
            } catch {
                // the server refused it (format, quota): keep nothing that can never succeed
                UploadQueue.remove(id: item.id)
                lastError = (error as? ShareUploader.UploadError).map { if case .server(let m) = $0 { return m } else { return "" } }
            }
        }
    }
}
