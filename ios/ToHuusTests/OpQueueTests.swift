import XCTest
@testable import ToHuus

final class OpQueueTests: XCTestCase {
    private func list() throws -> ShopList {
        let url = try XCTUnwrap(Bundle(for: Self.self).url(forResource: "shop-list", withExtension: "json"))
        return try JSONCoding.decoder().decode(ShopList.self, from: Data(contentsOf: url))
    }

    func testEncodesServerFormat() throws {
        let op = PendingOp.check(12, on: true, toStock: true)
        let obj = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(op)) as? [String: Any])
        XCTAssertEqual(obj["type"] as? String, "check")
        XCTAssertEqual(obj["id"] as? Int, 12)
        XCTAssertEqual(obj["on"] as? Bool, true)
        XCTAssertEqual(obj["to_stock"] as? Bool, true)
        XCTAssertTrue((obj["op_id"] as? String)?.count ?? 0 >= 4)
        XCTAssertNil(obj["text"], "nil fields are left out")
        let add = try XCTUnwrap(JSONSerialization.jsonObject(with: JSONEncoder().encode(PendingOp.add("2 Milch", localId: -1))) as? [String: Any])
        XCTAssertEqual(add["text"] as? String, "2 Milch")
        XCTAssertEqual(add["type"] as? String, "add")
    }

    func testQueuePersistsRoundTrip() throws {
        let ops = [PendingOp.add("Brot", localId: -3), .basket(4, on: true, storeId: 1), .delete(9)]
        let back = try JSONDecoder().decode([PendingOp].self, from: JSONEncoder().encode(ops))
        XCTAssertEqual(back, ops)
    }

    func testLastToggleWins() {
        var q: [PendingOp] = []
        q = OpQueueLogic.enqueue(.check(12, on: true), into: q)
        q = OpQueueLogic.enqueue(.check(12, on: false), into: q)
        XCTAssertEqual(q.count, 1)
        XCTAssertEqual(q[0].on, false)
    }

    func testTickingALocalRowCancelsItsAdd() {
        var q: [PendingOp] = []
        q = OpQueueLogic.enqueue(.add("Brot", localId: -1), into: q)
        q = OpQueueLogic.enqueue(.add("Butter", localId: -2), into: q)
        q = OpQueueLogic.enqueue(.check(-1, on: true), into: q)
        XCTAssertEqual(q.map(\.text), ["Butter"])
        q = OpQueueLogic.enqueue(.delete(-2), into: q)
        XCTAssertTrue(q.isEmpty)
    }

    func testDeleteDropsEarlierTogglesForTheRow() {
        var q: [PendingOp] = []
        q = OpQueueLogic.enqueue(.check(12, on: true), into: q)
        q = OpQueueLogic.enqueue(.delete(12), into: q)
        XCTAssertEqual(q.map(\.type), [.delete])
    }

    func testRemoveAnswered() {
        let a = PendingOp.delete(1), b = PendingOp.delete(2)
        XCTAssertEqual(OpQueueLogic.remove(answered: [a.opId], from: [a, b]), [b])
    }

    func testApplyOnSnapshot() throws {
        let base = try list()
        var q: [PendingOp] = []
        q = OpQueueLogic.enqueue(.add("3 Dosen Tomaten", localId: -1), into: q)
        q = OpQueueLogic.enqueue(.check(12, on: true), into: q)
        q = OpQueueLogic.enqueue(.delete(14), into: q)
        q = OpQueueLogic.enqueue(.check(9, on: false), into: q)
        let out = OpQueueLogic.apply(q, to: base)
        let open = out.openItems
        XCTAssertTrue(open.contains { $0.id == -1 && $0.text == "Tomaten" && $0.qty == 3 && $0.pending == true })
        XCTAssertFalse(open.contains { $0.id == 12 })
        XCTAssertTrue(out.done.contains { $0.id == 12 })
        XCTAssertFalse(open.contains { $0.id == 14 })
        XCTAssertTrue(open.contains { $0.id == 9 }, "unticked row is open again")
        XCTAssertEqual(out.open, open.count)
    }

    func testApplyBasket() throws {
        let out = OpQueueLogic.apply([.basket(13, on: true, storeId: 1)], to: try list())
        XCTAssertEqual(out.basket.map(\.id), [13])
        XCTAssertTrue(out.basket[0].isInBasket)
    }

    func testAddDoesNotDuplicateWhatIsOpen() throws {
        let out = OpQueueLogic.apply([.add("vollmilch", localId: -5)], to: try list())
        XCTAssertFalse(out.openItems.contains { $0.id == -5 })
    }
}
