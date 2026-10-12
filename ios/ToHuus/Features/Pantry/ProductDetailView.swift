import SwiftUI

struct ProductDetailView: View {
    let productId: Int
    let store: ServerStore
    @State private var product: ProductInfo?
    @State private var error: String?
    @State private var busy = false
    @State private var toast: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                if let p = product {
                    header(p)
                    amountCard(p)
                    if !p.stock.isEmpty { stockCard(p) }
                    actions(p)
                    if !p.history.isEmpty { historyCard(p) }
                } else if let error {
                    ErrorBanner(message: error) { Task { await load() } }
                } else {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 60)
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationTitle(product?.name ?? "")
        .navigationBarTitleDisplayMode(.inline)
        .task(id: store.revision("stock")) { await load() }
        .overlay(alignment: .bottom) {
            if let toast {
                Text(toast).font(.subheadline).padding(12).background(Theme.ink, in: Capsule()).foregroundStyle(Theme.canvas)
                    .padding(.bottom, 24)
                    .task { try? await Task.sleep(nanoseconds: 2_500_000_000); self.toast = nil }
            }
        }
    }

    private func load() async {
        do {
            product = try await store.api.product(productId)
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }

    private func header(_ p: ProductInfo) -> some View {
        HStack(spacing: Theme.Space.s4) {
            RemoteImage(url: store.api.imageURL(p.imagePath), api: store.api, placeholder: "shippingbox")
                .frame(width: 84, height: 84)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.lg))
            VStack(alignment: .leading, spacing: 4) {
                Text(p.name).font(Theme.title(Theme.FontSize.h2))
                if let b = p.brand { Text(b).foregroundStyle(Theme.ink2) }
                if let s = p.statusLabel { StatusPill(text: s, status: p.status) }
            }
        }
    }

    private func amountCard(_ p: ProductInfo) -> some View {
        Card(title: L("At home"), systemImage: "cabinet") {
            if p.isLevel {
                Picker(L("Level"), selection: Binding(get: { Int((p.total ?? 0).rounded()) }, set: { v in Task { await set(Double(v)) } })) {
                    Text(L("empty")).tag(0)
                    Text(L("low")).tag(1)
                    Text(L("half")).tag(2)
                    Text(L("full")).tag(3)
                }
                .pickerStyle(.segmented)
            } else if p.isTracked {
                HStack {
                    Button { Task { await adjust(-1) } } label: { Image(systemName: "minus.circle.fill").font(.title) }
                        .disabled((p.total ?? 0) <= 0 || busy)
                    Spacer()
                    Text(p.amountLabel).font(.title2.weight(.semibold)).monospacedDigit()
                    Spacer()
                    Button { Task { await adjust(1) } } label: { Image(systemName: "plus.circle.fill").font(.title) }
                        .disabled(busy)
                }
                .foregroundStyle(Theme.primary)
            } else {
                Text(L("This product isn't counted – ToHuus just remembers when you buy it.")).font(.subheadline).foregroundStyle(Theme.ink2)
            }
            if let spot = p.spot { Label(spot, systemImage: "mappin").font(.subheadline).foregroundStyle(Theme.ink2) }
            if let w = p.perWeek { Text(LF("About %@ per week", String(format: "%.1f", w))).font(.caption).foregroundStyle(Theme.ink3) }
        }
    }

    private func stockCard(_ p: ProductInfo) -> some View {
        Card(title: L("Best before"), systemImage: "calendar") {
            ForEach(p.stock) { e in
                HStack {
                    Text(String(format: "%g", e.qty ?? 0)).monospacedDigit()
                    Spacer()
                    Text(ServerDate.shortDay(e.bestBefore) ?? L("no date")).foregroundStyle(Theme.ink2)
                    if e.openedAt != nil { Text(L("opened")).font(.caption).foregroundStyle(Theme.warning) }
                }
                .font(.subheadline)
            }
        }
    }

    private func actions(_ p: ProductInfo) -> some View {
        VStack(spacing: Theme.Space.s3) {
            Button {
                Task { await usedUp() }
            } label: {
                Label(L("Used up – put it on the list"), systemImage: "arrow.uturn.down.circle")
            }
            .buttonStyle(PrimaryButtonStyle())
            Button {
                Task {
                    await store.addProduct(p.id, name: p.name)
                    toast = L("On the list.")
                }
            } label: {
                Label(L("Just put it on the list"), systemImage: "cart.badge.plus")
            }
            .buttonStyle(SecondaryButtonStyle())
        }
        .disabled(busy)
    }

    private func historyCard(_ p: ProductInfo) -> some View {
        Card(title: L("History"), systemImage: "clock") {
            ForEach(p.history.prefix(8)) { m in
                HStack {
                    Text((m.delta ?? 0) > 0 ? "+\(String(format: "%g", m.delta ?? 0))" : String(format: "%g", m.delta ?? 0)).monospacedDigit()
                        .foregroundStyle((m.delta ?? 0) > 0 ? Theme.primaryText : Theme.ink2)
                        .frame(width: 44, alignment: .leading)
                    Text(m.actor ?? m.reason ?? "").foregroundStyle(Theme.ink2)
                    Spacer()
                    Text(ServerDate.relative(m.createdAt) ?? "").foregroundStyle(Theme.ink3)
                }
                .font(.caption)
            }
        }
    }

    private func adjust(_ delta: Double) async {
        busy = true
        defer { busy = false }
        Haptics.tick()
        do {
            try await store.api.adjustStock(productId: productId, delta: delta)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func set(_ value: Double) async {
        busy = true
        defer { busy = false }
        do {
            try await store.api.adjustStock(productId: productId, set: value)
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }

    private func usedUp() async {
        busy = true
        defer { busy = false }
        do {
            try await store.api.usedUp(productId)
            Haptics.success()
            toast = L("Used up and on the list.")
            store.touch("stock", "shopping")
            await store.refreshList()
            await load()
        } catch { self.error = APIError.from(error).localizedDescription }
    }
}
