#if os(iOS) && canImport(ActivityKit)
import ActivityKit
import Foundation

/// Live Activity "Einkauf läuft" (lock screen + Dynamic Island): while I am shopping – the server sees it as a trip
/// as soon as I tick two things within a few minutes – it shows how much is in the basket, what is still open and the
/// "Bringst du noch … mit?" wishes of the others. Started, updated and ended by the app (LiveTripActivity.swift),
/// drawn by the widget extension (ToHuusWidget/TripActivityWidget.swift). Shared by both targets.
struct ShoppingTripAttributes: ActivityAttributes {
    struct ContentState: Codable, Hashable, Sendable {
        /// ticked on this trip
        var basket: Int
        /// still open on the list
        var open: Int
        /// up to three "Bringst du noch … mit?" from others
        var addOns: [String]
        var store: String?
    }

    var tripId: Int
}
#endif
