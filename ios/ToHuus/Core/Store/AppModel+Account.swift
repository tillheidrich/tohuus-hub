import Foundation

/// Sign-in ways of the cloud-only app and sample data (package D, 1.0).
extension AppModel {
    /// The App Store app talks to ToHuus Cloud only. Debug builds may point it elsewhere (`-debugServer`).
    var cloudServer: URL {
        #if DEBUG
        if let raw = UserDefaults.standard.string(forKey: "debugServer"), let url = URL(string: raw) { return url }
        #endif
        return SharedConfig.cloudURL
    }

    /// Sign in with Apple: a new Apple ID gets an account and a household (then the sample-data question).
    func signInWithApple(_ cred: AppleCredential, nonce: String, betaCode: String? = nil, stores: [String]? = nil) async throws {
        let res = try await APIClient(baseURL: cloudServer).signInWithApple(
            identityToken: cred.identityToken, authorizationCode: cred.authorizationCode, nonce: nonce,
            name: cred.givenName, device: Self.deviceName, betaCode: betaCode, stores: stores)
        finishSignIn(server: cloudServer, mode: "cloud", response: res)
    }

    func signInWithCode(email: String, code: String) async throws {
        let res = try await APIClient(baseURL: cloudServer).signInWithCode(email: email, code: code, device: Self.deviceName)
        finishSignIn(server: cloudServer, mode: "cloud", response: res)
    }

    /// Passkey sign-in (account passkeys, RP-ID = the cloud host).
    func signInWithPasskey(runner: AuthorizationRunner) async throws {
        let api = APIClient(baseURL: cloudServer)
        let o = try await api.passkeyOptions()
        let rp = o.options.rpId ?? cloudServer.host() ?? SharedConfig.cloudURL.host() ?? ""
        let assertion = try await runner.passkey(rpId: rp, challenge: o.options.challenge)
        let res = try await api.passkeyVerify(key: o.key, device: Self.deviceName, response: assertion.json)
        finishSignIn(server: cloudServer, mode: "cloud", response: res)
    }

    // MARK: sample data

    /// Reads /api/tour; asks the sample-data question when the household has not answered it (admins).
    func refreshSamples(askIfDue: Bool = false) async {
        #if DEBUG
        // simulator check of the tags and the reminder against a server without the sample endpoints
        if UserDefaults.standard.bool(forKey: "debugSampleMarks") {
            tour = TourInfo(admin: true, demo: .init(rows: 1, products: 51, recipes: 8, since: nil, nudge: true), start: .init(choice: "demo", due: false))
            sampleMarks = DemoMarks(products: Array(0...3000), recipes: Array(0...3000), shopping: Array(0...3000))
            return
        }
        #endif
        guard isCloud || session != nil, let api else { return }
        guard let t = try? await api.tourInfo() else { return }
        tour = t
        if askIfDue, t.start?.due == true, t.admin == true { askSampleData = true }
        if (t.demo?.rows ?? 0) > 0, let m = try? await api.demoMarks() { sampleMarks = m } else { sampleMarks = DemoMarks() }
    }

    /// Answer the question: `true` loads the marked sample household.
    func answerSampleQuestion(_ demo: Bool) async throws {
        guard let api else { return }
        try await api.answerSampleQuestion(demo: demo)
        askSampleData = false
        await refreshSamples()
        store?.touch("*")
        await store?.refreshList()
    }

    /// "Beispieldaten entfernen": only the sample rows go; what the household added itself stays.
    @discardableResult
    func removeSampleData() async throws -> Int {
        guard let api else { return 0 }
        let r = try await api.removeSampleData()
        await refreshSamples()
        store?.touch("*")
        await store?.refreshList()
        return (r.kept?.products ?? 0) + (r.kept?.recipes ?? 0)
    }

    func keepSampleData() async {
        try? await api?.keepSampleData()
        await refreshSamples()
    }

    var hasSampleData: Bool { (tour?.demo?.rows ?? 0) > 0 }
    var isHouseholdAdmin: Bool { tour?.admin == true || activeHousehold?.role == "admin" }
}

// MARK: deleting the account (App Review 5.1.1(v))

enum AccountDeletionResult: Equatable {
    case deleted
    /// accounts without a password: a mail with a 6-digit code is on its way
    case needCode(String)
    case failed(String)
}

extension AppModel {
    /// DELETE /api/cloud/account with `password`, `appleIdentityToken` + `appleNonce`, or `code` (from the mail).
    func deleteAccount(confirm body: [String: String]) async -> AccountDeletionResult {
        guard let api else { return .failed(L("You have been signed out. Please sign in again.")) }
        do {
            let r = try await api.deleteAccountRaw(body)
            if (200..<300).contains(r.status) {
                signOut(message: L("Your account has been deleted."))
                return .deleted
            }
            let msg = r.body["error"]?.string ?? L("That didn't work. Please try again.")
            if r.body["needEmailConfirm"]?.bool == true { return .needCode(msg) }
            return .failed(msg)
        } catch {
            return .failed(APIError.from(error).localizedDescription)
        }
    }
}
