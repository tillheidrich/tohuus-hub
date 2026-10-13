import Foundation

/// GET /api/cloud/store-choices – "Wo kauft ihr meistens ein?" at sign-up: common shops of the region in alphabetical
/// order (no chain first), the weekly market. Own entries are free text (docs/cloud.md › Shops without favourites).
struct StoreChoices: Decodable, Sendable {
    var stores: [String]
    var market: String?
}
