import CoreImage
import SwiftUI
import UIKit

/// Mehr › "Server & Haushalte": the active household (and the others of this account), further servers or accounts
/// this iPhone is signed in to (one tap to switch, the active one stays saved), "add another" and a QR code to
/// connect another device. Works the same for ToHuus Cloud and an own server.
struct ConnectionsView: View {
    @Environment(AppModel.self) private var app
    @State private var saved: [SavedConnection] = []
    @State private var adding = false
    @State private var switching: String?
    @State private var confirm: SavedConnection?
    @State private var error: String?

    var body: some View {
        List {
            Section {
                HStack(spacing: Theme.Space.s3) {
                    icon(cloud: app.isCloud)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(app.activeHousehold?.name ?? L("Household")).font(.body.weight(.semibold))
                        Text(currentSubtitle).font(.caption).foregroundStyle(Theme.ink2)
                    }
                    Spacer(minLength: 0)
                    Text(L("active")).font(.caption.weight(.semibold)).foregroundStyle(Theme.primaryText)
                }
                .accessibilityElement(children: .combine)
                if app.households.count > 1 {
                    ForEach(app.households.filter { $0.id.value != app.activeHousehold?.id.value }) { h in
                        Button {
                            app.switchHousehold(h)
                            Haptics.tick()
                        } label: {
                            HStack {
                                Label(h.name ?? h.id.value, systemImage: "house")
                                Spacer()
                                Text(L("Switch")).font(.subheadline).foregroundStyle(Theme.primaryText)
                            }
                        }
                        .foregroundStyle(Theme.ink)
                    }
                }
            } header: {
                Text(L("Now"))
            } footer: {
                if app.households.count > 1 { Text(L("Your households on this server. Lists, pantry and money stay apart.")) }
            }

            if !saved.isEmpty {
                Section {
                    ForEach(saved) { c in
                        Button {
                            confirm = c
                        } label: {
                            HStack(spacing: Theme.Space.s3) {
                                icon(cloud: c.isCloud)
                                VStack(alignment: .leading, spacing: 2) {
                                    Text(c.title).font(.body.weight(.semibold)).foregroundStyle(Theme.ink)
                                    if !c.subtitle.isEmpty { Text(c.subtitle).font(.caption).foregroundStyle(Theme.ink2) }
                                }
                                Spacer(minLength: 0)
                                if switching == c.id { ProgressView() }
                            }
                        }
                        .disabled(switching != nil)
                        .swipeActions {
                            Button(role: .destructive) {
                                ConnectionVault.remove(id: c.id)
                                saved = app.savedConnections
                            } label: { Label(L("Remove"), systemImage: "trash") }
                        }
                    }
                } header: {
                    Text(L("Also on this iPhone"))
                } footer: {
                    Text(L("Tap to switch. Only one is active at a time – notifications come from the active one. Swipe to remove one from this iPhone."))
                }
            }

            Section {
                Button {
                    adding = true
                } label: {
                    Label(L("Add a server or account"), systemImage: "plus.circle")
                }
                if app.instance?.auth?.appPair?.bool == true, let api = app.api {
                    NavigationLink {
                        PairCodeView(api: api)
                    } label: {
                        Label(L("Connect another iPhone or iPad"), systemImage: "qrcode")
                    }
                }
            } footer: {
                Text(L("ToHuus Cloud or your own server. What you use now stays here, one tap away."))
            }
            if let error { Section { Text(error).foregroundStyle(Theme.empty) } }
        }
        .themedList()
        .navigationTitle(L("Servers & households"))
        .onAppear { saved = app.savedConnections }
        .sheet(isPresented: $adding, onDismiss: { saved = app.savedConnections }) {
            StartView(adding: true)
        }
        .confirmationDialog(confirm.map { LF("Switch to %@?", $0.title) } ?? "", isPresented: Binding(get: { confirm != nil }, set: { if !$0 { confirm = nil } }), titleVisibility: .visible) {
            if let c = confirm {
                Button(L("Switch")) { Task { await open(c) } }
            }
        } message: {
            Text(L("Changes that haven't been sent yet are sent first when you come back."))
        }
    }

    private var currentSubtitle: String {
        [app.userName, app.isCloud ? L("ToHuus Cloud") : app.session?.serverURL.host()].compactMap { $0 }.filter { !$0.isEmpty }.joined(separator: " · ")
    }

    private func icon(cloud: Bool) -> some View {
        Image(systemName: cloud ? "cloud" : "server.rack")
            .foregroundStyle(Theme.primaryText)
            .frame(width: 36, height: 36)
            .background(Theme.primarySoft, in: RoundedRectangle(cornerRadius: Theme.Radius.base))
            .accessibilityHidden(true)
    }

    private func open(_ c: SavedConnection) async {
        switching = c.id
        defer { switching = nil }
        error = nil
        await app.store?.flush()
        if !(await app.openSaved(c)) {
            error = L("This sign-in has expired. Please sign in again.")
            saved = app.savedConnections
        }
    }
}

/// "Weiteres Gerät verbinden": a one-time QR code (POST /api/auth/app/pair) the other iPhone or iPad scans on its start
/// screen – the same code the web app shows.
struct PairCodeView: View {
    let api: APIClient
    @State private var pair: PairCode?
    @State private var until: Date?
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        ScrollView {
            VStack(spacing: Theme.Space.s4) {
                Text(L("On the other device: open ToHuus, tap “Scan QR code” and point it here. No address or password to type."))
                    .foregroundStyle(Theme.ink2)
                    .multilineTextAlignment(.center)
                    .fixedSize(horizontal: false, vertical: true)
                if let pair, let img = PairQR.make(pair.url) {
                    Image(uiImage: img)
                        .interpolation(.none)
                        .resizable()
                        .scaledToFit()
                        .frame(maxWidth: 260)
                        .padding(12)
                        .background(Color.white, in: RoundedRectangle(cornerRadius: Theme.Radius.lg))
                        .accessibilityLabel(L("QR code for the other device"))
                    Text(pair.code).font(.title2.monospaced().weight(.semibold)).foregroundStyle(Theme.ink)
                        .textSelection(.enabled)
                        .accessibilityLabel(LF("Code %@", pair.code.map(String.init).joined(separator: " ")))
                    if let until {
                        TimelineView(.periodic(from: .now, by: 1)) { ctx in
                            let left = max(0, Int(until.timeIntervalSince(ctx.date)))
                            Text(left > 0 ? LF("Works once, for %d more minutes.", max(1, (left + 59) / 60)) : L("This code has expired."))
                                .font(.footnote).foregroundStyle(Theme.ink3)
                        }
                    }
                    Button(L("New code")) { Task { await load() } }.disabled(busy)
                } else if let error {
                    ErrorBanner(message: error) { Task { await load() } }
                } else {
                    ProgressView().padding(Theme.Space.s8)
                }
            }
            .padding(Theme.Space.s5)
            .frame(maxWidth: 520)
            .frame(maxWidth: .infinity)
        }
        .canvasBackground()
        .navigationTitle(L("Connect another device"))
        .navigationBarTitleDisplayMode(.inline)
        .task { await load() }
    }

    private func load() async {
        busy = true
        defer { busy = false }
        error = nil
        do {
            let p = try await api.createPairCode()
            pair = p
            until = Date().addingTimeInterval(TimeInterval(p.expiresIn ?? 600))
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}

/// CoreImage QR for the pairing link.
enum PairQR {
    static func make(_ text: String) -> UIImage? {
        guard let f = CIFilter(name: "CIQRCodeGenerator") else { return nil }
        f.setValue(Data(text.utf8), forKey: "inputMessage")
        f.setValue("M", forKey: "inputCorrectionLevel")
        guard let out = f.outputImage?.transformed(by: CGAffineTransform(scaleX: 8, y: 8)),
              let cg = CIContext().createCGImage(out, from: out.extent) else { return nil }
        return UIImage(cgImage: cg)
    }
}
