import Observation
import SwiftUI

@MainActor
@Observable
final class AssistantModel {
    struct Message: Identifiable, Equatable {
        let id = UUID()
        let fromUser: Bool
        var text: String
        var actions: [AssistantAction] = []
        var undone: Set<String> = []
    }

    var messages: [Message] = []
    var input = ""
    private(set) var sending = false
    private(set) var quotaHit = false
    var error: String?
    private var conversationId: String?

    func send(_ text: String, store: ServerStore) async {
        let t = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !t.isEmpty, !sending else { return }
        messages.append(Message(fromUser: true, text: t))
        sending = true
        defer { sending = false }
        do {
            let r = try await store.api.chat(t, conversationId: conversationId)
            receive(r, store: store)
        } catch {
            handle(error)
        }
    }

    func sendVoice(_ audio: Data, store: ServerStore) async {
        sending = true
        defer { sending = false }
        let placeholder = Message(fromUser: true, text: "🎙︎ …")
        messages.append(placeholder)
        do {
            let r = try await store.api.voice(audio, conversationId: conversationId)
            if let i = messages.firstIndex(where: { $0.id == placeholder.id }) {
                messages[i].text = r.text ?? r.transcript ?? L("(voice message)")
            }
            receive(r, store: store)
        } catch {
            handle(error)
        }
    }

    private func receive(_ r: ChatResponse, store: ServerStore) {
        if let c = r.conversationId { conversationId = c.value }
        messages.append(Message(fromUser: false, text: r.reply ?? "", actions: r.actions))
        if !r.actions.isEmpty {
            Haptics.success()
            store.touch("shopping", "stock", "recipes")
            Task { await store.refreshList() }
        }
    }

    private func handle(_ error: Error) {
        let e = APIError.from(error)
        if case .quota = e {
            quotaHit = true
            messages.append(Message(fromUser: false, text: e.localizedDescription))
        } else {
            self.error = e.localizedDescription
        }
    }

    func undo(_ action: AssistantAction, in message: Message, store: ServerStore) async {
        guard let token = action.undo else { return }
        do {
            try await store.api.undo(token)
            if let i = messages.firstIndex(where: { $0.id == message.id }) { messages[i].undone.insert(action.id) }
            store.touch("shopping", "stock", "recipes")
            await store.refreshList()
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

struct AssistantSheet: View {
    @Environment(AppModel.self) private var app
    @Environment(\.dismiss) private var dismiss
    let store: ServerStore
    @State private var model = AssistantModel()
    @State private var dictation = Dictation()
    @State private var showPaywall = false
    @FocusState private var focused: Bool

    var body: some View {
        NavigationStack {
            VStack(spacing: 0) {
                ScrollViewReader { proxy in
                    ScrollView {
                        LazyVStack(alignment: .leading, spacing: Theme.Space.s3) {
                            if model.messages.isEmpty { intro }
                            ForEach(model.messages) { m in bubble(m).id(m.id) }
                            if model.sending { ProgressView().padding(.leading, 8) }
                            if model.quotaHit { quotaHint }
                        }
                        .padding(Theme.Space.s4)
                    }
                    .onChange(of: model.messages.count) { _, _ in
                        if let last = model.messages.last { withAnimation { proxy.scrollTo(last.id, anchor: .bottom) } }
                    }
                }
                if let e = model.error ?? dictation.error {
                    Text(e).font(.footnote).foregroundStyle(Theme.empty).padding(.horizontal)
                }
                inputBar
            }
            .canvasBackground()
            .navigationTitle(L("Assistant"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .sheet(isPresented: $showPaywall) { PaywallView() }
        }
        .presentationDetents([.medium, .large])
        .presentationDragIndicator(.visible)
    }

    private var intro: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s2) {
            Text(L("Just say what's going on at home.")).font(.headline)
            ForEach([L("“Milk is out, and we need something for Sunday.”"), L("“What can we cook today?”"),
                     L("“How much did we spend at Aldi this month?”")], id: \.self) { s in
                Button {
                    Task { await model.send(s.trimmingCharacters(in: CharacterSet(charactersIn: "“”„\"")), store: store) }
                } label: {
                    Text(s).font(.subheadline).foregroundStyle(Theme.primaryText).multilineTextAlignment(.leading)
                }
            }
        }
        .padding(.vertical, Theme.Space.s2)
    }

    private func bubble(_ m: AssistantModel.Message) -> some View {
        HStack {
            if m.fromUser { Spacer(minLength: 40) }
            VStack(alignment: .leading, spacing: 6) {
                Text(m.text).font(.body).foregroundStyle(m.fromUser ? Theme.onPrimary : Theme.ink)
                ForEach(m.actions) { a in
                    HStack(spacing: 6) {
                        Image(systemName: m.undone.contains(a.id) ? "arrow.uturn.backward" : "checkmark.circle")
                            .foregroundStyle(Theme.primaryText)
                        Text(a.summary ?? a.kind ?? "").font(.caption)
                            .strikethrough(m.undone.contains(a.id))
                        Spacer(minLength: 4)
                        if a.undo != nil && !m.undone.contains(a.id) {
                            Button(L("Undo")) { Task { await model.undo(a, in: m, store: store) } }
                                .font(.caption.weight(.semibold))
                        }
                    }
                    .padding(8)
                    .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.sm))
                }
            }
            .padding(Theme.Space.s3)
            .background(m.fromUser ? Theme.primary : Theme.surface, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
            .overlay(RoundedRectangle(cornerRadius: Theme.Radius.lg).stroke(m.fromUser ? Color.clear : Theme.line, lineWidth: 1))
            if !m.fromUser { Spacer(minLength: 40) }
        }
    }

    private var quotaHint: some View {
        Card(title: L("That's all for this month"), systemImage: "sparkles") {
            Text(L("Your plan's assistant messages are used up. The list, receipts and everything else keep working."))
                .font(.subheadline).foregroundStyle(Theme.ink2)
            if app.purchasesAvailable {
                Button(L("See plans")) { showPaywall = true }.buttonStyle(PrimaryButtonStyle())
            }
        }
    }

    private var inputBar: some View {
        HStack(spacing: Theme.Space.s2) {
            if dictation.mode == .listening {
                Text(dictation.transcript.isEmpty ? L("Listening …") : dictation.transcript)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .foregroundStyle(Theme.ink2)
                    .lineLimit(3)
            } else if dictation.mode == .recording {
                Label(L("Recording …"), systemImage: "waveform").frame(maxWidth: .infinity, alignment: .leading).foregroundStyle(Theme.ink2)
            } else {
                TextField(L("Write to ToHuus"), text: $model.input, axis: .vertical)
                    .lineLimit(1...4)
                    .focused($focused)
                    .submitLabel(.send)
                    .onSubmit(sendText)
            }
            if dictation.mode == .idle && !model.input.isEmpty {
                Button(action: sendText) { Image(systemName: "arrow.up.circle.fill").font(.system(size: 32)) }
                    .accessibilityLabel(L("Send"))
                    .disabled(model.sending)
            } else {
                Button(action: toggleMic) {
                    Image(systemName: dictation.mode == .idle ? "mic.circle.fill" : "stop.circle.fill")
                        .font(.system(size: 32))
                        .foregroundStyle(dictation.mode == .idle ? Theme.primary : Theme.clay)
                }
                .accessibilityLabel(dictation.mode == .idle ? L("Speak") : L("Stop"))
                .disabled(model.sending)
            }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.vertical, Theme.Space.s3)
        .background(Theme.surface)
        .overlay(alignment: .top) { Divider() }
    }

    private func sendText() {
        let t = model.input
        model.input = ""
        Task { await model.send(t, store: store) }
    }

    private func toggleMic() {
        if dictation.mode == .idle {
            focused = false
            Task { _ = await dictation.start() }
        } else {
            let result = dictation.stop()
            if let text = result.text {
                Task { await model.send(text, store: store) }
            } else if let audio = result.audio, app.instance?.voiceEnabled ?? true {
                Task { await model.sendVoice(audio, store: store) }
            }
        }
    }
}
