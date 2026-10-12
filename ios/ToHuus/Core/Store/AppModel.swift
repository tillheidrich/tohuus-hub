import Foundation
import Observation
import UIKit

/// App-wide state: which server, who is signed in, which household, plan status.
@MainActor
@Observable
final class AppModel {
    enum Phase: Equatable { case launching, start, signedIn }

    private(set) var phase: Phase = .launching
    private(set) var session: SessionInfo?
    private(set) var instance: InstanceInfo?
    private(set) var store: ServerStore?
    private(set) var households: [HouseholdRef] = []
    private(set) var billing: BillingStatus?
    private(set) var userName: String?
    var notice: String?
    var showAssistant = false
    var showPaywall = false

    private static let householdsKey = "session.households"
    private static let userKey = "session.user"

    var isCloud: Bool { session?.isCloud ?? false }
    /// purchases only exist in ToHuus Cloud; a self-hosted server has everything unlocked
    var purchasesAvailable: Bool { isCloud && (instance?.billingApple ?? true) }
    var activeHousehold: HouseholdRef? { households.first { $0.id.value == session?.householdId } ?? households.first }
    var api: APIClient? { store?.api }

    // MARK: launch

    func restore() async {
        guard let s = SessionInfo.load(), let token = SessionInfo.token else {
            phase = .start
            return
        }
        session = s
        if let data = SharedConfig.defaults.data(forKey: Self.householdsKey),
           let list = try? JSONDecoder().decode([HouseholdRef].self, from: data) { households = list }
        userName = SharedConfig.defaults.string(forKey: Self.userKey)
        open(session: s, token: token)
        phase = .signedIn
        Task {
            instance = try? await APIClient(baseURL: s.serverURL).instance()
            await refreshBilling()
        }
    }

    // MARK: connect & sign in

    func loadInstance(_ url: URL) async throws -> InstanceInfo {
        let info = try await APIClient(baseURL: url).instance()
        instance = info
        return info
    }

    static func normalise(_ raw: String) -> URL? {
        var s = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        if let r = s.range(of: #"https?://[^\s"'<>]+"#, options: .regularExpression) { s = String(s[r]) }
        if !s.lowercased().hasPrefix("http") { s = "https://" + s }
        while s.hasSuffix("/") { s.removeLast() }
        guard let url = URL(string: s), url.host != nil else { return nil }
        return url
    }

    static var deviceName: String {
        let model = UIDevice.current.model
        return "ToHuus iOS · \(model)"
    }

    func signIn(server: URL, mode: String, login: String, password: String, code: String?) async throws {
        let res = try await APIClient(baseURL: server).signIn(login: login, password: password, code: code, device: Self.deviceName)
        finishSignIn(server: server, mode: mode, response: res)
    }

    func signUp(email: String, password: String, name: String, householdName: String, form: String) async throws {
        let server = SharedConfig.cloudURL
        let res = try await APIClient(baseURL: server).signUp(email: email, password: password, name: name,
                                                              householdName: householdName, form: form, device: Self.deviceName)
        finishSignIn(server: server, mode: "cloud", response: res)
        if res.userName == nil { userName = name }
    }

    private func finishSignIn(server: URL, mode: String, response: AppAuthResponse) {
        let s = SessionInfo(serverURL: server, mode: mode, householdId: response.householdId, deviceName: Self.deviceName)
        s.save()
        SessionInfo.token = response.token
        session = s
        households = response.households
        saveHouseholds()
        userName = response.userName
        SharedConfig.defaults.set(userName, forKey: Self.userKey)
        open(session: s, token: response.token)
        phase = .signedIn
        Task { await refreshBilling() }
    }

    private func saveHouseholds() {
        if let data = try? JSONEncoder().encode(households) { SharedConfig.defaults.set(data, forKey: Self.householdsKey) }
    }

    private func open(session s: SessionInfo, token: String) {
        store?.stopEvents()
        let api = APIClient(baseURL: s.serverURL, token: token, householdId: s.householdId) { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        }
        let st = ServerStore(api: api, householdKey: s.householdId ?? s.serverURL.host() ?? "default")
        store = st
        st.startEvents()
        Task {
            await st.refreshList()
            await st.flush()
            await st.drainUploadQueue(session: s)
        }
    }

    func switchHousehold(_ h: HouseholdRef) {
        guard var s = session, let token = SessionInfo.token, s.householdId != h.id.value else { return }
        s.householdId = h.id.value
        s.save()
        session = s
        open(session: s, token: token)
        Task { await refreshBilling() }
    }

    /// Called when the app comes to the foreground.
    func becameActive() async {
        guard let store, let session else { return }
        await store.flush()
        await store.refreshList()
        await store.drainUploadQueue(session: session)
        store.touch("*")
    }

    // MARK: plan

    func refreshBilling() async {
        guard let api else { return }
        if let b = try? await api.billingStatus() { billing = b }
        else if !isCloud { billing = BillingStatus(plan: "selfhost") }
        if isCloud, let me = try? await api.cloudMe(), !me.allHouseholds.isEmpty {
            households = me.allHouseholds
            saveHouseholds()
        }
    }

    func setBilling(_ b: BillingStatus) { billing = b }

    // MARK: sign out

    private func handleUnauthorized() {
        guard phase == .signedIn else { return }
        signOut(message: L("You have been signed out. Please sign in again."))
    }

    func signOut(message: String? = nil) {
        store?.stopEvents()
        store = nil
        SessionInfo.clear()
        SharedConfig.defaults.removeObject(forKey: Self.householdsKey)
        SharedConfig.defaults.removeObject(forKey: Self.userKey)
        ShoppingCache.wipeAll()
        session = nil
        households = []
        billing = nil
        userName = nil
        notice = message
        phase = .start
    }

    /// App Review 5.1.1(v): delete the cloud account from inside the app.
    func deleteAccount() async throws {
        guard let api else { return }
        try await api.deleteCloudAccount()
        signOut(message: L("Your account has been deleted."))
    }
}
