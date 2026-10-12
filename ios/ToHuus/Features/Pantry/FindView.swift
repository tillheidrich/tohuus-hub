import SwiftUI

/// "Wo ist was?" (web pages/Find.tsx, GET /api/find?q=): where something is kept, with the exact spot and the
/// place's hint – for the household, babysitters and visitors.
struct FindView: View {
    let store: ServerStore
    let openProduct: (Int) -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var query = ""
    @State private var results: [FoundThing] = []
    @State private var loading = false
    @State private var error: String?

    var body: some View {
        NavigationStack {
            List {
                if let error { ErrorBanner(message: error) { Task { await search() } }.listRowBackground(Color.clear) }
                if results.isEmpty && !loading && error == nil {
                    EmptyStateView(systemImage: "mappin.and.ellipse",
                                   title: query.isEmpty ? L("Nothing stored yet.") : L("Nothing found."),
                                   message: query.isEmpty ? nil : L("Try another word – brand or a part of the name works too."))
                        .listRowBackground(Color.clear)
                }
                ForEach(results) { r in
                    Button { openProduct(r.id) } label: { row(r) }
                        .buttonStyle(.plain)
                }
            }
            .listStyle(.insetGrouped)
            .scrollContentBackground(.hidden)
            .canvasBackground()
            .searchable(text: $query, placement: .navigationBarDrawer(displayMode: .always), prompt: L("e.g. batteries, tape, birthday candles"))
            .navigationTitle(L("Where is what?"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task(id: query) {
                // a short pause while typing
                if !query.isEmpty { try? await Task.sleep(nanoseconds: 250_000_000) }
                guard !Task.isCancelled else { return }
                await search()
            }
            .onAppear {
                #if DEBUG
                if let q = UserDefaults.standard.string(forKey: "debugFindQuery") { query = q }
                #endif
            }
        }
    }

    private func row(_ r: FoundThing) -> some View {
        HStack(alignment: .top, spacing: Theme.Space.s3) {
            RemoteImage(url: store.api.imageURL(r.imagePath), api: store.api, placeholder: "shippingbox")
                .frame(width: 40, height: 40)
                .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.sm))
            VStack(alignment: .leading, spacing: 3) {
                HStack(spacing: 6) {
                    Text(r.name).font(Theme.rowFont).foregroundStyle(Theme.ink)
                    if r.inStock == false { StatusPill(text: L("out"), status: "empty") }
                }
                ForEach(r.places) { p in
                    Label {
                        VStack(alignment: .leading, spacing: 1) {
                            Text(p.name).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.primaryText)
                            if let h = p.hint, !h.isEmpty { Text(h).font(.caption).foregroundStyle(Theme.ink2) }
                        }
                    } icon: {
                        Image(systemName: PlaceIcon.symbol(p.icon)).foregroundStyle(Theme.primaryText)
                    }
                }
                if let s = r.spot, !s.isEmpty {
                    Label(s, systemImage: "scope").font(.caption).foregroundStyle(Theme.ink2)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 4)
        .contentShape(Rectangle())
    }

    private func search() async {
        loading = true
        defer { loading = false }
        do {
            results = try await store.api.find(query.trimmingCharacters(in: .whitespaces))
            error = nil
        } catch {
            // typing on cancels the previous search
            if Task.isCancelled || (error as? URLError)?.code == .cancelled { return }
            self.error = APIError.from(error).localizedDescription
        }
    }
}
