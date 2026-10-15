import SwiftUI

/// Geld, flat shares only: "Wer liegt vorn" – who paid what for the shared household this month and who gives whom how
/// much (web: shop/forms.tsx WgBalanceCard, GET /api/wg/balance). Sentences, never payments: ToHuus moves no money.
/// Hidden for other household forms, for guests and when nobody paid anything yet.
struct WgBalanceCard: View {
    let api: APIClient
    /// "YYYY-MM"; nil = this month
    var month: String?
    @State private var balance: WgBalance?
    @State private var shared = false

    var body: some View {
        Group {
            if shared, let b = balance, b.people.contains(where: { ($0.paid ?? 0) != 0 }) {
                Card(title: L("Who is ahead"), systemImage: "person.2") {
                    VStack(alignment: .leading, spacing: Theme.Space.s2) {
                        ForEach(b.people) { p in
                            HStack(alignment: .firstTextBaseline) {
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(p.name).font(.subheadline.weight(.semibold))
                                    Text(LF("paid %@ · share %@", Money.format(p.paid ?? 0), Money.format(p.share ?? 0)))
                                        .font(.caption).foregroundStyle(Theme.ink3)
                                }
                                Spacer()
                                let v = p.balance ?? 0
                                Text((v >= 0 ? "+" : "") + Money.format(v))
                                    .font(.subheadline.weight(.semibold)).monospacedDigit()
                                    .foregroundStyle(v >= 0 ? Theme.primaryText : Theme.empty)
                            }
                            .accessibilityElement(children: .combine)
                        }
                        if !b.settle.isEmpty {
                            Divider()
                            ForEach(b.settle, id: \.self) { s in
                                Label(LF("%@ gives %@ %@", s.from, s.to, Money.format(s.amount)), systemImage: "arrow.right")
                                    .font(.subheadline)
                            }
                        }
                        Text(L("From your receipts. ToHuus never moves money – settle it however you like."))
                            .font(.caption).foregroundStyle(Theme.ink3)
                    }
                }
            }
        }
        .task(id: month ?? "") {
            let me = try? await api.meLite()
            shared = me?.home?["form"]?.string == "shared" && me?.isMember == true
            guard shared else { balance = nil; return }
            balance = try? await api.wgBalance(month: month)
        }
    }
}
