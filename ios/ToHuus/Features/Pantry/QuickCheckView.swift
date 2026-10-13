import SwiftUI

/// "Schnell-Check" (web pages/Check.tsx): pick a place, then one card per thing – correct, less, empty or gone.
/// The stack is frozen when loaded so live updates don't reshuffle it under your thumb.
struct QuickCheckView: View {
    let store: ServerStore
    @Environment(\.dismiss) private var dismiss
    @State private var places: [CheckPlace] = []
    @State private var loading = true
    @State private var error: String?
    @State private var path: [CheckPlace] = []

    var body: some View {
        NavigationStack(path: $path) {
            List {
                Section {
                    if let error { ErrorBanner(message: error) { Task { await load() } }.listRowBackground(Color.clear) }
                    if places.isEmpty && !loading && error == nil {
                        EmptyStateView(systemImage: "checklist", title: L("Nothing to check"),
                                       message: L("As soon as something is in stock, you can check it here."))
                            .listRowBackground(Color.clear)
                    }
                    ForEach(places) { p in
                        NavigationLink(value: p) {
                            HStack(spacing: Theme.Space.s3) {
                                Image(systemName: PlaceIcon.symbol(p.icon))
                                    .font(.title3).foregroundStyle(Theme.primaryText)
                                    .frame(width: 36, height: 36)
                                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.name).font(Theme.rowFont)
                                    Text([(p.items ?? 0) == 1 ? L("1 thing") : LF("%d things", p.items ?? 0), CheckText.since(p.daysSinceCheck, checked: p.lastCheck != nil)]
                                        .joined(separator: " · "))
                                        .font(.caption).foregroundStyle(Theme.ink3)
                                }
                                Spacer(minLength: 0)
                                if let s = p.stale, s > 0 { StatusPill(text: LF("%d unsure", s), status: "low") }
                            }
                            .padding(.vertical, 2)
                        }
                    }
                } footer: {
                    Text(L("Takes a minute per place. Only what you answer changes – the rest stays as it is."))
                }
            }
            .scrollContentBackground(.hidden)
            .canvasBackground()
            .navigationTitle(L("Quick stock check"))
            .navigationBarTitleDisplayMode(.inline)
            .navigationDestination(for: CheckPlace.self) { p in CheckStackView(place: p, store: store) { Task { await load() } } }
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task {
                await load()
                #if DEBUG
                if UserDefaults.standard.bool(forKey: "debugCheckStack"), let first = places.first { path = [first] }
                #endif
            }
        }
    }

    private func load() async {
        defer { loading = false }
        do { places = try await store.api.checkPlaces(); error = nil } catch { self.error = APIError.from(error).localizedDescription }
    }
}

enum CheckText {
    static func since(_ days: Int?, checked: Bool) -> String {
        guard checked, let d = days else { return L("never checked") }
        switch d {
        case ...0: return L("checked today")
        case 1: return L("checked yesterday")
        default: return LF("checked %d days ago", d)
        }
    }

    static let wasteReasons: [(String, String)] = [
        ("expired", L("Past its date")), ("spoiled", L("Spoiled")), ("disliked", L("Didn't like it")), ("other", L("Other")),
    ]
}

/// Lucide/Phosphor icon names from the server → SF Symbols
enum PlaceIcon {
    static func symbol(_ name: String?) -> String {
        switch name ?? "" {
        case "refrigerator", "fridge": return "refrigerator"
        case "snowflake", "freezer": return "snowflake"
        case "archive", "pantry": return "archivebox"
        case "box", "package": return "shippingbox"
        case "cooking-pot", "kitchen": return "frying.pan"
        case "bath", "bathroom": return "bathtub"
        case "sparkles": return "sparkles"
        case "wine", "cup-soda": return "wineglass"
        case "door", "door-open": return "door.left.hand.open"
        default: return "square.grid.2x2"
        }
    }
}

struct CheckStackView: View {
    let place: CheckPlace
    let store: ServerStore
    let finished: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var items: [CheckItem] = []
    @State private var loaded = false
    @State private var index = 0
    @State private var mode = Mode.ask
    @State private var qty: Double = 0
    @State private var busy = false
    @State private var error: String?
    @State private var tally = (ok: 0, changed: 0, gone: 0)

    enum Mode { case ask, less, gone }

    private var current: CheckItem? { index < items.count ? items[index] : nil }
    private var done: Bool { loaded && index >= items.count }

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if !items.isEmpty {
                    ProgressView(value: Double(min(index, items.count)), total: Double(items.count))
                        .tint(Theme.primary)
                        .accessibilityLabel(LF("%d of %d", min(index + 1, items.count), items.count))
                }
                if let error { ErrorBanner(message: error) }
                if !loaded {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                } else if items.isEmpty {
                    EmptyStateView(systemImage: "checklist", title: L("Nothing here"), message: L("This place has nothing in stock right now."))
                } else if done {
                    doneCard
                } else if let c = current {
                    card(c)
                    HStack {
                        Button(L("Previous")) { mode = .ask; index -= 1 }.disabled(index == 0 || busy)
                        Spacer()
                        Button(L("Skip")) { mode = .ask; index += 1 }.disabled(busy)
                    }
                    .font(.subheadline)
                    Button(L("Stop for now – the rest stays as it is")) { finish() }
                        .buttonStyle(SecondaryButtonStyle())
                }
            }
            .padding(Theme.Space.s4)
        }
        .canvasBackground()
        .navigationTitle(place.name)
        .navigationBarTitleDisplayMode(.inline)
        .toolbar {
            if !items.isEmpty && !done {
                ToolbarItem(placement: .topBarTrailing) {
                    Text(LF("%d of %d", index + 1, items.count)).font(.subheadline.monospacedDigit()).foregroundStyle(Theme.ink2)
                }
            }
        }
        .task {
            guard !loaded else { return }
            do { items = try await store.api.checkStack(place.id).items } catch { self.error = APIError.from(error).localizedDescription }
            loaded = true
        }
    }

    private func card(_ c: CheckItem) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            HStack(alignment: .top, spacing: Theme.Space.s4) {
                RemoteImage(url: store.api.imageURL(c.imagePath), api: store.api, placeholder: "shippingbox")
                    .frame(width: 88, height: 88)
                    .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
                VStack(alignment: .leading, spacing: 4) {
                    if let b = c.brand { Text(b).font(.caption).foregroundStyle(Theme.ink3) }
                    Text(c.name).font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.ink)
                    HStack(spacing: 6) {
                        Text(LF("Listed: %@", c.qtyLabel)).font(.subheadline.weight(.semibold))
                        if c.kind == "leftover" { StatusPill(text: L("Leftovers"), status: nil) }
                        if c.opened == true { StatusPill(text: L("opened"), status: "expiring") }
                    }
                    let sub = [c.useBy.flatMap { ServerDate.shortDay($0) }.map { LF("use by %@", $0) },
                               CheckText.since(c.daysSinceSeen, checked: c.confirmedAt != nil)].compactMap { $0 }
                    Text(sub.joined(separator: " · ")).font(.caption).foregroundStyle(Theme.ink3)
                }
            }
            switch mode {
            case .ask: answers(c)
            case .less: lessPanel(c)
            case .gone: gonePanel
            }
        }
        .padding(Theme.Space.s4)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
        .id(c.productId)
        .transition(.asymmetric(insertion: .move(edge: .trailing).combined(with: .opacity), removal: .opacity))
    }

    private func answers(_ c: CheckItem) -> some View {
        Grid(horizontalSpacing: 10, verticalSpacing: 10) {
            GridRow {
                answerButton(L("Correct"), "checkmark", prominent: true) { Task { await answer("ok") } }
                answerButton(L("Less"), "minus") {
                    qty = c.isLevel ? max(0, (c.qty ?? 0).rounded() - 1) : max(0, (c.qty ?? 0) - 1)
                    mode = .less
                }
            }
            GridRow {
                answerButton(L("Empty"), "circle.slash") { Task { await answer("empty") } }
                answerButton(L("Gone"), "trash") { mode = .gone }
            }
        }
    }

    private func answerButton(_ title: String, _ icon: String, prominent: Bool = false, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            VStack(spacing: 6) {
                Image(systemName: icon).font(.title2.weight(.semibold))
                Text(title).font(.subheadline.weight(.semibold))
            }
            .frame(maxWidth: .infinity, minHeight: 72)
            .foregroundStyle(prominent ? Theme.onPrimary : Theme.ink)
            .background(prominent ? Theme.primary : Theme.surface2, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .contentShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
        }
        .buttonStyle(.plain)
        .disabled(busy)
    }

    private func lessPanel(_ c: CheckItem) -> some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(L("How much is really there?")).font(.subheadline).foregroundStyle(Theme.ink2)
            if c.isLevel {
                Picker(L("Level"), selection: Binding(get: { Int(qty) }, set: { qty = Double($0) })) {
                    Text(L("empty")).tag(0)
                    Text(L("low")).tag(1)
                    Text(L("half")).tag(2)
                    Text(L("full")).tag(3)
                }
                .pickerStyle(.segmented)
            } else {
                Stepper(value: $qty, in: 0...999, step: 1) {
                    Text([String(format: "%g", qty), c.unit].compactMap { $0 }.joined(separator: " "))
                        .font(.title3.weight(.semibold)).monospacedDigit()
                }
            }
            HStack {
                Button(L("Back")) { mode = .ask }.buttonStyle(SecondaryButtonStyle())
                Button(L("Save")) { Task { await answer("set", qty: qty) } }.buttonStyle(PrimaryButtonStyle()).disabled(busy)
            }
        }
    }

    private var gonePanel: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s3) {
            Text(L("Thrown away – why? (helps to see patterns, optional)")).font(.subheadline).foregroundStyle(Theme.ink2)
            ShopChipFlow {
                ForEach(CheckText.wasteReasons, id: \.0) { r in
                    ShopToggleChip(title: r.1, on: false) { Task { await answer("gone", reason: r.0) } }
                }
            }
            Button(L("Back")) { mode = .ask }.buttonStyle(SecondaryButtonStyle())
        }
    }

    private var doneCard: some View {
        VStack(spacing: Theme.Space.s3) {
            Image(systemName: "checkmark.circle.fill").font(.system(size: 48)).foregroundStyle(Theme.primary)
            Text(LF("%@ is up to date", place.name)).font(.title3.weight(.semibold)).multilineTextAlignment(.center)
            let parts = [tally.ok > 0 ? LF("%d confirmed", tally.ok) : nil,
                         tally.changed > 0 ? LF("%d corrected", tally.changed) : nil,
                         tally.gone > 0 ? LF("%d thrown away", tally.gone) : nil].compactMap { $0 }
            if !parts.isEmpty { Text(parts.joined(separator: " · ")).font(.subheadline).foregroundStyle(Theme.ink2) }
            Button(L("Done")) { finish() }.buttonStyle(PrimaryButtonStyle()).padding(.top, 8)
        }
        .padding(Theme.Space.s5)
        .frame(maxWidth: .infinity)
        .background(Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
        .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(Theme.line, lineWidth: 1))
    }

    private func answer(_ action: String, qty: Double? = nil, reason: String? = nil) async {
        guard let c = current, !busy else { return }
        busy = true
        defer { busy = false }
        do {
            try await store.api.checkAnswer(locationId: place.id, productId: c.productId, action: action, qty: qty, reason: reason)
            Haptics.tick()
            switch action {
            case "ok": tally.ok += 1
            case "gone": tally.gone += 1
            default: tally.changed += 1
            }
            withAnimation(.easeOut(duration: 0.2)) {
                mode = .ask
                index += 1
            }
            error = nil
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func finish() {
        store.touch("stock", "products")
        finished()
        dismiss()
    }
}
