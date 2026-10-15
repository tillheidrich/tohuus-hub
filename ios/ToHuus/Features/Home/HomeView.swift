import SwiftUI

/// Zuhause (UX benchmark 2.1, web: /aufgaben and /bestand under one tab): everything at home that needs attention –
/// Aufgaben and Vorrat behind one switch, plus three doors: Wo ist was?, Hausinfo, Urlaub. The switch remembers the
/// last choice. Stock switched off ("Was nutzt ihr?") or not open for a guest → only Aufgaben, and the other way round.
struct HomeView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    @AppStorage("home.segment") private var segment = "tasks"
    @State private var door: Door?
    @State private var product: Int?

    enum Door: String, Identifiable { case find, house, away; var id: String { rawValue } }

    private var level: String? { app.isGuest ? (app.guestLevel ?? "paused") : nil }
    private var stockOn: Bool { app.moduleOn("stock") && MoreAccess.guestAllows(level, "/bestand") }
    private var tasksOn: Bool { MoreAccess.guestAllows(level, "/aufgaben") }
    private var showsStock: Bool { stockOn && (segment == "stock" || !tasksOn) }

    var body: some View {
        Group {
            if showsStock {
                PantryView(store: store)
            } else {
                NavigationStack {
                    CareView(api: store.api).rootChrome()
                }
            }
        }
        .safeAreaInset(edge: .top, spacing: 0) { header }
        .onChange(of: showsStock, initial: true) { _, stock in app.assistantContext = stock ? "stock" : "tasks" }
        .onChange(of: app.homeSegment, initial: true) { _, s in
            if let s { segment = s; app.homeSegment = nil }
        }
        .sheet(item: $door) { d in
            switch d {
            case .find:
                FindView(store: store) { id in door = nil; Task { try? await Task.sleep(nanoseconds: 450_000_000); product = id } }
            case .house:
                NavigationStack { HouseGuideView().toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { door = nil } } } }
            case .away:
                NavigationStack { AwayView(store: store).toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { door = nil } } } }
            }
        }
        .sheet(item: Binding(get: { product.map(ProductRef.init) }, set: { product = $0?.id })) { p in
            NavigationStack {
                ProductDetailView(productId: p.id, store: store)
                    .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { product = nil } } }
            }
        }
    }

    private var header: some View {
        VStack(spacing: Theme.Space.s2) {
            if stockOn && tasksOn {
                Picker(L("Home"), selection: $segment) {
                    Text(L("Tasks")).tag("tasks")
                    Text(L("Pantry")).tag("stock")
                }
                .pickerStyle(.segmented)
            }
            ScrollView(.horizontal, showsIndicators: false) {
                HStack(spacing: Theme.Space.s2) {
                    if stockOn || MoreAccess.guestAllows(level, "/wo") { doorChip(.find, L("Where’s what?"), "mappin.and.ellipse") }
                    if MoreAccess.guestAllows(level, "/hausinfo") { doorChip(.house, L("House info"), "info.circle") }
                    if !app.isGuest && MoreAccess.guestAllows(level, "/urlaub") { doorChip(.away, L("Trip / away"), "suitcase") }
                }
            }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s2)
        .background(.bar)
    }

    private func doorChip(_ d: Door, _ title: String, _ icon: String) -> some View {
        Button { door = d } label: {
            Label(title, systemImage: icon)
                .font(.subheadline)
                .padding(.horizontal, 12)
                .frame(minHeight: 36)
                .background(Theme.surface, in: Capsule())
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                .padding(.vertical, 4)
                .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .foregroundStyle(Theme.ink)
        .frame(minHeight: 44)
    }
}

private struct ProductRef: Identifiable { let id: Int }
