import AppIntents
import Foundation

/// Siri / Shortcuts: "Setz etwas auf die ToHuus-Liste" → asks what → puts it on the shared list.
/// Uses the stored token; without a connection the change waits in the app's offline queue.
struct AddToListIntent: AppIntent {
    static let title: LocalizedStringResource = "Add to the shopping list"
    static let description = IntentDescription("Puts something on your household's ToHuus list, e.g. “2 milk and bread”.")
    static let openAppWhenRun = false

    @Parameter(title: "What", requestValueDialog: IntentDialog("What should go on the list?"))
    var item: String

    static var parameterSummary: some ParameterSummary {
        Summary("Put \(\.$item) on the list")
    }

    @MainActor
    func perform() async throws -> some IntentResult & ProvidesDialog {
        let text = item.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !text.isEmpty else { return .result(dialog: IntentDialog(stringLiteral: L("Nothing was added."))) }
        guard let session = SessionInfo.load(), let token = SessionInfo.token else {
            return .result(dialog: IntentDialog(stringLiteral: L("Please sign in to the ToHuus app first.")))
        }
        let api = APIClient(baseURL: session.serverURL, token: token, householdId: session.householdId)
        let ops = QuickAddParser.fragments(text).map { $0.trimmingCharacters(in: .whitespaces) }.filter { !$0.isEmpty }
            .map { PendingOp.add($0, localId: -Int.random(in: 100_000...999_999)) }
        do {
            _ = try await api.sync(ops)
            return .result(dialog: IntentDialog(stringLiteral: LF("“%@” is on the list.", text)))
        } catch APIError.offline {
            let cache = ShoppingCache(householdKey: session.householdId ?? session.serverURL.host() ?? "default")
            var queue = cache.loadOps()
            for op in ops { queue = OpQueueLogic.enqueue(op, into: queue) }
            cache.saveOps(queue)
            return .result(dialog: IntentDialog(stringLiteral: LF("No connection – “%@” will be sent as soon as you're online.", text)))
        }
    }
}

struct ToHuusShortcuts: AppShortcutsProvider {
    static var appShortcuts: [AppShortcut] {
        AppShortcut(
            intent: AddToListIntent(),
            phrases: [
                "Add something to the \(.applicationName) list",
                "Put something on my \(.applicationName) list",
            ],
            shortTitle: "Add to list",
            systemImageName: "cart.badge.plus"
        )
    }
}
