import Foundation

/// One queued change to the shopping list, in the format of POST /api/shop/sync (server/lib/shop.ts `OfflineOp`).
struct PendingOp: Codable, Sendable, Equatable {
    enum Kind: String, Codable, Sendable { case add, basket, check, delete, claim }

    var opId: String
    var type: Kind
    /// add
    var text: String?
    var productId: Int?
    var qty: Double?
    /// basket / check / delete / claim
    var id: Int?
    var on: Bool?
    var storeId: Int?
    var toStock: Bool?
    /// add: the temporary (negative) id of the row shown until the server confirms; ignored by the server
    var localId: Int?

    enum CodingKeys: String, CodingKey {
        case opId = "op_id", type, text, productId = "product_id", qty, id, on, storeId = "store_id", toStock = "to_stock", localId = "local_id"
    }

    static func newId() -> String { "ios-" + UUID().uuidString.lowercased() }

    static func add(_ text: String, productId: Int? = nil, qty: Double? = nil, localId: Int) -> PendingOp {
        PendingOp(opId: newId(), type: .add, text: text, productId: productId, qty: qty, localId: localId)
    }
    static func check(_ id: Int, on: Bool, toStock: Bool = false) -> PendingOp {
        PendingOp(opId: newId(), type: .check, id: id, on: on, toStock: toStock)
    }
    static func basket(_ id: Int, on: Bool, storeId: Int?) -> PendingOp {
        PendingOp(opId: newId(), type: .basket, id: id, on: on, storeId: storeId)
    }
    static func delete(_ id: Int) -> PendingOp { PendingOp(opId: newId(), type: .delete, id: id) }
}

/// Pure queue logic (unit-tested): coalescing, cancelling ops on not-yet-sent rows, and applying the queue on top of
/// the last server snapshot so the list looks right while offline.
enum OpQueueLogic {
    /// Adds an op to the queue, merging with what is already waiting.
    static func enqueue(_ op: PendingOp, into queue: [PendingOp]) -> [PendingOp] {
        var q = queue
        if let target = op.id, target < 0 {
            // a row that only exists locally: deleting or ticking it simply cancels its add
            switch op.type {
            case .delete, .check, .basket:
                if op.type == .delete || op.on == true { q.removeAll { $0.type == .add && $0.localId == target } }
                return q
            default:
                return q
            }
        }
        switch op.type {
        case .check, .basket, .claim:
            // last state wins
            q.removeAll { $0.type == op.type && $0.id == op.id }
        case .delete:
            q.removeAll { $0.id == op.id && $0.type != .add }
        case .add:
            break
        }
        q.append(op)
        return q
    }

    /// Removes the ops the server has answered (ok or a permanent error); network failures keep them.
    static func remove(answered ids: Set<String>, from queue: [PendingOp]) -> [PendingOp] {
        queue.filter { !ids.contains($0.opId) }
    }

    /// The list as it will look once the queue is through.
    static func apply(_ ops: [PendingOp], to list: ShopList, now: Date = Date()) -> ShopList {
        var l = list
        let stamp = ISO8601DateFormatter().string(from: now)
        for op in ops {
            switch op.type {
            case .add:
                guard let text = op.text else { continue }
                let parsed = QuickAddParser.parse(text).first
                let name = parsed?.name ?? text
                let lower = name.lowercased()
                let already = l.openItems.contains { ($0.productName ?? $0.text).lowercased() == lower }
                if already { continue }
                let item = ShopItem(id: op.localId ?? -1, productId: op.productId, text: name, qty: op.qty ?? parsed?.qty,
                                    note: parsed?.amount, source: "manual", createdAt: stamp, section: "other", pending: true)
                if let i = l.sections.firstIndex(where: { $0.key == "other" }) {
                    l.sections[i].items.insert(item, at: 0)
                } else {
                    l.sections.append(ShopSection(key: "other", items: [item]))
                }
            case .check, .basket:
                guard let id = op.id else { continue }
                let on = op.on ?? true
                if on {
                    guard var item = take(id, from: &l, open: true) else { continue }
                    item.checkedAt = stamp
                    item.inBasket = .bool(op.type == .basket)
                    item.pending = true
                    if op.type == .basket { l.basket.insert(item, at: 0) } else { l.done.insert(item, at: 0) }
                } else {
                    guard var item = take(id, from: &l, open: false) else { continue }
                    item.checkedAt = nil
                    item.inBasket = .bool(false)
                    item.pending = true
                    let key = item.section ?? "other"
                    if let i = l.sections.firstIndex(where: { $0.key == key }) {
                        l.sections[i].items.insert(item, at: 0)
                    } else {
                        l.sections.append(ShopSection(key: key, items: [item]))
                    }
                }
            case .delete:
                guard let id = op.id else { continue }
                _ = take(id, from: &l, open: true)
                _ = take(id, from: &l, open: false)
            case .claim:
                continue
            }
        }
        l.sections.removeAll { $0.items.isEmpty }
        l.open = l.openCount
        return l
    }

    private static func take(_ id: Int, from l: inout ShopList, open: Bool) -> ShopItem? {
        if open {
            for s in l.sections.indices {
                if let i = l.sections[s].items.firstIndex(where: { $0.id == id }) { return l.sections[s].items.remove(at: i) }
            }
            return nil
        }
        if let i = l.basket.firstIndex(where: { $0.id == id }) { return l.basket.remove(at: i) }
        if let i = l.done.firstIndex(where: { $0.id == id }) { return l.done.remove(at: i) }
        return nil
    }
}
