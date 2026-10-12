import SwiftUI

/// Entry points in "Mehr" › Haushalt: people, invitations, what ToHuus remembers (kept out of SettingsView so the
/// shared file only gets one line).
struct HouseholdLinks: View {
    let api: APIClient
    @State private var open: String?

    var body: some View {
        Group {
            NavigationLink { HouseholdView(api: api) } label: { Label(L("People & likes"), systemImage: "person.2") }
            NavigationLink { InvitesView(api: api) } label: { Label(L("Invite someone"), systemImage: "person.badge.plus") }
            NavigationLink { MemoryView(api: api) } label: { Label(L("What ToHuus remembers"), systemImage: "text.book.closed") }
        }
        .sheet(item: Binding(get: { open.map(DebugKey.init) }, set: { open = $0?.id })) { k in
            NavigationStack {
                switch k.id {
                case "invites": InvitesView(api: api)
                case "memory": MemoryView(api: api)
                default: HouseholdView(api: api)
                }
            }
        }
        .onAppear {
            #if DEBUG
            // simulator checks: -debugMore people | invites | memory (with -debugSettings YES)
            if open == nil, let d = UserDefaults.standard.string(forKey: "debugMore"), ["people", "invites", "memory"].contains(d) {
                open = d
            }
            #endif
        }
    }
}

private struct DebugKey: Identifiable { let id: String }
