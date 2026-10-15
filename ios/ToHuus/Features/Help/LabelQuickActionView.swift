import SwiftUI

/// What a scanned ToHuus QR label offers (web: pages/QuickAction.tsx, /q/<code>): a product ("Took one", "Opened",
/// "Add to list", "Where is it kept?"), a place (what is in there) or a care task ("Done"). Leftover boxes (8-character
/// codes) go to the box view. Server: GET /api/qr/:code, POST /api/qr/:code/action { take | opened | list | done }.
struct LabelQuickActionView: View {
    /// the scanned text: a code or a URL ".../q/<code>"
    let raw: String
    let store: ServerStore
    var openProduct: ((Int) -> Void)?
    @Environment(\.dismiss) private var dismiss
    @State private var data: JSONValue?
    @State private var error: String?
    @State private var busy: String?
    @State private var showWhere = false
    @State private var toast: ToastMessage?

    private var code: String { LabelCode.extract(raw) }

    var body: some View {
        NavigationStack {
            Group {
                if LabelCode.isBox(code) {
                    BoxDetail(code: code, store: store)
                } else if let d = data {
                    content(d)
                } else if let error {
                    EmptyStateView(systemImage: "qrcode", title: error, message: L("Print a new label under More → QR labels."))
                } else {
                    ProgressView().frame(maxWidth: .infinity, maxHeight: .infinity)
                }
            }
            .canvasBackground()
            .navigationTitle(L("Label"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task { if !LabelCode.isBox(code) { await load() } }
            .toast($toast)
        }
        .presentationDetents([.medium, .large])
    }

    @ViewBuilder private func content(_ d: JSONValue) -> some View {
        switch d["kind"]?.string {
        case "product": if let p = d["product"] { product(p) }
        case "location": if let l = d["location"] { location(l, items: d["items"]?.array ?? []) }
        case "care": if let t = d["task"] { task(t) }
        default: EmptyStateView(systemImage: "qrcode", title: L("This code isn't a ToHuus label."))
        }
    }

    // MARK: product

    private func product(_ p: JSONValue) -> some View {
        let mode = p.first("trackMode", "track_mode")?.string ?? "count"
        let total = p.first("total")?.double ?? 0
        let onList = p.first("onList", "on_list")?.bool ?? false
        let id = p["id"]?.int
        return ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                HStack(spacing: Theme.Space.s3) {
                    ProductThumb(path: p.first("imagePath", "image_path", "image")?.string, api: store.api, size: 64)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(p["brand"]?.string ?? L("Product")).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.ink3)
                        Text(p["name"]?.string ?? "").font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.ink)
                        if mode != "none" {
                            Text(LF("%@ in stock", total.formatted(.number.precision(.fractionLength(0...1))))).font(.subheadline).foregroundStyle(Theme.ink2)
                        }
                    }
                }
                LazyVGrid(columns: [GridItem(.flexible()), GridItem(.flexible())], spacing: Theme.Space.s2) {
                    if mode == "count" {
                        actionTile("hand.raised", L("Took one"), key: "take", disabled: total <= 0)
                    }
                    if mode != "none" {
                        actionTile("drop", L("Opened"), key: "opened", disabled: total <= 0)
                    }
                    actionTile(onList ? "checkmark" : "basket", onList ? L("On the list") : L("Add to list"), key: "list", disabled: onList)
                    Button {
                        Motion.perform(Motion.quick) { showWhere.toggle() }
                    } label: {
                        tileLabel("mappin.and.ellipse", L("Where is it kept?"), on: showWhere)
                    }
                    .buttonStyle(.plain)
                }
                if showWhere {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        let places = p["places"]?.array ?? []
                        if places.isEmpty && p["spot"]?.string == nil {
                            Text(L("No place stored yet.")).foregroundStyle(Theme.ink3)
                        }
                        ForEach(Array(places.enumerated()), id: \.offset) { _, pl in
                            VStack(alignment: .leading, spacing: 1) {
                                Label(pl["name"]?.string ?? "", systemImage: PlaceIcon.symbol(pl["icon"]?.string)).font(.body.weight(.semibold))
                                if let h = pl["hint"]?.string { Text(h).font(.caption).foregroundStyle(Theme.ink2) }
                            }
                        }
                        if let s = p["spot"]?.string { Text(LF("Exact spot: %@", s)).font(.subheadline) }
                    }
                    .padding(Theme.Space.s3)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
                }
                if let id, let openProduct {
                    Button { openProduct(id); dismiss() } label: { Label(L("Open product"), systemImage: "arrow.right") }
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
            }
            .padding(Theme.Space.s4)
        }
    }

    // MARK: place

    private func location(_ l: JSONValue, items: [JSONValue]) -> some View {
        List {
            Section {
                VStack(alignment: .leading, spacing: 2) {
                    Text(items.count == 1 ? L("1 thing in here") : LF("%d things in here", items.count))
                        .font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.ink3)
                    Label(l["name"]?.string ?? "", systemImage: PlaceIcon.symbol(l["icon"]?.string)).font(.title3.weight(.semibold))
                    if let h = l["hint"]?.string { Text(h).font(.subheadline).foregroundStyle(Theme.ink2) }
                }
            }
            Section {
                if items.isEmpty { Text(L("Nothing stored here")).foregroundStyle(Theme.ink3) }
                ForEach(Array(items.enumerated()), id: \.offset) { _, it in
                    Button {
                        if let id = it["id"]?.int, let openProduct { openProduct(id); dismiss() }
                    } label: {
                        HStack(spacing: Theme.Space.s3) {
                            ProductThumb(path: it.first("imagePath", "image_path")?.string, api: store.api, size: 40)
                            VStack(alignment: .leading, spacing: 1) {
                                Text(it["name"]?.string ?? "").foregroundStyle(Theme.ink)
                                if let s = it["spot"]?.string { Text(s).font(.caption).foregroundStyle(Theme.ink3) }
                            }
                        }
                    }
                }
            }
        }
        .themedList()
    }

    // MARK: care task

    private func task(_ t: JSONValue) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Text(t["name"]?.string ?? "").font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.ink)
                if let state = t["state"]?.string {
                    Text(state == "overdue" ? L("overdue") : state == "today" ? L("due today") : (t.first("nextDue", "next_due")?.string.flatMap { ServerDate.relative($0) } ?? ""))
                        .font(.subheadline).foregroundStyle(state == "overdue" ? Theme.empty : Theme.ink2)
                }
                Button {
                    Task { await act("done") }
                } label: {
                    HStack { if busy == "done" { ProgressView().tint(Theme.onPrimary) }; Label(L("Done"), systemImage: "checkmark") }
                }
                .buttonStyle(PrimaryButtonStyle())
                .disabled(busy != nil)
                if let p = t["product"], let name = p["name"]?.string {
                    Text(LF("Takes one %@ from stock (%d left).", name, p["stock"]?.int ?? 0)).font(.footnote).foregroundStyle(Theme.ink3)
                }
                if let last = t.first("lastDone", "last_done")?.string {
                    Text(LF("Last done: %@", ServerDate.relative(last) ?? last)).font(.footnote).foregroundStyle(Theme.ink3)
                } else {
                    Text(L("Not done yet")).font(.footnote).foregroundStyle(Theme.ink3)
                }
            }
            .padding(Theme.Space.s4)
        }
    }

    // MARK: pieces

    private func actionTile(_ symbol: String, _ title: String, key: String, disabled: Bool) -> some View {
        Button {
            Task { await act(key) }
        } label: {
            tileLabel(symbol, title, on: false, busy: busy == key)
        }
        .buttonStyle(.plain)
        .disabled(disabled || busy != nil)
        .opacity(disabled ? 0.5 : 1)
    }

    private func tileLabel(_ symbol: String, _ title: String, on: Bool, busy: Bool = false) -> some View {
        VStack(spacing: Theme.Space.s2) {
            if busy { ProgressView() } else { Image(systemName: symbol).font(.title2).foregroundStyle(Theme.primaryText) }
            Text(title).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.center)
        }
        .frame(maxWidth: .infinity, minHeight: 88)
        .background(on ? Theme.primarySoft : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }

    private func load() async {
        do {
            data = try await store.api.resolveQR(code)
        } catch {
            let e = APIError.from(error)
            self.error = e == .notFound ? L("This label is no longer valid.") : e.localizedDescription
        }
    }

    private func act(_ action: String) async {
        busy = action
        defer { busy = nil }
        let safe = code.addingPercentEncoding(withAllowedCharacters: .alphanumerics) ?? code
        do {
            let r: JSONValue = try await store.api.send("POST", "api/qr/\(safe)/action", json: ["action": action])
            if let d = r["data"], !d.isNull { data = d }
            toast = ToastMessage(text: r["message"]?.string ?? L("Done"))
            Haptics.success()
            store.touch("stock", "shopping", "care")
            await store.refreshList()
        } catch {
            toast = ToastMessage(text: APIError.from(error).localizedDescription, isError: true)
        }
    }
}
