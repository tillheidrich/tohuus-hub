import XCTest
@testable import ToHuus

/// Same cases as test/shop.test.ts – the Swift fallback must agree with the server parser.
final class QuickAddParserTests: XCTestCase {
    private struct Brief: Equatable {
        let qty: Double?
        let unit: String?
        let name: String
        let amount: String?
    }

    private func brief(_ s: String) -> [Brief] {
        QuickAddParser.parse(s).map { Brief(qty: $0.qty, unit: $0.unit, name: $0.name, amount: $0.amount) }
    }

    func testSplitsAndReadsQuantities() {
        XCTAssertEqual(brief("2 Milch, Paketband und 3 Dosen Tomaten"), [
            Brief(qty: 2, unit: nil, name: "Milch", amount: nil),
            Brief(qty: nil, unit: nil, name: "Paketband", amount: nil),
            Brief(qty: 3, unit: "Dosen", name: "Tomaten", amount: nil),
        ])
    }

    func testXNotation() {
        XCTAssertEqual(brief("2x Butter; Joghurt x3; Eier 10"), [
            Brief(qty: 2, unit: nil, name: "Butter", amount: nil),
            Brief(qty: 3, unit: nil, name: "Joghurt", amount: nil),
            Brief(qty: 10, unit: nil, name: "Eier", amount: nil),
        ])
    }

    func testMeasuresAreAmounts() {
        XCTAssertEqual(brief("500 g Hackfleisch, 1,5 kg Kartoffeln, 500g Mehl"), [
            Brief(qty: nil, unit: "g", name: "Hackfleisch", amount: "500 g"),
            Brief(qty: nil, unit: "kg", name: "Kartoffeln", amount: "1,5 kg"),
            Brief(qty: nil, unit: "g", name: "Mehl", amount: "500 g"),
        ])
    }

    func testNumberWords() {
        XCTAssertEqual(brief("zwei Gurken and a loaf of bread & three cans of tomatoes"), [
            Brief(qty: 2, unit: nil, name: "Gurken", amount: nil),
            Brief(qty: 1, unit: "loaf", name: "Bread", amount: nil),
            Brief(qty: 3, unit: "cans", name: "Tomatoes", amount: nil),
        ])
    }

    func testDigitsInNames() {
        XCTAssertEqual(brief("7up, Cola Zero 1,5l"), [
            Brief(qty: nil, unit: nil, name: "7up", amount: nil),
            Brief(qty: nil, unit: nil, name: "Cola Zero 1,5l", amount: nil),
        ])
    }

    func testMergesAndBullets() {
        XCTAssertEqual(brief("- Milch\n- Milch\n\n• 2 Äpfel,,"), [
            Brief(qty: 2, unit: nil, name: "Milch", amount: nil),
            Brief(qty: 2, unit: nil, name: "Äpfel", amount: nil),
        ])
    }

    func testCapitalises() {
        XCTAssertEqual(QuickAddParser.parse("klopapier").first?.name, "Klopapier")
    }

    func testFragments() {
        XCTAssertEqual(QuickAddParser.fragments("Milch, Brot und Eier").map { $0.trimmingCharacters(in: .whitespaces) }, ["Milch", "Brot", "Eier"])
        XCTAssertTrue(QuickAddParser.parse("   ").isEmpty)
    }
}
