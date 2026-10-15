import SwiftUI

/// The tour of the iPhone app (13 Oct 2026): a few pages through what ToHuus does, shown once after signing in and
/// again whenever the tour gets a new version (new areas), always reachable in Einstellungen › Wissen. The last page
/// is the person's own choice about AI: the household assistant for themselves, and Apple Intelligence on this iPhone
/// – both can be changed later in Einstellungen › Mit oder ohne KI.
struct AppTourView: View {
    /// bump when the tour gets pages people who saw it should see
    static let version = 1
    static let seenKey = "tour.ios.version"

    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var page = 0
    @State private var onDevice = OnDeviceAI.chosen

    private struct Page: Identifiable {
        let id: String
        let symbol: String
        let title: String
        let body: String
    }

    private var pages: [Page] {
        var p: [Page] = [
            Page(id: "today", symbol: "sun.max", title: L("Today: the one page to glance at"),
                 body: L("What is running out, what should be eaten soon and what is planned. On most days a quick look here is all it takes.")),
            Page(id: "add", symbol: "plus.circle", title: L("Adding things takes seconds"),
                 body: L("Scan a barcode, upload a receipt, take a photo or just type “2 milk, parcel tape”. Nobody has to type in the whole house.")),
            Page(id: "shopping", symbol: "basket", title: L("One shopping list for everyone"),
                 body: app.singleHousehold
                    ? L("ToHuus remembers what you buy and how often. What is probably due comes as a suggestion – it only goes on the list after a yes. Every row says where it came from.")
                    : L("Everyone adds to the same list. ToHuus remembers what you buy and how often; what is probably due comes as a suggestion, and every row says where it came from.")),
        ]
        if app.moduleOn("stock") {
            p.append(Page(id: "stock", symbol: "cabinet", title: L("Stock is optional"),
                          body: L("Nobody has to keep a stock list. If you like, see what is at home place by place – “Where’s what?” finds the plasters in seconds.")))
        }
        if app.moduleOn("money") {
            p.append(Page(id: "money", symbol: "creditcard", title: L("Receipts and money"),
                          body: L("Photo, PDF or e-receipt: ToHuus sees what you bought and what it cost. Budgets per week, month or year, for the household or just for you, and money lists for splitting a pizza night.")))
        }
        if app.moduleOn("cook") {
            p.append(Page(id: "cook", symbol: "fork.knife", title: L("What shall we eat?"),
                          body: L("Ideas from what is already at home, a week plan if you want one, and recipes from links, photos or a recipe package. Missing ingredients go on the list with one tap.")))
        }
        p.append(Page(id: "speak", symbol: "sparkles", title: L("Assistant"),
                      body: L("Say “milk is out, and we need something for Sunday”. ToHuus puts it on the list and tells you what it added. Every change can be undone.")))
        if !app.singleHousehold && app.moduleOn("treats") {
            p.append(Page(id: "treats", symbol: "heart", title: L("Bring mir was"),
                          body: L("Stuck on the sofa or putting the kids to bed? Ask for a little something in two taps, someone at home says “I’ll bring it”. Guests can ask through a link.")))
        }
        p.append(Page(id: "wishes", symbol: "gift", title: L("Wishes"),
                      body: L("Wish lists with photo, links and price. Who reserved what stays hidden from the person it is for. Private lists only you can see.")))
        p.append(Page(id: "house", symbol: "house", title: L("House info and trips"),
                      body: L("For babysitters and guests: Wi-Fi, smart home, emergency numbers, with photos and short videos. When you are away, a handover for whoever feeds the cat or waters the plants.")))
        p.append(Page(id: "glance", symbol: "applewatch", title: L("At a glance"),
                      body: L("Widgets on the home and lock screen, the shopping trip on the lock screen while you shop, and the list on your Apple Watch.")))
        return p
    }

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                TabView(selection: $page) {
                    ForEach(Array(pages.enumerated()), id: \.element.id) { i, p in
                        card(p).tag(i)
                    }
                    choice.tag(pages.count)
                }
                .tabViewStyle(.page(indexDisplayMode: .always))
                .indexViewStyle(.page(backgroundDisplayMode: .always))
                .animation(reduceMotion ? nil : Motion.standard, value: page)
                Button {
                    if page < pages.count { page += 1 } else { finish() }
                } label: {
                    Text(page < pages.count ? L("Next") : L("Let’s go"))
                        .frame(maxWidth: .infinity, minHeight: 44)
                }
                .buttonStyle(.borderedProminent)
                .padding(.horizontal, Theme.Space.s5)
                .padding(.bottom, Theme.Space.s4)
            }
            .background(Theme.canvas)
            .toolbar {
                ToolbarItem(placement: .cancellationAction) {
                    Button(L("Skip tour")) { finish() }
                }
            }
        }
        .interactiveDismissDisabled(false)
    }

    private func card(_ p: Page) -> some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Image(systemName: p.symbol)
                    .font(.system(size: 44, weight: .regular))
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 88, height: 88)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
                    .accessibilityHidden(true)
                Text(p.title).font(Theme.title()).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(p.body).font(.body).foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(Theme.Space.s5)
            .padding(.top, Theme.Space.s5)
        }
    }

    /// The last page: the person decides about AI (both later in Einstellungen › Mit oder ohne KI).
    private var choice: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                Image(systemName: "sparkles")
                    .font(.system(size: 44))
                    .foregroundStyle(Theme.primaryText)
                    .frame(width: 88, height: 88)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: 44, style: .continuous))
                    .accessibilityHidden(true)
                Text(L("With or without AI: you decide")).font(Theme.title()).foregroundStyle(Theme.ink)
                    .accessibilityAddTraits(.isHeader)
                Text(L("The list, suggestions, cooking and money work without any AI. You can change both switches later in Settings › With or without AI."))
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                if app.aiLocked {
                    Label(L("Switched off for you by an adult in the household."), systemImage: "lock.fill")
                        .foregroundStyle(Theme.ink2)
                } else {
                    if app.aiAvailable {
                        Toggle(isOn: Binding(get: { app.personalAI }, set: { on in Task { await app.setPersonalAI(on) } })) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Use AI for me"))
                                Text(L("Free sentences to the assistant and cooking help, through Mistral in the EU."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                    }
                    if OnDeviceAI.state != .notSupported {
                        Toggle(isOn: $onDevice) {
                            VStack(alignment: .leading, spacing: 2) {
                                Text(L("Apple Intelligence on this iPhone"))
                                Text(L("Tidies up receipt photos and handwritten lists on this iPhone. Nothing leaves the device for this step."))
                                    .font(.caption).foregroundStyle(Theme.ink3)
                            }
                        }
                        .onChange(of: onDevice) { _, v in OnDeviceAI.chosen = v }
                    }
                }
            }
            .frame(maxWidth: 520, alignment: .leading)
            .padding(Theme.Space.s5)
            .padding(.top, Theme.Space.s5)
        }
    }

    private func finish() {
        UserDefaults.standard.set(Self.version, forKey: Self.seenKey)
        dismiss()
    }

    /// shown once per tour version after signing in (not in UI tests or screenshot runs; -debugTour YES forces it)
    static var due: Bool {
        let d = UserDefaults.standard
        if d.bool(forKey: "debugTour") { return true }
        // simulator, UI test and screenshot runs sign in with -debugToken: no tour in the way
        if d.bool(forKey: "debugNoTour") || d.string(forKey: "debugToken") != nil { return false }
        return UserDefaults.standard.integer(forKey: seenKey) < version
    }
}
