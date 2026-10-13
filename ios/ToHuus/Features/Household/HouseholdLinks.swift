import SwiftUI

/// Entry points in "Mehr" › Haushalt: people, invitations, what ToHuus remembers (kept out of SettingsView so the
/// shared file only gets one line).
struct HouseholdLinks: View {
    @Environment(AppModel.self) private var app
    let api: APIClient
    @State private var open: String?

    var body: some View {
        Group {
            NavigationLink { HouseholdView(api: api) } label: { Label(L("People & likes"), systemImage: "person.2") }
            NavigationLink { InvitesView(api: api) } label: { Label(L("Invite someone"), systemImage: "person.badge.plus") }
            NavigationLink { MemoryView(api: api) } label: { Label(L("What ToHuus remembers"), systemImage: "text.book.closed") }
            // "Bring mir was" needs someone at home to ask: hidden for a household of one and when switched off
            if !app.singleHousehold && app.moduleOn("treats") {
                NavigationLink { TreatsView(api: api) } label: { Label(L("For me – ask for something"), systemImage: "heart") }
            }
            NavigationLink { GuestLinksView(api: api) } label: { Label(L("Guest links"), systemImage: "link") }
            // not native yet – the web pages, signed in (WebPageView); guests see only the handover shared with them
            if app.isGuest {
                NavigationLink { WebPageView(api: api, path: "/uebergabe", title: L("Handover")) } label: { Label(L("Handover"), systemImage: "suitcase") }
            } else {
                NavigationLink { WebPageView(api: api, path: "/urlaub", title: L("Trip / away")) } label: { Label(L("Trip / away"), systemImage: "suitcase") }
                if app.moduleOn("homeinfo") {
                    NavigationLink { WebPageView(api: api, path: "/pflege", title: L("Home & care")) } label: { Label(L("Home & care"), systemImage: "wrench.and.screwdriver") }
                }
            }
        }
        .sheet(item: Binding(get: { open.map(DebugKey.init) }, set: { open = $0?.id })) { k in
            NavigationStack {
                switch k.id {
                case "invites": InvitesView(api: api)
                case "memory": MemoryView(api: api)
                case "treats": TreatsView(api: api)
                case "guestlinks", "guestlink-new": GuestLinksView(api: api)
                case "house", "housecard-new", "housecard-edit", "housecode-new": HouseGuideView()
                default: HouseholdView(api: api)
                }
            }
        }
        .onAppear {
            #if DEBUG
            // simulator checks: -debugMore people | invites | memory | treats | guestlinks | house… (with -debugSettings YES)
            if open == nil, let d = UserDefaults.standard.string(forKey: "debugMore"), ["people", "invites", "memory", "treats", "guestlinks", "guestlink-new", "house", "housecard-new", "housecard-edit", "housecode-new"].contains(d) {
                open = d
            }
            #endif
        }
    }
}

private struct DebugKey: Identifiable { let id: String }
