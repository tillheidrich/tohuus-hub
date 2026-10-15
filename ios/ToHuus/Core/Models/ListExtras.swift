import Foundation

/// GET /api/list/guard → { hints: [{ kind: on_list|bought|stock|waste, text, itemId?, day?, qty? }] }
struct GuardResponse: Decodable, Sendable {
    @Lossy var hints: [GuardHint]
}

struct GuardHint: Decodable, Sendable, Hashable {
    var kind: String
    var text: String
    var itemId: Int?
    var day: String?
    /// the web app asks only for these; "already on the list" is merged by the server anyway
    var asks: Bool { kind == "bought" || kind == "stock" }
}

/// GET /api/list/usuals → [{ productId, name, image_path, count, lastDay, onList }]
struct Usual: Decodable, Sendable, Identifiable, Hashable {
    var productId: Int
    var name: String
    var imagePath: String?
    var count: Int?
    var lastDay: String?
    var onList: Bool?
    var id: Int { productId }
}

/// Offers from a flyer the household scanned itself (GET /api/offers, POST /api/offers/scan).
struct Offer: Decodable, Sendable, Identifiable, Hashable {
    var id: Int
    var name: String
    var price: Double?
    var regularPrice: Double?
    var size: String?
    var shop: String?
    var validFrom: String?
    var validTo: String?
    var productId: Int?
    var hints: [String]?
    var onList: Bool?
    /// due by the household's own rhythm, or just put on the list from this offer
    var due: Bool?
    var added: Bool?
}

/// GET /api/prices/cheapest → [{ productId, name, saving, shops: [{ shop, price, day, base }] }]
struct CheapestProduct: Decodable, Sendable, Identifiable, Hashable {
    var productId: Int
    var name: String
    var saving: Double?
    @Lossy var shops: [ShopPrice]
    var id: Int { productId }

    static func == (a: CheapestProduct, b: CheapestProduct) -> Bool { a.productId == b.productId }
    func hash(into h: inout Hasher) { h.combine(productId) }
}

/// One shop's price (GET /api/prices/product/:id, cheapest first)
struct ShopPrice: Decodable, Sendable, Hashable {
    var shop: String?
    var price: Double?
    var day: String?
    var base: Base?

    struct Base: Decodable, Sendable, Hashable {
        var value: Double?
        var unit: String?
    }

    var baseLabel: String? {
        guard let v = base?.value, let u = base?.unit else { return nil }
        return v.formatted(.currency(code: Locale.current.currency?.identifier ?? "EUR")) + " / " + u
    }
}

/// POST /api/imports/lines → receipt { kind, id, via, sumMatches, confidence } | list { kind, items: [{ name, qty, confidence }] }
struct LinesImport: Decodable, Sendable {
    var kind: String?
    var id: Int?
    var title: String?
    var sumMatches: Bool?
    var confidence: Double?
    @Lossy var items: [Item]

    struct Item: Decodable, Sendable, Hashable {
        var name: String
        var qty: Double?
        var confidence: Double?
    }
}

