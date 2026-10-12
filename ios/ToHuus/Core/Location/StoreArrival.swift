import CoreLocation
import Foundation
import Observation
import UserNotifications

/// Opt-in hint "Du bist bei Lidl – Liste öffnen?": region monitoring around shops the person saved themselves.
/// Off by default. The shop locations live only on this iPhone (Application Support, file protection); no location ever
/// leaves the device – the hint is a local notification.
@MainActor
@Observable
final class StoreArrival: NSObject {
    static let shared = StoreArrival()

    struct SavedShop: Codable, Identifiable, Equatable, Sendable {
        var id = UUID()
        var name: String
        /// the ToHuus shop (for the walking order in shop mode)
        var storeId: Int?
        var latitude: Double
        var longitude: Double
        var radius: Double = 150
    }

    private(set) var enabled = SharedConfig.defaults.bool(forKey: "arrival.enabled")
    private(set) var shops: [SavedShop] = []
    private(set) var authorization: CLAuthorizationStatus = .notDetermined
    private(set) var locating = false
    var error: String?

    @ObservationIgnored private var manager: CLLocationManager?
    @ObservationIgnored private var pendingShop: (name: String, storeId: Int?)?
    @ObservationIgnored private var lastHint: [UUID: Date] = [:]

    private static var fileURL: URL {
        let base = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ToHuus-device", isDirectory: true)
        try? FileManager.default.createDirectory(at: base, withIntermediateDirectories: true)
        return base.appendingPathComponent("shop-places.json")
    }

    /// Called at launch (also for a background launch caused by a region event).
    func start() {
        shops = (try? JSONDecoder().decode([SavedShop].self, from: Data(contentsOf: Self.fileURL))) ?? []
        guard enabled || !(manager?.monitoredRegions.isEmpty ?? true) else { return }
        ensureManager()
        syncRegions()
    }

    private func ensureManager() {
        guard manager == nil else { return }
        let m = CLLocationManager()
        m.delegate = self
        m.desiredAccuracy = kCLLocationAccuracyHundredMeters
        manager = m
        authorization = m.authorizationStatus
    }

    var alwaysAllowed: Bool { authorization == .authorizedAlways }

    /// Step 1 after the explanation: "while using", then "always" (iOS asks in two steps).
    func enable() async {
        ensureManager()
        enabled = true
        SharedConfig.defaults.set(true, forKey: "arrival.enabled")
        _ = try? await UNUserNotificationCenter.current().requestAuthorization(options: [.alert, .sound])
        switch authorization {
        case .notDetermined: manager?.requestWhenInUseAuthorization()
        case .authorizedWhenInUse: manager?.requestAlwaysAuthorization()
        default: break
        }
        syncRegions()
    }

    func disable() {
        enabled = false
        SharedConfig.defaults.set(false, forKey: "arrival.enabled")
        for r in manager?.monitoredRegions ?? [] { manager?.stopMonitoring(for: r) }
    }

    func requestAlways() {
        ensureManager()
        manager?.requestAlwaysAuthorization()
    }

    /// Saves the current position as a shop ("Ich bin gerade bei …").
    func addHere(name: String, storeId: Int?) {
        ensureManager()
        pendingShop = (name, storeId)
        locating = true
        if authorization == .notDetermined { manager?.requestWhenInUseAuthorization() }
        manager?.requestLocation()
    }

    /// A shop whose coordinates someone typed into ToHuus (GET /api/shop/stores → lat, lon, radius_m).
    func addKnown(_ store: StoreRef) {
        guard let lat = store.lat, let lon = store.lon, !shops.contains(where: { $0.storeId == store.id }) else { return }
        ensureManager()
        shops.append(SavedShop(name: store.name, storeId: store.id, latitude: lat, longitude: lon, radius: store.radiusM ?? 150))
        save()
        syncRegions()
    }

    func remove(_ shop: SavedShop) {
        shops.removeAll { $0.id == shop.id }
        save()
        syncRegions()
    }

    private func save() {
        guard let data = try? JSONEncoder().encode(shops) else { return }
        try? data.write(to: Self.fileURL, options: [.atomic, .completeFileProtectionUntilFirstUserAuthentication])
    }

    /// iOS watches at most 20 regions per app.
    private func syncRegions() {
        guard let manager else { return }
        for r in manager.monitoredRegions { manager.stopMonitoring(for: r) }
        guard enabled, CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else { return }
        for s in shops.prefix(20) {
            let region = CLCircularRegion(center: CLLocationCoordinate2D(latitude: s.latitude, longitude: s.longitude),
                                          radius: min(max(s.radius, 100), manager.maximumRegionMonitoringDistance), identifier: s.id.uuidString)
            region.notifyOnEntry = true
            region.notifyOnExit = false
            manager.startMonitoring(for: region)
        }
    }

    fileprivate func entered(_ id: String) {
        guard enabled, let shop = shops.first(where: { $0.id.uuidString == id }) else { return }
        // once per shop and two hours
        if let last = lastHint[shop.id], Date().timeIntervalSince(last) < 7200 { return }
        let open = WidgetSnapshot.load()?.open ?? 0
        guard open > 0 else { return }
        lastHint[shop.id] = Date()
        let content = UNMutableNotificationContent()
        content.title = LF("You're at %@ – open the list?", shop.name)
        content.body = open == 1 ? L("1 thing is missing.") : LF("%d things are missing.", open)
        content.categoryIdentifier = NotifyKit.Category.arrival.rawValue
        content.threadIdentifier = "arrival"
        var data: [String: String] = [:]
        if let sid = shop.storeId { data["store_id"] = String(sid) }
        content.userInfo = ["url": "tohuus://shopping", "data": data]
        let req = UNNotificationRequest(identifier: "arrival-\(shop.id.uuidString)", content: content, trigger: nil)
        UNUserNotificationCenter.current().add(req)
    }

    fileprivate func located(_ location: CLLocation?) {
        locating = false
        guard let location, let p = pendingShop else { return }
        pendingShop = nil
        shops.append(SavedShop(name: p.name, storeId: p.storeId, latitude: location.coordinate.latitude, longitude: location.coordinate.longitude))
        save()
        syncRegions()
    }

    fileprivate func authorizationChanged(_ status: CLAuthorizationStatus) {
        let before = authorization
        authorization = status
        // second step right after "while using" was granted, only because the person switched the hint on
        if enabled && before == .notDetermined && status == .authorizedWhenInUse { manager?.requestAlwaysAuthorization() }
        syncRegions()
    }
}

extension StoreArrival: CLLocationManagerDelegate {
    // the manager is created on the main thread, so its callbacks arrive there
    nonisolated func locationManager(_ manager: CLLocationManager, didEnterRegion region: CLRegion) {
        let id = region.identifier
        MainActor.assumeIsolated { self.entered(id) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
        let last = locations.last
        MainActor.assumeIsolated { self.located(last) }
    }

    nonisolated func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
        let message = error.localizedDescription
        MainActor.assumeIsolated {
            self.locating = false
            self.pendingShop = nil
            self.error = message
        }
    }

    nonisolated func locationManagerDidChangeAuthorization(_ manager: CLLocationManager) {
        let status = manager.authorizationStatus
        MainActor.assumeIsolated { self.authorizationChanged(status) }
    }
}
