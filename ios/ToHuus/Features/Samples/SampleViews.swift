import SwiftUI

/// Sample data in the app (package D, 1.0): asked once after a new household, tagged quietly per row, removed with
/// one tap in Mehr, and offered once on Heute after a few days. Server: /api/tour, /api/tour/demo/*.
struct SampleQuestionView: View {
    @Environment(AppModel.self) private var app
    @State private var busy: Bool?
    @State private var error: String?

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s5) {
                HStack(spacing: Theme.Space.s3) {
                    sampleTile("cart", Theme.primarySoft)
                    sampleTile("refrigerator", Theme.sand)
                    sampleTile("fork.knife", Theme.primarySoft)
                }
                .accessibilityHidden(true)
                .padding(.top, Theme.Space.s8)
                Text(L("Welcome")).font(.caption.weight(.semibold)).textCase(.uppercase).foregroundStyle(Theme.ink3)
                Text(L("Would you like sample data to get to know ToHuus?"))
                    .font(Theme.title()).foregroundStyle(Theme.ink)
                    .fixedSize(horizontal: false, vertical: true)
                Text(L("A filled-in example household: a list, things at home and a few recipes. Each sample is marked, and you remove them all with one tap."))
                    .foregroundStyle(Theme.ink2)
                    .fixedSize(horizontal: false, vertical: true)
                VStack(spacing: Theme.Space.s3) {
                    Button {
                        Task { await answer(true) }
                    } label: {
                        HStack {
                            if busy == true { ProgressView().tint(Theme.onPrimary) } else { Image(systemName: "flask") }
                            Text(L("Yes, with samples"))
                        }
                    }
                    .buttonStyle(PrimaryButtonStyle())
                    Button {
                        Task { await answer(false) }
                    } label: {
                        HStack {
                            if busy == false { ProgressView() } else { Image(systemName: "house") }
                            Text(L("No, start empty"))
                        }
                    }
                    .buttonStyle(SecondaryButtonStyle())
                }
                .disabled(busy != nil)
                if let error { ErrorBanner(message: error) }
                Text(busy == true ? L("Filling the sample household …") : L("You can change this later in the settings."))
                    .font(.footnote).foregroundStyle(Theme.ink3)
            }
            .padding(Theme.Space.s5)
            .frame(maxWidth: 560)
            .frame(maxWidth: .infinity)
        }
        .canvasBackground()
        .interactiveDismissDisabled(busy != nil)
    }

    private func sampleTile(_ symbol: String, _ bg: Color) -> some View {
        Image(systemName: symbol)
            .font(.system(size: 26, weight: .medium))
            .foregroundStyle(Theme.primaryText)
            .frame(width: 64, height: 64)
            .background(bg, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
    }

    private func answer(_ demo: Bool) async {
        busy = demo
        defer { busy = nil }
        error = nil
        do {
            try await app.answerSampleQuestion(demo)
            if demo { Haptics.success() }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// The small "Beispiel" tag next to a sample row.
struct SampleTag: View {
    var on: Bool

    var body: some View {
        if on {
            Text(L("Sample"))
                .font(.caption2.weight(.semibold))
                .foregroundStyle(Theme.ink2)
                .lineLimit(1)
                .fixedSize()
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background(Theme.surface2, in: Capsule())
                .overlay(Capsule().stroke(Theme.line, lineWidth: 1))
                .accessibilityLabel(L("Sample data"))
        }
    }
}

/// Heute, once, after a few days with sample data (admins): remove them now, or keep them.
struct SampleNudgeCard: View {
    @Environment(AppModel.self) private var app
    @State private var busy = false
    @State private var done: String?

    var body: some View {
        if app.tour?.demo?.nudge == true || done != nil {
            Card(title: done == nil ? L("Ready for your own things?") : L("Sample data removed"), systemImage: done == nil ? "flask" : "checkmark") {
                if let done {
                    Text(done).font(.subheadline).foregroundStyle(Theme.ink2)
                } else {
                    Text(L("The sample data has done its job. Remove it now – everything you added yourself stays."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                    ViewThatFits(in: .horizontal) {
                        HStack(spacing: Theme.Space.s3) { removeButton; keepButton }
                        VStack(alignment: .leading, spacing: Theme.Space.s2) { removeButton; keepButton }
                    }
                }
            }
        }
    }

    private var removeButton: some View {
        Button {
            Task { await remove() }
        } label: {
            HStack { if busy { ProgressView().tint(Theme.onPrimary) }; Text(L("Remove sample data")) }
        }
        .buttonStyle(PrimaryButtonStyle())
        .disabled(busy)
    }

    private var keepButton: some View {
        Button(L("Keep for now")) { Task { await app.keepSampleData() } }
            .buttonStyle(SecondaryButtonStyle())
            .disabled(busy)
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        if let kept = try? await app.removeSampleData() {
            done = kept > 0 ? LF("Sample data removed – %d things you used stay", kept) : L("Everything you added yourself stays.")
        }
    }
}

/// Mehr › Beispieldaten: remove them with one tap (admins). Only shown while there are sample rows.
struct SampleDataSettingsSection: View {
    @Environment(AppModel.self) private var app
    @State private var confirm = false
    @State private var busy = false
    @State private var message: String?
    /// the household is still empty: offer the example household (web: Settings › Data › DemoCard)
    @State private var empty = false
    @State private var loader = LoadTrigger()

    var body: some View {
        // loads from the body: in a List there is no invisible view to hang a .task on (Design/LoadSlot.swift)
        let _ = loader.run {
            if !app.hasSampleData, app.isHouseholdAdmin, let g = try? await app.api?.gettingStarted() {
                empty = (g.counts?.products ?? 1) == 0
            }
        }
        if app.hasSampleData || message != nil {
            removeSection
        } else if empty && app.isHouseholdAdmin {
            Section {
                Button {
                    Task { await load() }
                } label: {
                    HStack {
                        Label(L("Load sample data"), systemImage: "sparkles")
                        Spacer()
                        if busy { ProgressView() }
                    }
                }
                .disabled(busy)
            } header: {
                Text(L("Look around with sample data"))
            } footer: {
                Text(L("Your household is still empty. Load an example household to try things out – everything it adds is marked and can be removed in one go."))
            }
        }
    }

    private func load() async {
        busy = true
        defer { busy = false }
        do {
            try await app.api?.loadSampleData()
            await app.refreshSamples()
            app.store?.touch("*")
            await app.store?.refreshList()
            empty = false
            message = L("Sample data loaded – it is marked and can be removed any time.")
            Haptics.success()
        } catch {
            message = APIError.from(error).localizedDescription
        }
    }

    @ViewBuilder private var removeSection: some View {
        if app.hasSampleData || message != nil {
            Section {
                if app.hasSampleData {
                    Button(role: .destructive) {
                        confirm = true
                    } label: {
                        HStack {
                            Label(L("Remove sample data"), systemImage: "flask")
                            Spacer()
                            if busy { ProgressView() }
                        }
                    }
                    .disabled(busy || !app.isHouseholdAdmin)
                }
                if let message { Text(message).font(.footnote).foregroundStyle(Theme.ink2) }
            } header: {
                Text(L("Sample data"))
            } footer: {
                if app.hasSampleData {
                    Text(app.isHouseholdAdmin
                         ? LF("%d sample products and %d sample recipes are marked “Sample”. Removing them only deletes what the samples added – nothing you entered yourself.", app.tour?.demo?.products ?? 0, app.tour?.demo?.recipes ?? 0)
                         : L("An admin of your household can remove the sample data."))
                }
            }
            .confirmationDialog(L("Remove sample data?"), isPresented: $confirm, titleVisibility: .visible) {
                Button(L("Remove sample data"), role: .destructive) { Task { await remove() } }
            } message: {
                Text(L("Members, places, settings and everything you added yourself stay."))
            }
        }
    }

    private func remove() async {
        busy = true
        defer { busy = false }
        do {
            let kept = try await app.removeSampleData()
            message = kept > 0 ? LF("Sample data removed – %d things you used stay", kept) : L("Sample data removed")
            Haptics.success()
        } catch {
            message = APIError.from(error).localizedDescription
        }
    }
}
