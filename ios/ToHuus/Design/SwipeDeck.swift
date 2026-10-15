import SwiftUI

/// One thing a card can be answered with: a direction to swipe (or none) and an always visible button.
struct SwipeDeckAction: Identifiable, Hashable {
    enum Direction: Hashable { case left, right, up, none }
    let id: String
    let title: String
    let systemImage: String
    var direction: Direction = .none
    /// the main answer (filled button)
    var prominent = false
}

/// Swipe decks (15 Oct 2026), "Tinder-style, but calm": a small stack of cards (at most ten), one decision at a time.
/// Drag left/right (and up when an action wants it) past a threshold with a light tick, a spring back below it.
/// Every action is also an always visible button and a VoiceOver action – swiping is never the only way.
/// Reduce Motion: no rotation and no flying out, the next card simply appears.
/// The web has the same idea in web/src/pages/SwipeDeck.tsx; "Ideen durchblättern" (IdeasDeck.swift) is the endless
/// browsing variant.
///
/// `onAction` returns true when the card is answered (the deck moves on) and false when it failed (the card stays).
struct SwipeDeck<Item: Identifiable, CardContent: View, EndContent: View>: View {
    let items: [Item]
    let actions: [SwipeDeckAction]
    let onAction: @MainActor (Item, SwipeDeckAction) async -> Bool
    @ViewBuilder let card: (Item) -> CardContent
    /// the end state, with how often each action id was chosen
    @ViewBuilder let end: ([String: Int]) -> EndContent

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var index = 0
    @State private var drag: CGSize = .zero
    @State private var busy = false
    @State private var counts: [String: Int] = [:]
    @State private var armed: SwipeDeckAction.Direction = .none

    /// the deck never asks about more than ten things at once
    static var maxCards: Int { 10 }
    private var deck: [Item] { Array(items.prefix(Self.maxCards)) }
    private let threshold: CGFloat = 100

    var body: some View {
        VStack(alignment: .leading, spacing: Theme.Space.s4) {
            if index >= deck.count {
                end(counts)
                    .frame(maxWidth: .infinity)
                    .transition(.opacity)
            } else {
                Text(LF("%d of %d", index + 1, deck.count))
                    .font(.caption.weight(.semibold).monospacedDigit())
                    .foregroundStyle(Theme.ink3)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .accessibilityHidden(true)
                ZStack {
                    if index + 1 < deck.count {
                        frame(card(deck[index + 1]))
                            .scaleEffect(0.96)
                            .offset(y: 10)
                            .opacity(0.7)
                            .accessibilityHidden(true)
                            .allowsHitTesting(false)
                    }
                    frame(card(deck[index]))
                        .overlay(alignment: .top) { stamp }
                        .offset(x: drag.width, y: hasUp ? min(0, drag.height) : drag.height * 0.12)
                        .rotationEffect(.degrees(reduceMotion ? 0 : Double(drag.width / 24)))
                        .gesture(dragGesture)
                        .id(deck[index].id)
                        .accessibilityElement(children: .combine)
                        .accessibilityValue(LF("%d of %d", index + 1, deck.count))
                        .accessibilityActions {
                            ForEach(actions) { a in
                                Button(a.title) { perform(a) }
                            }
                        }
                }
                .frame(maxWidth: 440)
                .frame(maxWidth: .infinity)
                buttons
                    .frame(maxWidth: 440)
                    .frame(maxWidth: .infinity)
            }
        }
        .motion(Motion.standard, value: index)
    }

    private var hasUp: Bool { actions.contains { $0.direction == .up } }

    private func frame(_ content: CardContent) -> some View {
        content
            .padding(Theme.Space.s5)
            .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
            .overlay(RoundedRectangle(cornerRadius: 26, style: .continuous).stroke(Theme.line, lineWidth: 1))
            .shadow(color: .black.opacity(0.06), radius: 10, y: 4)
    }

    /// the answer the card would get when let go now, shown quietly on the card
    @ViewBuilder private var stamp: some View {
        if let a = action(for: direction(of: drag, loose: true)) {
            Label(a.title, systemImage: a.systemImage)
                .font(.subheadline.weight(.semibold))
                .foregroundStyle(a.prominent ? Theme.onPrimary : Theme.primaryText)
                .padding(.horizontal, 12).padding(.vertical, 6)
                .background(a.prominent ? Theme.primary : Theme.primarySoft, in: Capsule())
                .padding(.top, Theme.Space.s3)
                .accessibilityHidden(true)
        }
    }

    private var buttons: some View {
        ViewThatFits(in: .horizontal) {
            HStack(spacing: Theme.Space.s3) { ForEach(ordered) { button($0) } }
            VStack(spacing: Theme.Space.s2) { ForEach(ordered) { button($0) } }
        }
    }

    /// left action on the left, right action on the right, the rest in between
    private var ordered: [SwipeDeckAction] {
        let rank: (SwipeDeckAction) -> Int = { a in
            switch a.direction { case .left: return 0; case .up, .none: return 1; case .right: return 2 }
        }
        return actions.sorted { rank($0) < rank($1) }
    }

    @ViewBuilder private func button(_ a: SwipeDeckAction) -> some View {
        let label = Label(a.title, systemImage: a.systemImage)
            .lineLimit(2)
            .multilineTextAlignment(.center)
            .frame(maxWidth: .infinity, minHeight: 44)
        if a.prominent {
            Button { perform(a) } label: { label }.buttonStyle(PrimaryButtonStyle()).disabled(busy)
        } else {
            Button { perform(a) } label: { label }.buttonStyle(SecondaryButtonStyle()).disabled(busy)
        }
    }

    private func direction(of t: CGSize, loose: Bool = false) -> SwipeDeckAction.Direction {
        let need = loose ? 30 : threshold
        if hasUp && -t.height > need && abs(t.height) > abs(t.width) { return .up }
        if t.width > need { return .right }
        if t.width < -need { return .left }
        return .none
    }

    private func action(for d: SwipeDeckAction.Direction) -> SwipeDeckAction? {
        d == .none ? nil : actions.first { $0.direction == d }
    }

    private var dragGesture: some Gesture {
        DragGesture(minimumDistance: 12)
            .onChanged { v in
                guard !busy else { return }
                drag = v.translation
                let d = direction(of: v.translation)
                if d != armed {
                    armed = d
                    if d != .none, action(for: d) != nil { Haptics.tick() }
                }
            }
            .onEnded { v in
                guard !busy else { return }
                armed = .none
                if let a = action(for: direction(of: v.translation)) {
                    perform(a)
                } else if reduceMotion {
                    drag = .zero
                } else {
                    withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) { drag = .zero }
                }
            }
    }

    private func perform(_ a: SwipeDeckAction) {
        guard !busy, index < deck.count else { return }
        let item = deck[index]
        busy = true
        Haptics.tick()
        // the card leaves in its direction while the answer is saved (none with Reduce Motion)
        if !reduceMotion {
            let out: CGSize
            switch a.direction {
            case .left: out = CGSize(width: -700, height: 0)
            case .right: out = CGSize(width: 700, height: 0)
            case .up: out = CGSize(width: 0, height: -900)
            case .none: out = drag
            }
            withAnimation(.easeOut(duration: 0.22)) { drag = out }
        }
        Task { @MainActor in
            let ok = await onAction(item, a)
            busy = false
            if ok {
                counts[a.id, default: 0] += 1
                drag = .zero
                index += 1
                if index < deck.count { A11yTiming.announce(LF("%d of %d", index + 1, deck.count)) }
            } else if reduceMotion {
                drag = .zero
            } else {
                withAnimation(.spring(response: 0.35, dampingFraction: 0.75)) { drag = .zero }
            }
        }
    }
}

/// The quiet end of a deck: a symbol, one sentence, optionally a line below.
struct SwipeDeckEnd: View {
    var systemImage = "checkmark.circle"
    let title: String
    var message: String?

    var body: some View {
        VStack(spacing: Theme.Space.s3) {
            Image(systemName: systemImage)
                .font(.system(size: 40, weight: .light))
                .foregroundStyle(Theme.primaryText)
                .accessibilityHidden(true)
            Text(title).font(.title3.weight(.semibold)).foregroundStyle(Theme.ink).multilineTextAlignment(.center)
                .accessibilityAddTraits(.isHeader)
            if let message {
                Text(message).font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(Theme.Space.s6)
        .frame(maxWidth: .infinity)
        .accessibilityElement(children: .combine)
    }
}
