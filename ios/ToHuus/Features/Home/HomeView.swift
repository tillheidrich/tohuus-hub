import SwiftUI

/// Aufgaben and Vorrat as two tabs of their own (18 Oct 2026, web: /aufgaben and /bestand, nav.tsx). They used to share
/// one tab "Zuhause" behind a switch; testers kept losing the other side. The doors moved to where they belong:
/// Hausinfo and Urlaub on top of Aufgaben (things about the house and the time away), Wo ist was? on top of Vorrat
/// (where the things are). Stock switched off ("Was nutzt ihr?") or not open for a guest → no Vorrat tab at all.
enum HomeDoor: String, Identifiable { case find, house, away; var id: String { rawValue } }

#if DEBUG
@MainActor private var debugDoorOpened = false
/// screenshot runs: -debugHomeDoor house | find | away opens the door the way a tap on its chip does
/// (house/away with -debugTab tasks, find with -debugTab stock)
@MainActor private func debugDoor(_ allowed: [HomeDoor]) async -> HomeDoor? {
    guard !debugDoorOpened, let raw = UserDefaults.standard.string(forKey: "debugHomeDoor"), let d = HomeDoor(rawValue: raw), allowed.contains(d) else { return nil }
    debugDoorOpened = true
    try? await Task.sleep(nanoseconds: 1_000_000_000)
    return d
}
#endif

/// Tab "Aufgaben": the task list with the doors Hausinfo and Urlaub.
struct TasksAreaView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    @State private var door: HomeDoor?

    private var level: String? { app.isGuest ? (app.guestLevel ?? "paused") : nil }
    private var house: Bool { MoreAccess.guestAllows(level, "/hausinfo") }
    private var away: Bool { !app.isGuest && MoreAccess.guestAllows(level, "/urlaub") }

    var body: some View {
        NavigationStack {
            CareView(api: store.api).rootChrome()
        }
        .safeAreaInset(edge: .top, spacing: 0) {
            if house || away {
                DoorBar {
                    if house { DoorChip(title: L("House info"), icon: "info.circle") { door = .house } }
                    if away { DoorChip(title: L("Trip / away"), icon: "suitcase") { door = .away } }
                }
            }
        }
        .onAppear { app.assistantContext = "tasks" }
        #if DEBUG
        .task { if let d = await debugDoor([.house, .away]) { door = d } }
        #endif
        .sheet(item: $door) { d in
            switch d {
            case .away:
                NavigationStack { AwayView(store: store).toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { door = nil } } } }
            default:
                NavigationStack { HouseGuideView().toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { door = nil } } } }
            }
        }
    }
}

/// Tab "Vorrat": the pantry with the door Wo ist was?
struct StockAreaView: View {
    @Environment(AppModel.self) private var app
    let store: ServerStore
    @State private var door: HomeDoor?
    @State private var product: Int?

    var body: some View {
        PantryView(store: store)
            .safeAreaInset(edge: .top, spacing: 0) {
                DoorBar { DoorChip(title: L("Where’s what?"), icon: "mappin.and.ellipse") { door = .find } }
            }
            .onAppear { app.assistantContext = "stock" }
            #if DEBUG
            .task { if let d = await debugDoor([.find]) { door = d } }
            #endif
            .sheet(item: $door) { _ in
                FindView(store: store) { id in door = nil; Task { try? await Task.sleep(nanoseconds: 450_000_000); product = id } }
            }
            .sheet(item: Binding(get: { product.map(ProductRef.init) }, set: { product = $0?.id })) { p in
                NavigationStack {
                    ProductDetailView(productId: p.id, store: store)
                        .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { product = nil } } }
                }
            }
    }
}

/// the row of door chips on top of a tab (scrolls sideways when the text is large)
private struct DoorBar<Content: View>: View {
    @ViewBuilder let content: Content

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s2) { content }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s2)
        .background(.bar)
    }
}

private struct DoorChip: View {
    let title: String
    let icon: String
    let action: () -> Void

    var body: some View {
        Button(action: action) {
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
