import SwiftUI

/// "Was davon ist noch wichtig?" (server: lib/mind.ts mindReview, docs/mind.md): my open thoughts older than a week,
/// one card at a time. Right = "Noch wichtig" (asked again in two weeks at the earliest), left = "Loslassen" (deleted),
/// up = "Erledigt". Letting go is allowed – nothing here is counted.
struct MindReviewView: View {
    let api: APIClient
    var onChanged: () -> Void = {}
    @State private var items: [MindItem]?
    @State private var error: String?

    private let actions = [
        SwipeDeckAction(id: "letgo", title: L("Let go"), systemImage: "leaf", direction: .left),
        SwipeDeckAction(id: "done", title: L("Completed"), systemImage: "checkmark", direction: .up),
        SwipeDeckAction(id: "keep", title: L("Still important"), systemImage: "brain", direction: .right, prominent: true),
    ]

    var body: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: Theme.Space.s4) {
                VStack(alignment: .leading, spacing: 4) {
                    Text(L("What of this still matters?")).font(Theme.title(Theme.FontSize.h2)).foregroundStyle(Theme.ink)
                        .accessibilityAddTraits(.isHeader)
                    Text(L("Letting go is allowed. Swipe right for still important, left to let go, up when it’s done – or use the buttons."))
                        .font(.subheadline).foregroundStyle(Theme.ink2)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let error { ErrorBanner(message: error) { Task { await load() } } }
                if let items {
                    if items.isEmpty {
                        SwipeDeckEnd(systemImage: "brain", title: L("Nothing to look at right now."),
                                     message: L("Thoughts older than a week show up here now and then."))
                    } else {
                        SwipeDeck(items: items, actions: actions, onAction: act) { x in
                            VStack(alignment: .leading, spacing: Theme.Space.s3) {
                                Image(systemName: "brain").font(.title2).foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                                Text(x.text).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink)
                                    .fixedSize(horizontal: false, vertical: true)
                                Text(sub(x)).font(.caption).foregroundStyle(Theme.ink3)
                            }
                        } end: { counts in
                            SwipeDeckEnd(systemImage: "leaf", title: L("Your head is a little lighter."),
                                         message: summary(counts))
                        }
                    }
                } else if error == nil {
                    ProgressView().frame(maxWidth: .infinity).padding(.top, 40)
                }
            }
            .padding(Theme.Space.s4)
            .padding(.bottom, 80)
        }
        .canvasBackground()
        .navigationTitle(L("On my mind"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func sub(_ x: MindItem) -> String {
        [ServerDate.relative(x.createdAt).map { LF("written down %@", $0) },
         x.dueOn.map { LF("by %@", ServerDate.shortDay($0) ?? $0) },
         x.visibility == "private" ? L("only for you") : nil].compactMap { $0 }.joined(separator: " · ")
    }

    private func summary(_ c: [String: Int]) -> String {
        [c["keep"].map { LF("%d still important", $0) },
         c["done"].map { LF("%d done", $0) },
         c["letgo"].map { LF("%d let go", $0) }].compactMap { $0 }.joined(separator: " · ")
    }

    private func act(_ x: MindItem, _ a: SwipeDeckAction) async -> Bool {
        do {
            switch a.id {
            case "keep": try await api.mindKeep(x.id)
            case "done": try await api.mindUpdate(x.id, ["kind": "done"])
            default: try await api.mindDelete(x.id)
            }
            error = nil
            onChanged()
            return true
        } catch {
            self.error = APIError.from(error).localizedDescription
            return false
        }
    }

    private func load() async {
        do {
            items = try await api.mindReview().items
            error = nil
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// The way in: a quiet row when there are older thoughts to look at (MindView, the Im Kopf card on Heute).
struct MindReviewLink: View {
    let api: APIClient
    let count: Int
    var onChanged: () -> Void = {}

    var body: some View {
        NavigationLink { MindReviewView(api: api, onChanged: onChanged) } label: {
            HStack(spacing: Theme.Space.s3) {
                Image(systemName: "rectangle.stack").foregroundStyle(Theme.primaryText).accessibilityHidden(true)
                VStack(alignment: .leading, spacing: 2) {
                    Text(L("What of this still matters?")).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink)
                    Text(count == 1 ? L("1 older thought – letting go is allowed.") : LF("%d older thoughts – letting go is allowed.", count))
                        .font(.caption).foregroundStyle(Theme.ink3)
                }
                Spacer(minLength: 0)
                Image(systemName: "chevron.right").font(.caption).foregroundStyle(Theme.ink3).accessibilityHidden(true)
            }
            .frame(minHeight: 44)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
    }
}
