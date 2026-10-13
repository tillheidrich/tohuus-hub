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
    /// set by deep links (tohuus://shopping from the widget)
    var requestedTab: String?
    /// iPad kitchen mode (big week plan, recipe step by step, list to tick)
    var showKitchen = false
    /// a notification or the store-arrival hint asks for the list of one shop (shop mode)
    var requestedStore: Int?
    /// ⌘N: focus the "what's missing" field on the list
    private(set) var addRequest = 0
    /// ⌘F: search (pantry, or recipes while cooking)
    private(set) var searchRequest = 0

    // MARK: sample data (package D, 1.0)

    /// a new household is asked once: "Möchtest du Beispieldaten, um ToHuus kennenzulernen?"
    var askSampleData = false
    /// GET /api/tour (sample rows, the question, the reminder on Today)
    var tour: TourInfo?
    /// ids of sample rows – tagged quietly with "Beispiel"
    var sampleMarks = DemoMarks()

    /// set until the screen that handles the shortcut has seen it (it may only appear after the area switch)
    var addPending = false
    var searchPending = false

    func requestAdd() { addPending = true; addRequest += 1 }
    func requestSearch() { searchPending = true; searchRequest += 1 }

    private static let householdsKey = "session.households"
    private static let userKey = "session.user"

    // MARK: AI switch

    private(set) var aiStatus: AIStatus?
    private(set) var isChild = false
    private static let personalAIKey = "ai.personal"
    /// this member's own switch (server when it knows one, else kept on this device)
    private(set) var personalAI: Bool = SharedConfig.defaults.object(forKey: "ai.personal") as? Bool ?? true

    /// AI switched off for this person by someone else (parents) – shown locked, not changeable here
    var aiLocked: Bool { aiStatus?.locked == true || aiStatus?.reason == "parents" }
    /// the household has a model and its AI switch is on (whatever this person chose)
    var aiAvailable: Bool {
        (instance?.assistantEnabled ?? true) && aiStatus?.reason != "no_model" && aiStatus?.reason != "household" && (aiStatus?.household ?? true)
    }
    /// effective for this person (the server's `ai`), falling back to the switches when the server is older
    var aiOn: Bool { aiStatus?.ai ?? (aiAvailable && personalAI && !aiLocked) }
    var receiptAIOn: Bool { aiOn && (aiStatus?.receiptsAi ?? instance?.features?.receiptsAi?.bool ?? false) }
    var voiceAIOn: Bool { aiOn && (aiStatus?.voice ?? instance?.voiceEnabled ?? false) }

    /// "Was nutzen wir?" – switched-off areas disappear (GET /api/me → modules). The list always stays.
    private(set) var modules: [String: Bool] = [:]
    func moduleOn(_ key: String) -> Bool { modules[key] ?? true }
    /// a household of one: "Bring mir was" (asking someone at home) is hidden, like on the web
    private(set) var singleHousehold = false
    /// a permanent guest (Mehr shows the handover shared with them instead of trips and care)
    private(set) var isGuest = false

    func loadAIState() async {
        guard let api else { return }
        if let me = try? await api.me() {
            isChild = me.isChild
            if let m = me.modules { modules = m }
            singleHousehold = me.isSingleHousehold
            isGuest = me.isGuest
            if let p = me.listPrefs { ListPrefsSync.adopt(p) }
        }
        if let s: AIStatus = try? await api.get("api/assistant/status") {
            aiStatus = s
            if let p = s.personal { personalAI = p; SharedConfig.defaults.set(p, forKey: Self.personalAIKey) }
        }
    }

    /// PATCH /api/ai/settings { mine } – a server without it keeps the choice on this device only.
    func setPersonalAI(_ on: Bool) async {
        personalAI = on
        SharedConfig.defaults.set(on, forKey: Self.personalAIKey)
        guard let api else { return }
        _ = try? await api.send("PATCH", "api/ai/settings", json: ["mine": on], as: Ignored.self)
        await loadAIState()
    }

    var isCloud: Bool { session?.isCloud ?? false }
    /// purchases only exist in ToHuus Cloud; a self-hosted server has everything unlocked
    var purchasesAvailable: Bool { isCloud && (instance?.billingApple ?? true) }
    var activeHousehold: HouseholdRef? { households.first { $0.id.value == session?.householdId } ?? households.first }
    var api: APIClient? { store?.api }

    // MARK: launch

    func restore() async {
        #if DEBUG
        // simulator checks: -debugServer http://localhost:8099 -debugToken sw_app_… [-debugHousehold <uuid>]
        let d = UserDefaults.standard
        if let server = d.string(forKey: "debugServer").flatMap(URL.init(string:)), let token = d.string(forKey: "debugToken") {
            SessionInfo(serverURL: server, mode: "cloud", householdId: d.string(forKey: "debugHousehold"), deviceName: Self.deviceName).save()
            SessionInfo.token = token
        }
        if d.bool(forKey: "debugSignedOut") { SessionInfo.clear() }
        #endif
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
        #if DEBUG
        requestedTab = UserDefaults.standard.string(forKey: "debugTab")
        if UserDefaults.standard.bool(forKey: "debugAssistant") { showAssistant = true }
        if UserDefaults.standard.bool(forKey: "debugSampleQuestion") { askSampleData = true }
        #endif
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

    func signUp(server: URL = SharedConfig.cloudURL, email: String, password: String, name: String, householdName: String,
                form: String, betaCode: String? = nil, stores: [String]? = nil) async throws {
        let res = try await APIClient(baseURL: server).signUp(email: email, password: password, name: name,
                                                              householdName: householdName, form: form, device: Self.deviceName,
                                                              betaCode: betaCode, stores: stores)
        finishSignIn(server: server, mode: "cloud", response: res)
        if res.userName == nil { userName = name }
        askSampleData = true
    }

    func finishSignIn(server: URL, mode: String, response: AppAuthResponse) {
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
        // Sign in with Apple created a new household: ask about sample data right away
        if response.created == true { askSampleData = true }
        Task { await refreshBilling() }
    }

    private func saveHouseholds() {
        if let data = try? JSONEncoder().encode(households) { SharedConfig.defaults.set(data, forKey: Self.householdsKey) }
    }

    private func open(session s: SessionInfo, token: String) {
        WatchHost.app = self
        store?.stopEvents()
        let api = APIClient(baseURL: s.serverURL, token: token, householdId: s.householdId) { [weak self] in
            Task { @MainActor in self?.handleUnauthorized() }
        }
        let st = ServerStore(api: api, householdKey: s.householdId ?? s.serverURL.host() ?? "default")
        st.householdName = activeHousehold?.name
        store = st
        st.startEvents()
        Task {
            await st.refreshList()
            await st.flush()
            await st.drainUploadQueue(session: s)
            await PhoneWatchBridge.shared.handOverSession(api: api)
            await PushManager.shared.sendToken()
            await loadAIState()
            await refreshSamples(askIfDue: true)
        }
    }

    // MARK: watch

    /// The watch got paired, installed the app or finished activating: send the session and the list.
    func watchBecameAvailable() {
        guard phase == .signedIn, let store else { return }
        PhoneWatchBridge.shared.publish(list: store.list, nextDue: store.nextDue, household: activeHousehold?.name)
        Task { await PhoneWatchBridge.shared.handOverSession(api: store.api) }
    }

    func receiveWatchOps(_ ops: [PendingOp]) async {
        await store?.enqueueRemote(ops)
    }

    /// A notification button (here, on the watch or from a background launch): POST /api/push/action.
    @discardableResult
    func runNotificationAction(_ action: String, data: [String: String]) async -> String? {
        guard let api else { return nil }
        do {
            let r = try await api.send("POST", "api/push/action", json: NotifyKit.actionBody(action, data: data), as: JSONValue.self)
            store?.touch("shopping", "stock")
            await store?.refreshList()
            return r["summary"]?.string
        } catch {
            return APIError.from(error).localizedDescription
        }
    }

    func switchHousehold(_ h: HouseholdRef) {
        guard var s = session, let token = SessionInfo.token, s.householdId != h.id.value else { return }
        s.householdId = h.id.value
        s.save()
        PhoneWatchBridge.shared.forgetWatchToken()
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
        if userName == nil, let me = try? await api.me(), let n = me.name {
            userName = n
            SharedConfig.defaults.set(n, forKey: Self.userKey)
        }
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
        PhoneWatchBridge.shared.signOut()
        if let api { Task { await PushManager.shared.forget(api: api) } }
        store?.stopEvents()
        store = nil
        SessionInfo.clear()
        SharedConfig.defaults.removeObject(forKey: Self.householdsKey)
        SharedConfig.defaults.removeObject(forKey: Self.userKey)
        ShoppingCache.wipeAll()
        WidgetSnapshot.clear()
        session = nil
        households = []
        billing = nil
        userName = nil
        tour = nil
        sampleMarks = DemoMarks()
        askSampleData = false
        notice = message
        phase = .start
    }

    /// App Review 5.1.1(v): delete the cloud account from inside the app.
    func deleteAccount(password: String) async throws {
        guard let api else { return }
        try await api.deleteCloudAccount(password: password)
        signOut(message: L("Your account has been deleted."))
    }
}
