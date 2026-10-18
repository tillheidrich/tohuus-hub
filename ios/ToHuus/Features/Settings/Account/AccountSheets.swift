import SwiftUI
import UIKit

/// Change or set the password (POST /api/auth/me/password { current?, password }). Self-hosted: at least 8
/// characters, signs out the other browser sessions; ToHuus Cloud: at least 10, the account's password.
struct PasswordChangeSheet: View {
    let api: APIClient
    let hasPassword: Bool
    let minLength: Int
    /// for the password manager (username field)
    let accountName: String
    let onDone: (String) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var current = ""
    @State private var password = ""
    @State private var repeated = ""
    @State private var error: String?
    @State private var busy = false
    @FocusState private var focus: Field?

    enum Field { case current, new, again }

    private var valid: Bool {
        password.count >= minLength && password == repeated && (!hasPassword || !current.isEmpty)
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    // hidden username so iCloud Keychain saves the new password for the right account
                    TextField("", text: .constant(accountName)).textContentType(.username).frame(height: 0).opacity(0).accessibilityHidden(true)
                    if hasPassword {
                        SecureField(L("Current password"), text: $current)
                            .textContentType(.password).focused($focus, equals: .current)
                            .submitLabel(.next).onSubmit { focus = .new }
                    }
                    SecureField(LF("New password (at least %d characters)", minLength), text: $password)
                        .textContentType(.newPassword).focused($focus, equals: .new)
                        .submitLabel(.next).onSubmit { focus = .again }
                    SecureField(L("Repeat password"), text: $repeated)
                        .textContentType(.newPassword).focused($focus, equals: .again)
                        .submitLabel(.done).onSubmit { if valid { Task { await save() } } }
                } footer: {
                    if !repeated.isEmpty, repeated != password {
                        Text(L("The two passwords don’t match."))
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(hasPassword ? L("Change password") : L("Set a password"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button(L("Save")) { Task { await save() } }.disabled(!valid) }
                }
            }
            .onAppear { focus = hasPassword ? .current : .new }
        }
        .presentationDetents([.medium, .large])
    }

    private func save() async {
        busy = true
        defer { busy = false }
        var body: [String: Any] = ["password": password]
        if hasPassword { body["current"] = current }
        do {
            let r = try await api.send("POST", "api/auth/me/password", json: body, as: JSONValue.self)
            let n = r["signedOut"]?.int ?? 0
            onDone(n > 0 ? LF("Password changed. You were signed out everywhere else (%d devices and connections).", n) : L("Password changed."))
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// Two-step sign-in: scan the QR code (or open the authenticator app with the otpauth link), type the first code.
/// POST /api/auth/me/totp/enable { code } → { recoveryCodes }.
struct TotpSetupSheet: View {
    let api: APIClient
    let setup: TotpSetup
    let onEnabled: ([String]) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var code = ""
    @State private var error: String?
    @State private var busy = false
    @State private var copied = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("Scan the code with your authenticator app, then type the 6-digit code it shows."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                    if let img = QRCode.image(setup.uri) {
                        HStack {
                            Spacer()
                            Image(uiImage: img).interpolation(.none).resizable().scaledToFit()
                                .frame(maxWidth: 220).padding(Theme.Space.s3)
                                .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                                .accessibilityLabel(L("QR code for the authenticator app"))
                            Spacer()
                        }
                    }
                    if let u = URL(string: setup.uri) {
                        Link(destination: u) { Label(L("Open in an authenticator app on this iPhone"), systemImage: "key.viewfinder") }
                    }
                }
                Section {
                    HStack {
                        Text(grouped(setup.secret)).font(.body.monospaced()).textSelection(.enabled)
                        Spacer()
                        Button {
                            UIPasteboard.general.setItems([["public.utf8-plain-text": setup.secret]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)])
                            copied = true
                        } label: { Image(systemName: copied ? "checkmark" : "doc.on.doc") }
                            .buttonStyle(.borderless)
                            .accessibilityLabel(L("Copy"))
                    }
                } header: {
                    Text(L("Can’t scan? Enter the key by hand"))
                }
                Section {
                    TextField("123456", text: $code)
                        .keyboardType(.numberPad).textContentType(.oneTimeCode).font(.title3.monospaced())
                        .onChange(of: code) { _, v in
                            let d = String(v.filter(\.isNumber).prefix(6))
                            if d != v { code = d }
                        }
                } header: {
                    Text(L("Code from the app"))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Set up two-step sign-in"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    if busy { ProgressView() } else { Button(L("Turn on")) { Task { await enable() } }.disabled(code.count != 6) }
                }
            }
        }
    }

    private func grouped(_ s: String) -> String {
        var out = ""
        for (i, c) in s.enumerated() {
            if i > 0, i % 4 == 0 { out += " " }
            out.append(c)
        }
        return out
    }

    private func enable() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.send("POST", "api/auth/me/totp/enable", json: ["code": code], as: JSONValue.self)
            let codes = r["recoveryCodes"]?.array?.compactMap(\.string) ?? []
            onEnabled(codes)
            dismiss()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// The recovery codes, shown once after turning on two-step sign-in.
struct RecoveryCodesSheet: View {
    let codes: [String]
    @Environment(\.dismiss) private var dismiss
    @State private var copied = false

    var body: some View {
        NavigationStack {
            List {
                Section {
                    Text(L("Each code works once if your phone is gone. Keep them somewhere safe – they are shown only now."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                Section {
                    ForEach(codes, id: \.self) { c in
                        Text(c).font(.body.monospaced()).textSelection(.enabled)
                    }
                }
                Section {
                    Button {
                        UIPasteboard.general.setItems([["public.utf8-plain-text": codes.joined(separator: "\n")]], options: [.localOnly: true, .expirationDate: Date().addingTimeInterval(600)])
                        copied = true
                    } label: { Label(copied ? L("Copied") : L("Copy"), systemImage: copied ? "checkmark" : "doc.on.doc") }
                    ShareLink(item: codes.joined(separator: "\n")) { Label(L("Save or share"), systemImage: "square.and.arrow.up") }
                }
            }
            .themedList()
            .navigationTitle(L("Your recovery codes"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("I saved them")) { dismiss() } } }
        }
        .interactiveDismissDisabled()
    }
}
