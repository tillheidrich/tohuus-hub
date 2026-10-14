import SwiftUI
import UIKit
import UniformTypeIdentifiers

/// Settings › Data & backups › Backups – own server only, admins (web: DataSettings.tsx `Backups`, `Offsite`).
/// Nightly snapshots, "Back up now", download into Files, restore (from a snapshot or a file; the server restarts),
/// an off-site copy into a WebDAV folder. ToHuus Cloud answers 404 here and backs households up itself.
/// API: GET/POST /api/backups, GET /api/backups/:name/download, DELETE /api/backups/:name,
/// POST /api/backups/:name/restore {confirm:true}, POST /api/restore (multipart), PUT /api/backups/webdav,
/// POST /api/backups/webdav/test, GET /health.
struct BackupsView: View {
    let api: APIClient
    @State private var s: Status?
    @State private var error: String?
    @State private var busy = false
    @State private var all = false
    @State private var toast: ToastMessage?
    @State private var restore: RestoreTarget?
    @State private var pickingFile = false
    @State private var downloading: String?
    @State private var shared: SharedFile?
    @State private var confirmDelete: Item?
    @State private var restarting = false
    // off-site
    @State private var davURL = ""
    @State private var davUser = ""
    @State private var davPassword = ""

    struct Status: Decodable, Sendable {
        @Lossy var items: [Item]
        var totalSize: Double?
        var last: Item?
        var schedule: Schedule?
        var webdav: WebDAV?
        var offsiteLast: Offsite?
        var restorePending: Bool?
        var lastRestore: LastRestore?

        struct Schedule: Decodable, Sendable {
            var hour: Int?
            var keep: Keep?
            struct Keep: Decodable, Sendable { var daily: Int?; var weekly: Int? }
        }
        struct WebDAV: Decodable, Sendable { var url: String?; var user: String?; var password: String? }
        struct Offsite: Decodable, Sendable { var at: String?; var ok: Bool?; var error: String? }
        struct LastRestore: Decodable, Sendable { var source: String?; var by: String?; var appliedAt: String? }
    }

    struct Item: Decodable, Sendable, Identifiable, Hashable {
        var name: String
        var kind: String?
        var size: Double?
        var createdAt: String?
        var id: String { name }
    }

    enum RestoreTarget: Identifiable {
        case backup(Item)
        case file(URL)
        var id: String {
            switch self {
            case .backup(let b): return "b:" + b.name
            case .file(let u): return "f:" + u.absoluteString
            }
        }
        var title: String {
            switch self {
            case .backup(let b): return IxTime.when(b.createdAt)
            case .file(let u): return u.lastPathComponent
            }
        }
    }

    struct SharedFile: Identifiable {
        let id = UUID()
        let url: URL
    }

    private func kindLabel(_ k: String?) -> String {
        switch k {
        case "manual": return L("by hand")
        case "pre-restore": return L("before a restore")
        default: return L("nightly")
        }
    }

    var body: some View {
        List {
            if let s {
                statusSection(s)
                if let lr = s.lastRestore, let at = lr.appliedAt {
                    Section {
                        Text(LF("Restored on %@ from “%@”. The database it replaced is kept in the backups folder.", IxTime.when(at), lr.source ?? "?"))
                            .font(.footnote).foregroundStyle(Theme.ink3)
                    }
                }
                listSection(s)
                Section {
                    Button { pickingFile = true } label: { Label(L("Choose file"), systemImage: "square.and.arrow.down") }
                        .disabled(busy)
                } header: {
                    Text(L("Restore from a file"))
                } footer: {
                    Text(L("A backup file (.db) from here or another ToHuus Hub, or an export (.json). Everything currently stored is replaced – a safety backup is made first."))
                }
                offsiteSection(s)
            } else if let error {
                Section { ErrorBanner(message: error) { Task { await load() } } }
            } else {
                IxLoadingRow()
            }
        }
        .themedList()
        .navigationTitle(L("Backups"))
        .refreshable { await load() }
        .task { await load() }
        .toast($toast)
        .fileImporter(isPresented: $pickingFile, allowedContentTypes: [.json, .data, .database]) { result in
            if case .success(let url) = result { restore = .file(url) }
        }
        .sheet(item: $restore) { r in
            RestoreConfirmSheet(target: r) { await doRestore(r) } onCancel: { restore = nil }
        }
        .sheet(item: $shared) { f in ShareSheet(items: [f.url]) }
        .confirmationDialog(L("Delete this backup?"), isPresented: Binding(get: { confirmDelete != nil }, set: { if !$0 { confirmDelete = nil } }), titleVisibility: .visible) {
            Button(L("Delete"), role: .destructive) { if let b = confirmDelete { Task { await delete(b) } } }
        }
        .fullScreenCover(isPresented: $restarting) { RestartingView(api: api) { restarting = false; Task { await load() } } }
    }

    // MARK: sections

    @ViewBuilder private func statusSection(_ s: Status) -> some View {
        let fresh = (ServerDate.parse(s.last?.createdAt).map { Date().timeIntervalSince($0) < 36 * 3600 }) ?? false
        Section {
            Label {
                VStack(alignment: .leading, spacing: 4) {
                    Text(s.last.map { LF("Last backup: %@", IxTime.when($0.createdAt)) } ?? L("No backup yet")).font(.headline)
                    if let sch = s.schedule {
                        Text(LF("Automatically every night at %d:00. Keeps the last %d days and %d weeks.", sch.hour ?? 3, sch.keep?.daily ?? 7, sch.keep?.weekly ?? 4))
                            .font(.footnote).foregroundStyle(Theme.ink2)
                    }
                    if !(s.webdav?.url ?? "").isEmpty, let o = s.offsiteLast {
                        Text(o.ok == true ? LF("Off-site copy: %@", IxTime.when(o.at)) : LF("Off-site copy failed %@: %@", IxTime.when(o.at), o.error ?? ""))
                            .font(.footnote).foregroundStyle(o.ok == true ? Theme.primaryText : Theme.empty)
                    }
                }
            } icon: {
                Image(systemName: fresh ? "checkmark.circle.fill" : "exclamationmark.triangle.fill").foregroundStyle(fresh ? Theme.primaryText : Theme.warning)
            }
            Button { Task { await backupNow() } } label: {
                HStack { Label(busy ? L("Backing up …") : L("Back up now"), systemImage: "externaldrive.badge.plus"); if busy { Spacer(); ProgressView() } }
            }
            .disabled(busy)
        }
    }

    @ViewBuilder private func listSection(_ s: Status) -> some View {
        Section {
            if s.items.isEmpty {
                Text(L("The first backup is made tonight – or right now with “Back up now”.")).font(.footnote).foregroundStyle(Theme.ink3)
            }
            ForEach(all ? s.items : Array(s.items.prefix(5))) { b in
                HStack {
                    VStack(alignment: .leading, spacing: 2) {
                        Text(IxTime.when(b.createdAt))
                        Text("\(kindLabel(b.kind)) · \(IxTime.bytes(b.size))").font(.caption).foregroundStyle(Theme.ink3)
                    }
                    Spacer()
                    if downloading == b.name { ProgressView() }
                    Menu {
                        Button { Task { await download(b) } } label: { Label(L("Download"), systemImage: "arrow.down.doc") }
                        Button { restore = .backup(b) } label: { Label(L("Restore"), systemImage: "arrow.counterclockwise") }
                        Button(role: .destructive) { confirmDelete = b } label: { Label(L("Delete"), systemImage: "trash") }
                    } label: {
                        Image(systemName: "ellipsis.circle").frame(width: 44, height: 44)
                    }
                    .accessibilityLabel(LF("Actions for %@", IxTime.when(b.createdAt)))
                }
                .swipeActions {
                    Button { restore = .backup(b) } label: { Label(L("Restore"), systemImage: "arrow.counterclockwise") }.tint(Theme.warning)
                    Button { Task { await download(b) } } label: { Label(L("Download"), systemImage: "arrow.down.doc") }.tint(Theme.info)
                }
            }
            if s.items.count > 5 {
                Button(all ? L("Show fewer") : LF("Show all %d", s.items.count)) { all.toggle() }
            }
        } header: {
            HStack {
                Text(L("Backups"))
                Spacer()
                if !s.items.isEmpty { Text(LF("%d backups · %@", s.items.count, IxTime.bytes(s.totalSize))) }
            }
        }
    }

    @ViewBuilder private func offsiteSection(_ s: Status) -> some View {
        Section {
            TextField("https://cloud.example.de/remote.php/dav/files/…/Backups", text: $davURL)
                .keyboardType(.URL).textInputAutocapitalization(.never).autocorrectionDisabled().font(.callout.monospaced())
            TextField(L("User"), text: $davUser).textInputAutocapitalization(.never).autocorrectionDisabled()
            SecureField(L("App password"), text: $davPassword)
            Button(L("Save")) { Task { await saveDav(test: false) } }.disabled(busy)
            Button(L("Save & test")) { Task { await saveDav(test: true) } }.disabled(busy || davURL.isEmpty)
            if !(s.webdav?.url ?? "").isEmpty {
                Button(L("Turn off"), role: .destructive) {
                    davURL = ""; davUser = ""; davPassword = ""
                    Task { await saveDav(test: false) }
                }
            }
        } header: {
            Text(L("Off-site copy (optional)"))
        } footer: {
            Text(L("If the server breaks, backups on the same disk break with it. ToHuus Hub can put a copy into a WebDAV folder every night, e.g. Nextcloud. One file per weekday – the folder always holds the last seven nights.")
                 + " " + L("Use an app password (Nextcloud: Settings › Security), not your main password."))
        }
    }

    // MARK: actions

    private func load() async {
        do {
            let st = try await api.get("api/backups", as: Status.self)
            s = st
            davURL = st.webdav?.url ?? ""
            davUser = st.webdav?.user ?? ""
            davPassword = st.webdav?.password ?? ""
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func backupNow() async {
        busy = true
        defer { busy = false }
        do {
            let r = try await api.ixRawSend("POST", "api/backups", json: [:], timeout: 300)
            if let o = r["offsite"], !o.isNull, o["ok"]?.bool == false {
                toast = ToastMessage(text: LF("Backed up here, but the off-site copy failed: %@", o["error"]?.string ?? ""), isError: true)
            } else {
                toast = ToastMessage(text: r["offsite"]?["ok"]?.bool == true ? L("Backed up – also copied off-site") : L("Backed up"))
            }
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func path(_ b: Item) -> String {
        "api/backups/\(b.name.addingPercentEncoding(withAllowedCharacters: .urlPathAllowed.subtracting(CharacterSet(charactersIn: "/"))) ?? b.name)"
    }

    private func download(_ b: Item) async {
        downloading = b.name
        defer { downloading = nil }
        do {
            let data = try await api.ixDownload(path(b) + "/download", timeout: 600)
            shared = SharedFile(url: try IxFiles.temp(data, name: b.name))
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func delete(_ b: Item) async {
        confirmDelete = nil
        do {
            _ = try await api.ixRawSend("DELETE", path(b))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func doRestore(_ r: RestoreTarget) async {
        busy = true
        defer { busy = false }
        do {
            switch r {
            case .backup(let b):
                _ = try await api.ixRawSend("POST", path(b) + "/restore", json: ["confirm": true], timeout: 300)
            case .file(let url):
                let data = try IxFiles.read(url)
                var mp = Multipart()
                mp.addFile("file", filename: url.lastPathComponent, mimeType: "application/octet-stream", data: data)
                _ = try await api.ixUpload("api/restore", multipart: mp, timeout: 600)
            }
            restore = nil
            restarting = true
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func saveDav(test: Bool) async {
        busy = true
        defer { busy = false }
        do {
            _ = try await api.ixRawSend("PUT", "api/backups/webdav", json: ["url": davURL.trimmingCharacters(in: .whitespaces), "user": davUser, "password": davPassword])
            if test && !davURL.isEmpty {
                let r = try await api.ixRawSend("POST", "api/backups/webdav/test", json: [:], timeout: 60)
                toast = r["ok"]?.bool == true ? ToastMessage(text: L("Connection works")) : ToastMessage(text: r["error"]?.string ?? L("That didn't work."), isError: true)
            } else {
                toast = ToastMessage(text: L("Saved"))
            }
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}

/// "Restore this backup?" – what happens, then replace and restart.
struct RestoreConfirmSheet: View {
    let target: BackupsView.RestoreTarget
    let onConfirm: () async -> Void
    let onCancel: () -> Void
    @State private var busy = false

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    Text(target.title).font(.headline)
                    Text(L("Everything stored right now is replaced by this backup. Changes since then are lost – a safety backup of the current state is made first, so you can go back."))
                        .foregroundStyle(Theme.low)
                }
                Section {
                    Text("1. " + L("The file is checked."))
                    Text("2. " + L("ToHuus Hub restarts and swaps the database (a few seconds)."))
                    Text("3. " + L("The app reconnects by itself. You may need to sign in again."))
                }
                .font(.subheadline)
                Section {
                    Button(role: .destructive) { Task { busy = true; await onConfirm(); busy = false } } label: {
                        HStack { Label(busy ? L("Checking …") : L("Replace and restart"), systemImage: "arrow.counterclockwise"); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy)
                }
            }
            .themedList()
            .navigationTitle(L("Restore this backup?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Cancel"), action: onCancel).disabled(busy) } }
            .interactiveDismissDisabled(busy)
        }
        .presentationDetents([.medium, .large])
    }
}

/// While the server restarts with the restored database: waits for GET /health, then closes.
struct RestartingView: View {
    let api: APIClient
    let onDone: () -> Void
    @State private var slow = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        VStack(spacing: Theme.Space.s4) {
            if !reduceMotion { ProgressView().controlSize(.large) } else { Image(systemName: "hourglass").font(.largeTitle) }
            Text(L("Restoring …")).font(.title2.weight(.semibold))
            Text(L("ToHuus Hub is restarting with the backup. The app reconnects by itself."))
                .multilineTextAlignment(.center).foregroundStyle(Theme.ink2)
            if slow {
                Text(L("Taking longer than usual. If nothing happens, restart the container (e.g. “docker compose restart”)."))
                    .multilineTextAlignment(.center).foregroundStyle(Theme.low)
                Button(L("Close"), action: onDone)
            }
        }
        .padding(Theme.Space.s8)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(Theme.canvas.ignoresSafeArea())
        .task {
            let started = Date()
            var down = false
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                let ok = (try? await api.ixDownload("health", timeout: 5)) != nil
                if !ok { down = true }
                if ok && (down || Date().timeIntervalSince(started) > 6) {
                    Haptics.success()
                    onDone()
                    return
                }
                if Date().timeIntervalSince(started) > 45 { slow = true }
            }
        }
    }
}
