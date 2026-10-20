import SwiftUI

/// Settings › Data & reset (web: DataWipe.tsx, server: routes/wipe.ts, docs/data-and-reset.md):
/// remove the sample data, clear one area, clear everything but keep the household, delete my own private entries.
/// Every deletion can be undone for 10 seconds and restored for 7 days in "Deleted lately".
/// API: GET /api/data/wipe, POST /api/data/wipe, POST /api/data/wipe/:id/restore | /final.
struct DataWipeView: View {
    let api: APIClient
    @Environment(AppModel.self) private var app
    @State private var info: JSONValue?
    @State private var error: String?
    @State private var toast: ToastMessage?
    @State private var target: WipeTarget?
    @State private var busyId: Int?
    @State private var exportURL: URL?
    @State private var exporting = false

    static let areas = ["shopping", "stock", "money", "cooking", "tasks", "knowledge", "wishes", "house"]

    static func title(_ a: String) -> String {
        switch a {
        case "shopping": return L("Shopping")
        case "stock": return L("Pantry")
        case "money": return L("Money")
        case "cooking": return L("Cooking")
        case "tasks": return L("Tasks")
        case "knowledge": return L("Household knowledge")
        case "wishes": return L("Wishes & Bring me something")
        case "house": return L("House info")
        default: return L("Delete everything, keep the household")
        }
    }

    static func goes(_ a: String) -> String {
        switch a {
        case "shopping": return L("Shopping lists and their entries, where-to-buy notes on products, purchase rhythm and suggestions")
        case "stock": return L("Products, stock and its history, barcodes, receipt names, leftover boxes")
        case "money": return L("Receipts with their photos and PDFs, expenses, budgets, splits")
        case "cooking": return L("Recipes (or keep them), week plan, cooking history, votes")
        case "tasks": return L("Tasks and what was done")
        case "knowledge": return L("Everything in household knowledge")
        case "wishes": return L("Wish lists and wishes, Bring me something and orders")
        case "house": return L("House info cards, codes, photos and videos")
        default: return L("All areas above plus notifications, trips, assistant chats and the rest")
        }
    }

    static func stays(_ a: String) -> String? {
        switch a {
        case "stock": return L("Places stay unless you pick them.")
        case "cooking": return L("Ratings go with the recipes.")
        case "tasks": return L("Private tasks of the others stay theirs.")
        case "knowledge": return L("Private entries of the others stay theirs.")
        case "everything": return L("Members, plan, settings, sign-ins and connections stay. So do the private entries of the others.")
        default: return nil
        }
    }

    static func entries(_ n: Int) -> String { n == 1 ? L("1 entry") : LF("%d entries", n) }

    static func label(_ w: JSONValue) -> String {
        switch w["kind"]?.string {
        case "demo": return L("Sample data")
        case "mine": return L("My private entries")
        case "everything": return L("Everything")
        case "reset": return L("Start over")
        default: return (w["areas"]?.array ?? []).compactMap(\.string).map(title).joined(separator: ", ")
        }
    }

    private var admin: Bool { info?["admin"]?.bool == true }
    private var days: Int { info?["restoreDays"]?.int ?? 7 }

    var body: some View {
        Form {
            if let info {
                introSection
                if admin, let demo = info["demo"], (demo["rows"]?.int ?? 0) > 0 { demoSection(demo) }
                if admin, let n = info["areas"] {
                    areasSection(n)
                    everythingSection(n)
                }
                if let mine = info["mine"]?.int, mine > 0 { mineSection(mine) }
                if let history = info["history"]?.array, !history.isEmpty {
                    Section(L("Deleted lately")) {
                        ForEach(history.indices, id: \.self) { i in historyRow(history[i]) }
                    }
                }
            } else if let error {
                Section { Text(error).foregroundStyle(Theme.empty) }
            } else {
                Section { ProgressView() }
            }
        }
        .themedList()
        .navigationTitle(L("Data & reset"))
        .task { await load() }
        .refreshable { await load() }
        .toast($toast)
        .sheet(item: $target) { t in
            WipeSheet(api: api, target: t, info: info ?? .null) { id, text in
                target = nil
                guard let text else { return }
                Task { await afterChange() }
                var msg = ToastMessage(text: text)
                msg.seconds = 10
                if let id {
                    msg.actionTitle = L("Undo")
                    msg.action = { @MainActor in Task { await restore(id) } }
                }
                toast = msg
            }
        }
    }

    private var introText: String {
        admin
            ? LF("Clear single areas or everything and start again. What you delete can be restored for %d days – after that it is gone for good, photos and PDFs included.", days)
            : L("You can delete your own private entries here. Clearing whole areas is up to the admins.")
    }

    @ViewBuilder private var introSection: some View {
        Section {
            Text(introText).font(.subheadline).foregroundStyle(Theme.ink2)
            if admin { exportRow }
        }
    }

    @ViewBuilder private func demoSection(_ demo: JSONValue) -> some View {
        let p = demo["products"]?.int ?? 0
        let r = demo["recipes"]?.int ?? 0
        Section {
            Text(LF("%d sample products and %d sample recipes, with their stock, history and list entries. Removing them only deletes what the samples added – nothing you entered yourself.", p, r))
                .font(.footnote).foregroundStyle(Theme.ink2)
            Button { target = .demo } label: { Label(L("Remove sample data"), systemImage: "flask") }
        } header: {
            Text(L("Sample data is still here"))
        }
    }

    @ViewBuilder private func areaRow(_ a: String, _ count: Int) -> some View {
        let title = Self.title(a)
        let entries = Self.entries(count)
        Button { target = .area(a) } label: {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(title).foregroundStyle(Theme.ink)
                    Text(Self.goes(a)).font(.caption).foregroundStyle(Theme.ink3)
                    Text(entries).font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer()
                Text(L("Clear …")).font(.subheadline).foregroundStyle(count == 0 ? Theme.ink3 : Theme.empty)
            }
        }
        .disabled(count == 0)
        .accessibilityLabel(title + ", " + entries)
        .accessibilityHint(L("Clear …"))
    }

    @ViewBuilder private func areasSection(_ n: JSONValue) -> some View {
        Section {
            ForEach(Self.areas, id: \.self) { a in areaRow(a, n[a]?.int ?? 0) }
        } header: {
            Text(L("Clear an area"))
        }
    }

    @ViewBuilder private func everythingSection(_ n: JSONValue) -> some View {
        let count = n["everything"]?.int ?? 0
        let footer: String = Self.goes("everything") + " · " + Self.entries(count) + "\n" + (Self.stays("everything") ?? "")
        Section {
            Button(role: .destructive) { target = .everything } label: { Label(L("Delete everything …"), systemImage: "trash") }
                .disabled(count == 0)
        } header: {
            Text(L("Delete everything, keep the household"))
        } footer: {
            Text(footer)
        }
    }

    @ViewBuilder private func mineSection(_ mine: Int) -> some View {
        let footer: String = L("Your tasks “only for me”, private household knowledge, On my mind and private wish lists.") + " · " + Self.entries(mine)
        Section {
            Button(role: .destructive) { target = .mine } label: { Label(L("Delete my private entries …"), systemImage: "person.crop.circle.badge.minus") }
        } header: {
            Text(L("My private entries"))
        } footer: {
            Text(footer)
        }
    }

    @ViewBuilder private var exportRow: some View {
        if let exportURL {
            ShareLink(item: exportURL) { Label(L("Save or share the export"), systemImage: "square.and.arrow.up") }
        } else {
            Button { Task { await export() } } label: {
                HStack { Label(exporting ? L("Preparing …") : L("Download an export first"), systemImage: "arrow.down.doc"); if exporting { Spacer(); ProgressView() } }
            }
            .disabled(exporting)
        }
    }

    @ViewBuilder private func historyRow(_ w: JSONValue) -> some View {
        let id = w["id"]?.int ?? 0
        let may = w["kind"]?.string == "mine" ? w["mine"]?.bool == true : admin
        VStack(alignment: .leading, spacing: 4) {
            Text(Self.label(w) + " · " + Self.entries(w["total"]?.int ?? 0))
            Text(detail(w)).font(.caption).foregroundStyle(Theme.ink3)
            if w["restorable"]?.bool == true && may {
                HStack(spacing: Theme.Space.s3) {
                    Button { Task { await restore(id) } } label: { Label(L("Restore"), systemImage: "arrow.uturn.backward") }
                        .buttonStyle(.bordered)
                    Button(L("Delete for good")) { Task { await final(id) } }
                        .buttonStyle(.borderless).foregroundStyle(Theme.empty)
                }
                .disabled(busyId == id)
                .padding(.top, 2)
            }
        }
        .padding(.vertical, 2)
    }

    private func detail(_ w: JSONValue) -> String {
        var parts: [String] = []
        if let at = ServerDate.parse(w["at"]?.string) { parts.append(at.formatted(date: .abbreviated, time: .shortened)) }
        parts.append(w["by"]?.string ?? "–")
        if w["restoredAt"]?.string != nil { parts.append(LF("restored by %@", w["restoredBy"]?.string ?? "–")) }
        if w["final"]?.bool == true { parts.append(L("deleted for good")) }
        if w["restorable"]?.bool == true, let until = ServerDate.parse(w["expiresAt"]?.string) {
            parts.append(LF("restorable until %@", until.formatted(date: .abbreviated, time: .omitted)))
        }
        if w["restorable"]?.bool == true, let b = w["bytes"]?.int, b > 0 {
            parts.append(LF("%@ of photos and files kept until then", ByteCountFormatter.string(fromByteCount: Int64(b), countStyle: .file)))
        }
        return parts.joined(separator: " · ")
    }

    private func load() async {
        do {
            info = try await api.ixRaw("api/data/wipe")
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func afterChange() async {
        await load()
        await app.refreshSamples()
        app.store?.touch("*")
        await app.store?.refreshList()
    }

    private func restore(_ id: Int) async {
        busyId = id
        defer { busyId = nil }
        do {
            _ = try await api.ixRawSend("POST", "api/data/wipe/\(id)/restore", timeout: 120)
            Haptics.success()
            toast = ToastMessage(text: L("Restored"))
            await afterChange()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }

    private func final(_ id: Int) async {
        busyId = id
        defer { busyId = nil }
        do {
            _ = try await api.ixRawSend("POST", "api/data/wipe/\(id)/final")
            toast = ToastMessage(text: L("Deleted for good"))
            await load()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
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
}

enum WipeTarget: Identifiable, Hashable {
    case area(String), everything, demo, mine
    var id: String {
        switch self {
        case .area(let a): return a
        case .everything: return "everything"
        case .demo: return "demo"
        case .mine: return "mine"
        }
    }
}

/// What goes, what stays, options, the confirmation word for money and everything; then delete.
private struct WipeSheet: View {
    let api: APIClient
    let target: WipeTarget
    let info: JSONValue
    /// (wipe id, toast text) – text nil = cancelled
    let onDone: (Int?, String?) -> Void
    @State private var keepPlaces = true
    @State private var keepRecipes = false
    @State private var includeUsed = false
    @State private var word = ""
    @State private var busy = false
    @State private var error: String?

    private var area: String {
        switch target {
        case .area(let a): return a
        case .everything: return "everything"
        case .demo: return "demo"
        case .mine: return "mine"
        }
    }
    private var strong: Bool { area == "everything" || area == "money" }
    private var confirmWord: String { info["confirmWord"]?.string ?? L("DELETE") }
    private var wordOk: Bool { !strong || [confirmWord, "DELETE"].map { $0.uppercased() }.contains(word.trimmingCharacters(in: .whitespaces).uppercased()) }
    private var days: Int { info["restoreDays"]?.int ?? 7 }
    private var title: String {
        switch target {
        case .demo: return L("Remove sample data")
        case .mine: return L("Delete my private entries?")
        case .everything: return L("Delete everything?")
        case .area(let a): return LF("Clear %@?", DataWipeView.title(a))
        }
    }

    var body: some View {
        NavigationStack {
            Form {
                Section {
                    switch target {
                    case .demo:
                        Text(L("Members, places, settings and everything you added yourself stay."))
                    case .mine:
                        Text(LF("Only yours – nobody else sees them, and nothing of the household goes. You can restore them here for %d days.", days))
                    default:
                        Text(DataWipeView.goes(area))
                        if let s = DataWipeView.stays(area) { Text(s).font(.footnote).foregroundStyle(Theme.ink3) }
                        if area != "everything" { Text(L("Other areas, members, plan and settings stay.")).font(.footnote).foregroundStyle(Theme.ink3) }
                    }
                } header: {
                    if area != "mine" && area != "demo" { Text(L("What goes")) }
                }
                if area == "stock" || area == "everything" {
                    Section {
                        Toggle(isOn: $keepPlaces) { Text(L("Keep places and categories")) }.tint(Theme.primary)
                    } footer: {
                        Text(L("Off: back to the default categories, your places go and printed place labels stop working."))
                    }
                }
                if area == "cooking" {
                    Section {
                        Toggle(isOn: $keepRecipes) { Text(L("Keep recipes")) }.tint(Theme.primary)
                    } footer: {
                        Text(L("Only the week plan and the cooking history go."))
                    }
                }
                if case .demo = target, let used = info["demo"]?["used"], (used["products"]?.int ?? 0) + (used["recipes"]?.int ?? 0) > 0 {
                    Section {
                        Toggle(isOn: $includeUsed) { Text(L("Also remove sample things you have used")) }.tint(Theme.empty)
                    } footer: {
                        Text(LF("%d sample products or recipes were used since (stock changed, cooked or planned). By default they stay, because they are probably yours now.", (used["products"]?.int ?? 0) + (used["recipes"]?.int ?? 0)))
                    }
                }
                Section {
                    Text(LF("You can undo it for 10 seconds, and restore it here for %d days. Want a copy for yourself?", days))
                        .font(.footnote).foregroundStyle(Theme.ink2)
                }
                if strong {
                    Section {
                        TextField(confirmWord, text: $word).textInputAutocapitalization(.characters).autocorrectionDisabled()
                    } header: {
                        Text(LF("Type %@ to confirm.", confirmWord))
                    }
                }
                if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
                Section {
                    Button(role: .destructive) { Task { await run() } } label: {
                        HStack { Text(busy ? L("Deleting …") : (area == "demo" ? L("Remove sample data") : L("Delete now"))).bold(); if busy { Spacer(); ProgressView() } }
                    }
                    .disabled(busy || !wordOk)
                }
            }
            .themedList()
            .navigationTitle(title)
            .navigationBarTitleDisplayMode(.inline)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) { Button(L("Cancel")) { onDone(nil, nil) }.disabled(busy) }
            }
            .interactiveDismissDisabled(busy)
        }
        .presentationDetents([.medium, .large])
    }

    private func run() async {
        busy = true
        defer { busy = false }
        var body: [String: Any]
        switch target {
        case .demo: body = ["target": "demo", "includeUsed": includeUsed]
        case .mine: body = ["target": "mine"]
        case .everything: body = ["target": "everything", "keepPlaces": keepPlaces, "confirm": word.trimmingCharacters(in: .whitespaces)]
        case .area(let a):
            body = ["target": "areas", "areas": [a], "keepPlaces": keepPlaces, "keepRecipes": keepRecipes]
            if strong { body["confirm"] = word.trimmingCharacters(in: .whitespaces) }
        }
        do {
            let r = try await api.ixRawSend("POST", "api/data/wipe", json: body, timeout: 180)
            Haptics.success()
            let id = r["wipe"]?["id"]?.int
            if case .demo = target {
                let kept = (r["kept"]?["products"]?.int ?? 0) + (r["kept"]?["recipes"]?.int ?? 0)
                onDone(id, kept > 0 ? LF("Sample data removed – %d things you used stay", kept) : L("Sample data removed"))
            } else {
                onDone(id, LF("%d entries deleted", r["wipe"]?["total"]?.int ?? 0))
            }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
