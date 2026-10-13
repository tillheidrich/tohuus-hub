#if canImport(ActivityKit)
import ActivityKit
import Foundation

/// Starts, updates and ends the "Einkauf läuft" Live Activity from the trips the server reports
/// (GET /api/shop/trips → `mine`). Local updates only: the app refreshes trips while it is open; when the trip
/// ends (Einkauf fertig, 20 quiet minutes) the activity ends too. Nothing happens when Live Activities are off.
@MainActor
enum LiveTripActivity {
    static func sync(trip: Trip?, open: Int) {
        guard ActivityAuthorizationInfo().areActivitiesEnabled else { return }
        let running = Activity<ShoppingTripAttributes>.activities
        guard let trip else {
            Task { await endAll(except: nil, policy: .default) }
            return
        }
        let state = ShoppingTripAttributes.ContentState(
            basket: trip.basket.count,
            open: open,
            addOns: Array(trip.openAddOns.prefix(3).map(\.text)),
            store: trip.store?.name
        )
        // a trip that has been quiet for half an hour is shown as stale by the system
        let content = ActivityContent(state: state, staleDate: Date().addingTimeInterval(30 * 60))
        if let current = running.first(where: { $0.attributes.tripId == trip.id }) {
            guard current.content.state != state else { return }
            let id = trip.id
            Task { await update(tripId: id, content: content) }
            return
        }
        // Activity is not Sendable: the async calls run in nonisolated helpers that look the activities up themselves
        let keep = trip.id
        Task { await endAll(except: keep, policy: .immediate) }
        do {
            _ = try Activity.request(attributes: ShoppingTripAttributes(tripId: trip.id), content: content, pushType: nil)
        } catch {
            Task { await ErrorLog.shared.record(kind: "app", message: "Live Activity: \(error.localizedDescription)") }
        }
    }

    nonisolated private static func endAll(except tripId: Int?, policy: ActivityUIDismissalPolicy) async {
        for a in Activity<ShoppingTripAttributes>.activities where tripId == nil || a.attributes.tripId != tripId {
            await a.end(nil, dismissalPolicy: policy)
        }
    }

    nonisolated private static func update(tripId: Int, content: ActivityContent<ShoppingTripAttributes.ContentState>) async {
        for a in Activity<ShoppingTripAttributes>.activities where a.attributes.tripId == tripId {
            await a.update(content)
        }
    }
}
#endif
