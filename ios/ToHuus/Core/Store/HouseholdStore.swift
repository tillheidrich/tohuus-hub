import Foundation

/// What the screens need from a household, independent of where it lives. Today the only implementation is
/// `ServerStore` (self-hosted server or ToHuus Cloud); an iCloud store could implement the same protocol later
/// (docs/architecture-native.md, mode c).
@MainActor
protocol HouseholdStore: AnyObject {
    var api: APIClient { get }
    /// the shopping list as shown: last server state with queued offline changes applied
    var list: ShopList { get }
    var pendingCount: Int { get }
    var isOnline: Bool { get }
    /// increases whenever a topic changes (SSE or own writes); screens observe it to refresh
    func revision(_ topic: String) -> Int

    func refreshList() async
    func add(text: String) async
    func setChecked(_ item: ShopItem, _ on: Bool) async
    func setInBasket(_ item: ShopItem, _ on: Bool, storeId: Int?) async
    func delete(_ item: ShopItem) async
    func flush() async
    func touch(_ topics: String...)
}
