import SwiftUI

/// "Konto löschen" in Mehr (two taps: the row, then the confirmation). How it is confirmed depends on the account:
/// the password; a fresh Sign in with Apple for Apple accounts without one; otherwise the 6-digit code from a mail.
struct AccountDeletionModifier: ViewModifier {
    @Environment(AppModel.self) private var app
    @Binding var isPresented: Bool
    /// from GET /api/cloud/me
    var hasPassword: Bool
    var appleLinked: Bool
    var onError: (String) -> Void
    var onDeleted: () -> Void
    @State private var password = ""
    @State private var code = ""
    @State private var askCode = false
    @State private var codeMessage = ""
    @State private var runner = AuthorizationRunner()
    @State private var busy = false

    func body(content: Content) -> some View {
        content
            .alert(L("Delete your account?"), isPresented: Binding(get: { isPresented && hasPassword }, set: { if !$0 { isPresented = false } })) {
                SecureField(L("Password"), text: $password)
                Button(L("Delete account for good"), role: .destructive) { Task { await run(["password": password]) } }
                Button(L("Cancel"), role: .cancel) { password = "" }
            } message: {
                Text(L("Households only you belong to are deleted with all their data. From shared households you just leave – the others keep everything. Confirm with your password. An active App Store subscription must be cancelled in your Apple Account settings."))
            }
            .confirmationDialog(L("Delete your account?"), isPresented: Binding(get: { isPresented && !hasPassword }, set: { if !$0 { isPresented = false } }), titleVisibility: .visible) {
                Button(appleLinked ? L("Confirm with Apple and delete") : L("Send me a code"), role: .destructive) {
                    Task { appleLinked ? await viaApple() : await run([:]) }
                }
                Button(L("Cancel"), role: .cancel) {}
            } message: {
                Text(appleLinked
                     ? L("Households only you belong to are deleted with all their data. From shared households you just leave – the others keep everything. Confirm with your Apple ID. An active App Store subscription must be cancelled in your Apple Account settings.")
                     : L("Households only you belong to are deleted with all their data. From shared households you just leave – the others keep everything. We send you a code by e-mail to confirm. An active App Store subscription must be cancelled in your Apple Account settings."))
            }
            .alert(L("Code from the e-mail"), isPresented: $askCode) {
                TextField(L("6-digit code"), text: $code).keyboardType(.numberPad).textContentType(.oneTimeCode)
                Button(L("Delete account for good"), role: .destructive) { Task { await run(["code": code.filter(\.isNumber)]) } }
                Button(L("Cancel"), role: .cancel) { code = "" }
            } message: {
                Text(codeMessage)
            }
    }

    private func viaApple() async {
        do {
            let (cred, nonce) = try await runner.appleReauth()
            var body: [String: String] = ["appleIdentityToken": cred.identityToken, "appleNonce": nonce]
            // Apple: revoke the user's tokens when the account goes – the server exchanges this fresh code and revokes it
            if let code = cred.authorizationCode { body["appleAuthorizationCode"] = code }
            await run(body)
        } catch {
            if !AuthorizationRunner.cancelled(error) { onError(APIError.from(error).localizedDescription) }
        }
    }

    private func run(_ body: [String: String]) async {
        busy = true
        defer { busy = false; password = "" }
        switch await app.deleteAccount(confirm: body) {
        case .deleted:
            onDeleted()
        case .needCode:
            code = ""
            codeMessage = L("We sent you an e-mail with a 6-digit code. Type it in to delete the account.")
            askCode = true
        case .failed(let m):
            onError(m)
        }
    }
}

extension View {
    func accountDeletion(isPresented: Binding<Bool>, hasPassword: Bool, appleLinked: Bool, onError: @escaping (String) -> Void, onDeleted: @escaping () -> Void) -> some View {
        modifier(AccountDeletionModifier(isPresented: isPresented, hasPassword: hasPassword, appleLinked: appleLinked, onError: onError, onDeleted: onDeleted))
    }
}
