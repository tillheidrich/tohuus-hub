import SwiftUI

/// "Kind hinzufügen": a profile without a login – name, year of birth, allergies (web: People.tsx AddChildSheet).
/// The first allergy in a household needs a confirmation (health data, 409 health_consent).
struct AddChildSheet: View {
    let api: APIClient
    let onCreated: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var year = ""
    @State private var allergies = ""
    @State private var busy = false
    @State private var error: String?
    @State private var askConsent = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("Children never get a login. You rate dishes for them and choose their picture; kid mode uses the same profile."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                Section(L("Name")) {
                    TextField(L("e.g. Mika"), text: $name).textContentType(.givenName)
                }
                Section(L("Year of birth (optional)")) {
                    TextField("2021", text: $year)
                        .keyboardType(.numberPad)
                        .onChange(of: year) { _, v in
                            let d = String(v.filter(\.isNumber).prefix(4))
                            if d != v { year = d }
                        }
                }
                Section {
                    TextField(L("e.g. nuts, milk"), text: $allergies)
                } header: { Text(L("Allergies (optional)")) } footer: {
                    Text(L("Separate with commas. You can add likes and dislikes afterwards."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Add a child"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Add")) { Task { await create(consent: false) } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
            .alert(L("Save allergies?"), isPresented: $askConsent) {
                Button(L("Not now"), role: .cancel) {}
                Button(L("Save")) { Task { await create(consent: true) } }
            } message: {
                Text(L("Allergies are health data. ToHuus stores them encrypted in your household and only uses them for warnings on recipes. They only go to the assistant if you allow that in the settings."))
            }
        }
        .presentationDetents([.medium, .large])
    }

    private func create(consent: Bool) async {
        busy = true
        defer { busy = false }
        error = nil
        let list = allergies.split(separator: ",").map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
        do {
            let (r, key) = try await api.addChild(name: name.trimmingCharacters(in: .whitespaces), birthYear: Int(year),
                                                  color: PersonColors.all.randomElement() ?? PersonColors.all[0],
                                                  allergies: list, consent: consent)
            switch r {
            case .needsConsent: askConsent = true
            case .saved:
                Haptics.success()
                dismiss()
                onCreated(key)
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// "Dauergast hinzufügen": grandparents, a regular babysitter – sign in with a link, see only what you allow
/// (web: People.tsx AddGuestSheet).
struct AddGuestSheet: View {
    let api: APIClient
    let onCreated: (String?) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var email = ""
    @State private var level = "order"
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("For someone who is often here – grandparents, a regular babysitter. They sign in with a link (and later a passkey or PIN) and only see what you allow."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                }
                Section(L("Name")) {
                    TextField(L("e.g. Oma Inge"), text: $name).textContentType(.name)
                }
                Section {
                    TextField(L("name@example.org"), text: $email)
                        .keyboardType(.emailAddress).textInputAutocapitalization(.never).autocorrectionDisabled()
                } header: { Text(L("E-mail (optional)")) } footer: {
                    Text(L("For sign-in links. Without it, you hand over a link or QR code."))
                }
                Section {
                    LevelPickerRows(value: level) { level = $0 }
                } header: { Text(L("What they can see")) } footer: { Text(GuestLevels.alwaysHidden) }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Add a permanent guest"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Add")) { Task { await create() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty)
                }
            }
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        error = nil
        let e = email.trimmingCharacters(in: .whitespaces)
        do {
            let key = try await api.addPermanentGuest(name: name.trimmingCharacters(in: .whitespaces), email: e.isEmpty ? nil : e, level: level)
            Haptics.success()
            dismiss()
            onCreated(key)
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// "Stattdessen mit Passwort anlegen" – e.g. for a shared kitchen tablet (self-hosted only; the cloud invites).
/// Web: DataSettings.tsx AddWithPassword. POST /api/users.
struct AddWithPasswordSheet: View {
    let api: APIClient
    let onCreated: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var name = ""
    @State private var password = ""
    @State private var role = "member"
    @State private var busy = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(L("e.g. for a shared kitchen tablet")).font(.subheadline).foregroundStyle(Theme.ink2)
                }
                Section {
                    TextField(L("Name"), text: $name).textContentType(.name)
                    SecureField(L("Password (at least 8 characters)"), text: $password).textContentType(.newPassword)
                }
                Section {
                    Picker(L("Role"), selection: $role) {
                        Text(L("Member")).tag("member")
                        Text(L("Admin")).tag("admin")
                    }
                    .pickerStyle(.segmented)
                } footer: {
                    Text(role == "admin" ? L("Admins can also change settings, members and backups.") : L("Members can use everything day to day, but not change settings."))
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
            }
            .themedList()
            .navigationTitle(L("Add with a password instead"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { dismiss() } }
                ToolbarItem(placement: .confirmationAction) {
                    Button(L("Create")) { Task { await create() } }
                        .disabled(busy || name.trimmingCharacters(in: .whitespaces).isEmpty || password.count < 8)
                }
            }
        }
    }

    private func create() async {
        busy = true
        defer { busy = false }
        do {
            try await api.addMemberWithPassword(name: name.trimmingCharacters(in: .whitespaces), password: password, role: role, color: PersonColors.all[1])
            Haptics.success()
            dismiss()
            onCreated()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
