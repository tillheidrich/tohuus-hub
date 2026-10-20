import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Settings › Data & backups (web: Settings.tsx `Data`, MoveSettings.tsx, DataWipe.tsx, Billing.tsx "Your data"):
/// full export into Files, purchase history CSV, "import without asking", moving a household between your own server
/// and ToHuus Cloud, backups (own server, BackupsView) and Data & reset (DataWipeView, 7-day restore).
/// API: GET /api/export.json | /api/cloud/export, POST /api/imports/catalog-csv, PATCH /api/settings {importAutoApply},
/// GET /api/move/info, GET /api/move/file, GET/POST /api/cloud/import, GET/POST /api/data/wipe (DataWipeView).
struct DataSettingsView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var autoApply: Bool?
    @State private var exportURL: URL?
    @State private var exporting = false
    @State private var importingCSV = false
    @State private var csvBusy = false
    @State private var moveJob: JSONValue?
    @State private var toast: ToastMessage?

    private var admin: Bool { app.isAdmin }

    var body: some View {
        Form {
            if app.isCloud {
                MoveInSection(api: api, admin: admin, job: $moveJob) { toast = $0 }
            } else if admin {
                MoveOutSection(api: api) { toast = $0 }
            }

            Section {
                if admin {
                    if let exportURL {
                        ShareLink(item: exportURL) { Label(L("Save or share the export"), systemImage: "square.and.arrow.up") }
                        Button(L("Make a new export")) { self.exportURL = nil }
                    } else {
                        Button { Task { await export() } } label: {
                            HStack { Label(exporting ? L("Preparing …") : L("Download export"), systemImage: "arrow.down.doc"); if exporting { Spacer(); ProgressView() } }
                        }
                        .disabled(exporting)
                    }
                } else {
                    Text(L("An admin of the household can export its data.")).foregroundStyle(Theme.ink3)
                }
            } header: {
                Text(L("Export"))
            } footer: {
                Text(app.isCloud
                     ? L("Download everything ToHuus has stored for your household – lists, products, recipes, receipts – as a file.")
                     : L("Everything as JSON – your data belongs to you. Passwords and access keys are never included."))
            }

            if app.isCloud {
                Section {
                    Label(L("Backups: ToHuus Cloud saves your household every night, encrypted, also outside the data centre. You can download everything at any time under Plan & storage › Your data."), systemImage: "checkmark.shield")
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
            } else if admin {
                Section {
                    NavigationLink { BackupsView(api: api) } label: { Label(L("Backups"), systemImage: "externaldrive") }
                } footer: {
                    Text(L("Snapshots of this server, restore, and an off-site copy."))
                }
            }

            Section {
                if let autoApply {
                    Toggle(isOn: Binding(get: { autoApply }, set: { v in Task { await setAutoApply(v) } })) {
                        VStack(alignment: .leading, spacing: 2) {
                            Text(L("Import without asking"))
                            Text(L("Book receipts straight in when everything was recognised with confidence. Substitutes and new items are still shown for review."))
                                .font(.footnote).foregroundStyle(Theme.ink3)
                        }
                    }
                    .tint(Theme.primary)
                    .disabled(!admin)
                }
                Button { importingCSV = true } label: {
                    HStack { Label(csvBusy ? L("Importing …") : L("Choose CSV"), systemImage: "tablecells"); if csvBusy { Spacer(); ProgressView() } }
                }
                .disabled(!admin || csvBusy)
            } header: {
                Text(L("Import purchase history (CSV)"))
            } footer: {
                Text(L("For example from the REWE data export (GDPR request): items you’ve bought at least three times are created as products – including the receipt abbreviations, so future e-receipts are recognised right away. No stock is booked."))
            }

            Section {
                NavigationLink { DataWipeView(api: api) } label: { Label(L("Data & reset"), systemImage: "arrow.counterclockwise") }
            } footer: {
                Text(admin
                     ? L("Remove the sample data, clear single areas or everything – restorable for 7 days.")
                     : L("Delete your own private entries."))
            }

            Section {
                Text(L("ToHuus Hub is open source (AGPL-3.0). Some product data and images from Open Food Facts (ODbL / CC BY-SA). Not affiliated with REWE, Thermomix/Vorwerk or HelloFresh."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
            }
        }
        .themedList()
        .navigationTitle(L("Data & backups"))
        .task {
            if let s = try? await api.ixRaw("api/settings") { autoApply = s["importAutoApply"]?.bool ?? false }
            if app.isCloud && admin { moveJob = try? await api.ixRaw("api/cloud/import") }
        }
        .toast($toast)
        .fileImporter(isPresented: $importingCSV, allowedContentTypes: [.commaSeparatedText, .plainText]) { result in
            if case .success(let url) = result { Task { await importCSV(url) } }
        }
    }

    private func export() async {
        exporting = true
        defer { exporting = false }
        do {
            let data = try await api.ixDownload(app.isCloud ? "api/cloud/export" : "api/export.json")
            exportURL = try IxFiles.temp(data, name: "tohuus-export-\(IxFiles.today).json")
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func setAutoApply(_ v: Bool) async {
        autoApply = v
        do { _ = try await api.ixRawSend("PATCH", "api/settings", json: ["importAutoApply": v]) } catch {
            autoApply = !v
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func importCSV(_ url: URL) async {
        csvBusy = true
        defer { csvBusy = false }
        do {
            let data = try IxFiles.read(url)
            var mp = Multipart()
            mp.addFile("file", filename: url.lastPathComponent, mimeType: "text/csv", data: data)
            mp.addField("min_count", "3")
            let r = try await api.ixUpload("api/imports/catalog-csv", multipart: mp)
            var text = LF("%d products created, %d linked (from %d items)", r["created"]?.int ?? 0, r["linked"]?.int ?? 0, r["distinct"]?.int ?? 0)
            if let n = r["history"]?["receipts"]?.int, n > 0 { text += " " + LF("%d shopping days with prices taken over – ToHuus now knows your rhythm.", n) }
            toast = ToastMessage(text: text)
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// Own server → ToHuus Cloud: one file with everything of the household (web: MoveOutCard).
struct MoveOutSection: View {
    let api: APIClient
    let onToast: (ToastMessage) -> Void
    @State private var sensitive = false
    @State private var secrets = false
    @State private var file: URL?
    @State private var busy = false

    var body: some View {
        Section {
            if sensitive {
                Toggle(L("Take the codes from the house info along (door, alarm, Wi-Fi)"), isOn: $secrets)
                    .tint(Theme.primary)
                    .onChange(of: secrets) { _, _ in file = nil }
            }
            if let file {
                ShareLink(item: file) { Label(L("Save or share the move file"), systemImage: "square.and.arrow.up") }
            } else {
                Button { Task { await build() } } label: {
                    HStack { Label(busy ? L("Preparing …") : L("Download move file"), systemImage: "shippingbox"); if busy { Spacer(); ProgressView() } }
                }
                .disabled(busy)
            }
        } header: {
            Text(L("Move to ToHuus Cloud"))
        } footer: {
            Text(L("One file with everything of your household – list, stock, recipes, receipts, photos. Create a new household in ToHuus Cloud and import the file there. Sign-ins, devices, tokens and links stay here; conversations with the assistant and what others marked “only for me” as well."))
        }
        .task {
            if let info = try? await api.ixRaw("api/move/info") {
                sensitive = (info["parts"]?.array ?? []).contains { $0["sensitive"]?.bool == true }
            }
        }
    }

    private func build() async {
        busy = true
        defer { busy = false }
        do {
            let data = try await api.ixDownload("api/move/file", query: [URLQueryItem(name: "secrets", value: secrets ? "1" : "0")], timeout: 600)
            file = try IxFiles.temp(data, name: "tohuus-umzug-\(IxFiles.today).zip")
        } catch {
            onToast(ToastMessage(text: APIError.from(error).localizedDescription, isError: true))
        }
    }
}

/// ToHuus Cloud: import a move file into this new, empty household (web: MoveInCard).
struct MoveInSection: View {
    let api: APIClient
    let admin: Bool
    @Binding var job: JSONValue?
    let onToast: (ToastMessage) -> Void
    @State private var password = ""
    @State private var picking = false
    @State private var busy = false

    var body: some View {
        if admin, let job, !(job["state"]?.string == "idle" && job["empty"]?.bool == false) {
            Section {
                let state = job["state"]?.string ?? "idle"
                if state == "done", let s = job["summary"], !s.isNull {
                    Text(LF("Done: %d entries, %d photos, %d receipt files. %d people without a sign-in yet – invite them under Members.",
                            s["rows"]?.int ?? 0, s["images"]?.int ?? 0, s["files"]?.int ?? 0, s["people"]?["created"]?.int ?? 0))
                } else if state == "running" {
                    VStack(alignment: .leading) {
                        Text(LF("Moving in … %d %%", Int((job["progress"]?.double ?? 0) * 100)))
                        ProgressView(value: job["progress"]?.double ?? 0).tint(Theme.primary)
                    }
                    .task { await poll() }
                } else {
                    Text(L("On your own server: Settings › Data › Move to ToHuus Cloud. Then choose the file here. This works in a new, empty household."))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                    if state == "failed", let e = job["error"]?.string { Text(e).foregroundStyle(Theme.empty) }
                    SecureField(L("Your password"), text: $password).textContentType(.password)
                    Button { picking = true } label: {
                        HStack { Label(L("Choose move file"), systemImage: "square.and.arrow.down"); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy || password.isEmpty)
                }
            } header: {
                Text(L("Bring a household from your own server"))
            }
            .fileImporter(isPresented: $picking, allowedContentTypes: [.zip]) { result in
                if case .success(let url) = result { Task { await start(url) } }
            }
        }
    }

    private func start(_ url: URL) async {
        busy = true
        defer { busy = false }
        do {
            let data = try IxFiles.read(url)
            var mp = Multipart()
            mp.addFile("file", filename: url.lastPathComponent, mimeType: "application/zip", data: data)
            mp.addField("password", password)
            job = try await api.ixUpload("api/cloud/import", multipart: mp, timeout: 600)
            password = ""
        } catch {
            onToast(ToastMessage(text: APIError.from(error).localizedDescription, isError: true))
        }
    }

    private func poll() async {
        while !Task.isCancelled {
            try? await Task.sleep(nanoseconds: 1_500_000_000)
            guard let j = try? await api.ixRaw("api/cloud/import") else { continue }
            job = j
            if j["state"]?.string != "running" {
                if j["state"]?.string == "done" { Haptics.success() }
                return
            }
        }
    }
}
