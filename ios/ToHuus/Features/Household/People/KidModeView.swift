import AVFoundation
import SwiftUI

/// Which device is a kid tablet: the server address and the device token from POST /api/kids/:id/devices.
/// Kept on the device (the kid lock) – the app shows only kid mode until a grown-up enters the parent PIN
/// (POST /api/kid/:token/exit) or removes the tablet (then /api/kid/:token answers 404).
@MainActor
@Observable
final class KidModeStore {
    static let shared = KidModeStore()
    private static let baseKey = "kidMode.base"
    private static let tokenKey = "kidMode.token"

    struct Session: Equatable {
        let base: URL
        let token: String
    }

    private(set) var session: Session?

    private init() {
        let d = UserDefaults.standard
        if let b = d.string(forKey: Self.baseKey).flatMap(URL.init(string:)), let t = d.string(forKey: Self.tokenKey), !t.isEmpty {
            session = Session(base: b, token: t)
        }
    }

    func enter(base: URL, token: String) {
        UserDefaults.standard.set(base.absoluteString, forKey: Self.baseKey)
        UserDefaults.standard.set(token, forKey: Self.tokenKey)
        session = Session(base: base, token: token)
    }

    func leave() {
        UserDefaults.standard.removeObject(forKey: Self.baseKey)
        UserDefaults.standard.removeObject(forKey: Self.tokenKey)
        session = nil
    }

    /// "https://host/kids/<token>" (the web's pairing link) → server address + token
    nonisolated static func parse(_ text: String) -> (base: URL, token: String)? {
        guard let url = URL(string: text.trimmingCharacters(in: .whitespacesAndNewlines)),
              let scheme = url.scheme, scheme == "https" || scheme == "http", url.host() != nil else { return nil }
        let parts = url.path.split(separator: "/").map(String.init)
        guard let i = parts.lastIndex(of: "kids"), i + 1 < parts.count else { return nil }
        let token = parts[i + 1]
        guard token.count >= 8, token.allSatisfy({ $0.isLetter || $0.isNumber || $0 == "-" || $0 == "_" || $0 == "." }) else { return nil }
        var comps = URLComponents()
        comps.scheme = scheme
        comps.host = url.host()
        comps.port = url.port
        comps.path = parts[..<i].isEmpty ? "" : "/" + parts[..<i].joined(separator: "/")
        guard let base = comps.url else { return nil }
        return (base, token)
    }
}

/// While this device is a kid tablet, the whole app is kid mode (sheets and tabs of the grown-up app are gone).
private struct KidModeGate: ViewModifier {
    @State private var kidMode = KidModeStore.shared

    @ViewBuilder func body(content: Content) -> some View {
        if let s = kidMode.session {
            KidModeView(session: s)
                .transition(.opacity)
        } else {
            content
        }
    }
}

extension View {
    /// Put on the app's root view (ToHuusApp › RootView): shows KidModeView instead while the device is a kid tablet.
    func kidModeGate() -> some View { modifier(KidModeGate()) }
}

/// Kid mode on an iPad or iPhone: big picture tiles, "I'd like …" wishes a grown-up approves, a friendly picture status,
/// quiet hours with a moon, an optional "Where is …?" grid, read aloud. No points, no stars, no ranking.
/// Web: pages/Kids.tsx (KidMode). GET /api/kid/:token, POST …/wish, POST …/exit.
struct KidModeView: View {
    let session: KidModeStore.Session
    @Environment(\.scenePhase) private var scenePhase
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Environment(\.horizontalSizeClass) private var sizeClass
    @State private var api: APIClient
    @State private var home: KidHome?
    @State private var gone = false
    @State private var offline = false
    /// 0 I'd like … · 1 Where is …? · 2 To do ("Jetzt", docs/now.md)
    @State private var tab = 0
    @State private var tabChosen = false
    @State private var pick: KidHome.Tile?
    @State private var sent: KidHome.Tile?
    @State private var nope: (id: Int, text: String)?
    @State private var showExit = false
    @State private var speech = KidSpeech()

    init(session: KidModeStore.Session) {
        self.session = session
        _api = State(initialValue: APIClient(baseURL: session.base))
    }

    private var tint: Color { Color(hexString: home?.kid.color) ?? Theme.mustard }
    private var reads: Bool { home?.kid.ageBand == "reads" }
    private var columns: [GridItem] { [GridItem(.adaptive(minimum: sizeClass == .regular ? 190 : 140), spacing: Theme.Space.s4)] }

    var body: some View {
        ZStack {
            tint.opacity(0.12).ignoresSafeArea()
            Theme.canvas.opacity(0.6).ignoresSafeArea()
            if gone {
                center(icon: "lock.fill", title: L("This tablet is no longer in kid mode"), text: L("A grown-up can pair it again in the app.")) {
                    Button(L("Open ToHuus")) { KidModeStore.shared.leave() }.buttonStyle(PrimaryButtonStyle()).frame(maxWidth: 280)
                }
            } else if let h = home {
                content(h)
            } else if offline {
                center(icon: "cloud.sun.fill", title: L("Hmm, no connection"), text: nil) {
                    Button(L("Try again")) { Task { await load() } }.buttonStyle(SecondaryButtonStyle()).frame(maxWidth: 240)
                }
            } else {
                ProgressView().controlSize(.large)
            }
            if let p = pick { confirm(p) }
            if let s = sent { sentOverlay(s) }
        }
        .persistentSystemOverlays(.hidden)
        .statusBarHidden()
        .task {
            while !Task.isCancelled {
                await load()
                try? await Task.sleep(nanoseconds: 20_000_000_000)
            }
        }
        .onChange(of: scenePhase) { _, p in if p == .active { Task { await load() } } }
        .sheet(isPresented: $showExit) {
            KidExitPad(api: api, token: session.token, hasPin: home?.kid.hasPin == true) {
                showExit = false
                KidModeStore.shared.leave()
            }
        }
    }

    // MARK: main screen

    @ViewBuilder private func content(_ h: KidHome) -> some View {
        VStack(spacing: Theme.Space.s4) {
            topBar(h)
            if !h.wishes.isEmpty { wishStrip(h) }
            let withTasks = !(h.tasks?.queue.isEmpty ?? true) || (tab == 2 && h.tasks != nil)
            if (!h.find.isEmpty || withTasks) && h.quiet == nil {
                Picker("", selection: Binding(get: { tab }, set: { tab = $0; speech.say($0 == 2 ? L("To do") : $0 == 0 ? L("I’d like …") : L("Where is …?")) })) {
                    if withTasks { Text(L("To do")).tag(2) }
                    Text(L("I’d like …")).tag(0)
                    if !h.find.isEmpty { Text(L("Where is …?")).tag(1) }
                }
                .pickerStyle(.segmented)
                .controlSize(.large)
                .frame(maxWidth: 420)
            }
            if let q = h.quiet {
                quiet(q.until)
            } else if tab == 2, let tasks = h.tasks {
                KidNowPanel(api: api, token: session.token, initial: tasks, reads: reads) { speech.say($0) }
            } else if tab == 1 && !h.find.isEmpty {
                ScrollView { LazyVGrid(columns: columns, spacing: Theme.Space.s4) { ForEach(h.find) { findTile($0) } }.padding(.bottom, Theme.Space.s6) }
            } else if h.tiles.isEmpty {
                center(icon: "cloud.sun.fill", title: L("Nothing here right now"), text: L("Ask a grown-up.")) { EmptyView() }
            } else {
                ScrollView { LazyVGrid(columns: columns, spacing: Theme.Space.s4) { ForEach(h.tiles) { tile($0) } }.padding(.bottom, Theme.Space.s6) }
            }
        }
        .padding(.horizontal, Theme.Space.s4)
        .padding(.top, Theme.Space.s3)
    }

    private func topBar(_ h: KidHome) -> some View {
        HStack(spacing: Theme.Space.s3) {
            KidAnimalView(animal: h.kid.avatar, color: h.kid.color, size: 56)
            Text(h.kid.name).font(.system(size: 30, weight: .heavy, design: .rounded)).foregroundStyle(Theme.ink)
            Spacer()
            if h.kid.speak == true {
                Button { speech.toggle() } label: {
                    Image(systemName: speech.on ? "speaker.wave.2.fill" : "speaker.slash.fill")
                        .font(.title2.weight(.bold))
                        .frame(width: 56, height: 56)
                        .background(Theme.surface, in: Circle())
                }
                .buttonStyle(.plain)
                .accessibilityLabel(speech.on ? L("Read aloud: on") : L("Read aloud: off"))
            }
            Button { showExit = true } label: {
                Image(systemName: "lock.fill").font(.body)
                    .foregroundStyle(Theme.ink3)
                    .frame(width: 48, height: 48)
                    .background(Theme.surface.opacity(0.6), in: Circle())
            }
            .buttonStyle(.plain)
            .accessibilityLabel(L("For grown-ups"))
        }
    }

    private func wishStrip(_ h: KidHome) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s3) {
                ForEach(h.wishes.prefix(4)) { w in
                    let v = KidWishView.of(w.view)
                    Button { speech.say("\(w.name): \(v.text)") } label: {
                        HStack(spacing: Theme.Space.s2) {
                            KidPictureView(imagePath: w.imagePath, art: w.art, api: api).frame(width: 52, height: 52)
                            Image(systemName: v.icon).font(.title2).foregroundStyle(v.color)
                            if reads { Text(v.text).font(.subheadline.weight(.semibold)).foregroundStyle(Theme.ink).lineLimit(2) }
                        }
                        .padding(.horizontal, Theme.Space.s3).padding(.vertical, Theme.Space.s2)
                        .background(Theme.surface, in: RoundedRectangle(cornerRadius: 20))
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel("\(w.name): \(v.text)")
                }
            }
        }
        .accessibilityElement(children: .contain)
    }

    private func tile(_ t: KidHome.Tile) -> some View {
        let off = (t.state ?? "ok") != "ok"
        let wiggle = nope?.id == t.id
        return Button { tap(t) } label: {
            VStack(spacing: Theme.Space.s2) {
                KidPictureView(imagePath: t.imagePath, art: t.art, api: api)
                    .frame(maxWidth: .infinity)
                    .frame(height: sizeClass == .regular ? 140 : 100)
                    .opacity(off ? 0.45 : 1)
                Text(t.name)
                    .font(reads ? .title3.weight(.bold) : .headline)
                    .foregroundStyle(reads ? Theme.ink : Theme.ink2)
                    .lineLimit(2).multilineTextAlignment(.center)
            }
            .padding(Theme.Space.s4)
            .frame(maxWidth: .infinity, minHeight: sizeClass == .regular ? 220 : 170)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 28))
            .overlay(RoundedRectangle(cornerRadius: 28).stroke(tint.opacity(0.35), lineWidth: 2))
            .overlay(alignment: .topTrailing) {
                if off {
                    HStack(spacing: 4) {
                        Image(systemName: t.state == "later" ? "clock.fill" : t.state == "enough" ? "sun.horizon.fill" : "hourglass")
                        if t.state == "later", let u = t.until { Text(u).font(.headline) }
                    }
                    .font(.title2)
                    .foregroundStyle(Theme.ink2)
                    .padding(Theme.Space.s3)
                }
            }
            .overlay(alignment: .bottom) {
                if wiggle, let n = nope {
                    Text(n.text).font(.headline).foregroundStyle(Theme.onBlock)
                        .padding(.horizontal, Theme.Space.s3).padding(.vertical, Theme.Space.s2)
                        .background(Theme.block, in: Capsule())
                        .padding(Theme.Space.s2)
                        .transition(.opacity)
                }
            }
            .rotationEffect(.degrees(wiggle && !reduceMotion ? 2 : 0))
            .animation(reduceMotion ? nil : .spring(response: 0.18, dampingFraction: 0.3), value: wiggle)
        }
        .buttonStyle(.plain)
        .accessibilityLabel(KidWishView.stateText(t))
    }

    private func findTile(_ f: KidHome.Find) -> some View {
        Button { speech.say([f.name, f.place?.name, f.spot].compactMap { $0 }.joined(separator: ". ")) } label: {
            VStack(spacing: Theme.Space.s2) {
                ZStack(alignment: .bottomTrailing) {
                    Group {
                        if let ph = f.place?.photo {
                            RemoteImage(url: api.imageURL(ph), api: api, placeholder: "shippingbox")
                        } else {
                            Image(systemName: "shippingbox").font(.system(size: 54)).foregroundStyle(Theme.sage)
                                .frame(maxWidth: .infinity, maxHeight: .infinity).background(Theme.surface2)
                        }
                    }
                    .frame(height: sizeClass == .regular ? 140 : 100)
                    .clipShape(RoundedRectangle(cornerRadius: 18))
                    KidPictureView(imagePath: f.imagePath, art: "plate", api: api)
                        .frame(width: 56, height: 56)
                        .background(Theme.surface, in: Circle())
                        .padding(6)
                }
                Text(f.name).font(.title3.weight(.bold)).foregroundStyle(Theme.ink).lineLimit(2)
                if let p = f.place?.name {
                    Text(reads && f.spot != nil ? "\(p) · \(f.spot ?? "")" : p).font(.subheadline).foregroundStyle(Theme.ink2).lineLimit(2)
                }
            }
            .padding(Theme.Space.s3)
            .frame(maxWidth: .infinity)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 28))
        }
        .buttonStyle(.plain)
        .accessibilityLabel([f.name, f.place?.name, f.spot].compactMap { $0 }.joined(separator: ", "))
    }

    private func quiet(_ until: String?) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Spacer()
            Image(systemName: "moon.stars.fill").font(.system(size: 120)).foregroundStyle(Theme.mustard)
                .accessibilityHidden(true)
            Text(L("Sleepy time")).font(.system(size: 40, weight: .heavy, design: .rounded))
            if let u = until { Text(LF("Wishes again from %@", u)).font(.title3).foregroundStyle(Theme.ink2) }
            Spacer()
        }
        .frame(maxWidth: .infinity)
        .contentShape(Rectangle())
        .onTapGesture { speech.say(LF("Sleepy time. Wishes again from %@.", until ?? "")) }
        .accessibilityElement(children: .combine)
    }

    private func center<A: View>(icon: String, title: String, text: String?, @ViewBuilder action: () -> A) -> some View {
        VStack(spacing: Theme.Space.s4) {
            Image(systemName: icon).font(.system(size: 64)).foregroundStyle(Theme.sage).accessibilityHidden(true)
            Text(title).font(.title.weight(.bold)).multilineTextAlignment(.center)
            if let text { Text(text).foregroundStyle(Theme.ink2).multilineTextAlignment(.center) }
            action()
        }
        .padding(Theme.Space.s6)
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    // MARK: overlays

    private func confirm(_ t: KidHome.Tile) -> some View {
        ZStack {
            Color.black.opacity(0.35).ignoresSafeArea().onTapGesture { pick = nil }
            VStack(spacing: Theme.Space.s5) {
                KidPictureView(imagePath: t.imagePath, art: t.art, api: api).frame(width: 180, height: 180)
                Text(LF("I’d like %@", t.name)).font(.system(size: 30, weight: .heavy, design: .rounded)).multilineTextAlignment(.center)
                HStack(spacing: Theme.Space.s8) {
                    Button { pick = nil } label: {
                        Image(systemName: "xmark").font(.system(size: 40, weight: .bold))
                            .foregroundStyle(Theme.ink2)
                            .frame(width: 96, height: 96)
                            .background(Theme.surface2, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L("No"))
                    Button { Task { await send(t) } } label: {
                        Image(systemName: "checkmark").font(.system(size: 48, weight: .bold))
                            .foregroundStyle(Theme.onPrimary)
                            .frame(width: 116, height: 116)
                            .background(Theme.primary, in: Circle())
                    }
                    .buttonStyle(.plain)
                    .accessibilityLabel(L("Yes, please"))
                }
            }
            .padding(Theme.Space.s8)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 36))
            .padding(Theme.Space.s6)
            .accessibilityAddTraits(.isModal)
        }
        .transition(.opacity)
    }

    private func sentOverlay(_ t: KidHome.Tile) -> some View {
        ZStack {
            Color.black.opacity(0.25).ignoresSafeArea().onTapGesture { sent = nil }
            VStack(spacing: Theme.Space.s4) {
                Image(systemName: "hourglass").font(.system(size: 64, weight: .bold)).foregroundStyle(Theme.mustard)
                KidPictureView(imagePath: t.imagePath, art: t.art, api: api).frame(width: 100, height: 100)
                Text(L("Asked!")).font(.system(size: 34, weight: .heavy, design: .rounded))
                Text(L("A grown-up will answer soon.")).font(.title3).foregroundStyle(Theme.ink2)
            }
            .padding(Theme.Space.s8)
            .background(Theme.surface, in: RoundedRectangle(cornerRadius: 36))
            .padding(Theme.Space.s6)
            .accessibilityElement(children: .combine)
        }
        .transition(.opacity)
        .task(id: t.id) {
            try? await Task.sleep(nanoseconds: 3_500_000_000)
            if sent?.id == t.id { withAnimation { sent = nil } }
        }
    }

    // MARK: actions

    /// 404: the tablet was removed (or the profile deleted) – kid mode ends here
    nonisolated static func isGone(_ error: Error) -> Bool {
        guard let e = error as? APIError else { return false }
        switch e {
        case .notFound: return true
        case .server(let status, _): return status == 404
        default: return false
        }
    }

    private func load() async {
        do {
            let h = try await api.kidHome(token: session.token)
            home = h
            // "Jetzt" first when there is something to do – decided once, the child switches freely after that
            if !tabChosen {
                tabChosen = true
                if h.tasks?.next != nil { tab = 2 }
            }
            TaskTimerLive.endExpired()
            offline = false
            speech.language = h.language
            speech.allowed = h.kid.speak == true
        } catch {
            if Self.isGone(error) { gone = true } else if home == nil { offline = true }
        }
    }

    private func tap(_ t: KidHome.Tile) {
        if (t.state ?? "ok") != "ok" {
            showNope(t.id, KidWishView.stateText(t))
            return
        }
        Haptics.tick()
        withAnimation(.easeOut(duration: 0.15)) { pick = t }
        speech.say(LF("I’d like %@", t.name))
    }

    private func showNope(_ id: Int, _ text: String) {
        nope = (id, text)
        speech.say(text)
        Task {
            try? await Task.sleep(nanoseconds: 2_300_000_000)
            if nope?.id == id { withAnimation { nope = nil } }
        }
    }

    private func send(_ t: KidHome.Tile) async {
        pick = nil
        do {
            if let refused = try await api.kidWish(token: session.token, productId: t.id) {
                showNope(t.id, KidWishView.stateText(KidHome.Tile(id: t.id, name: t.name, imagePath: nil, art: nil, category: nil, state: refused.state, until: refused.until)))
            } else {
                Haptics.success()
                withAnimation { sent = t }
                speech.say(L("Asked! A grown-up will answer soon."))
            }
        } catch {
            if Self.isGone(error) { gone = true } else { showNope(t.id, L("That didn’t work – try again")) }
        }
        await load()
    }
}

/// How a wish looks on the tablet, and the texts for tiles that can't be wished for right now.
enum KidWishView {
    struct Look { let icon: String; let text: String; let color: Color }

    static func of(_ view: String?) -> Look {
        switch view {
        case "coming": return Look(icon: "hand.thumbsup.fill", text: L("Yes! It’s coming"), color: Theme.primary)
        case "here": return Look(icon: "face.smiling.inverse", text: L("Here you go!"), color: Theme.mustard)
        case "later": return Look(icon: "cloud.sun.fill", text: L("Maybe later"), color: Theme.info)
        default: return Look(icon: "hourglass", text: L("Asked – waiting for a grown-up"), color: Theme.warning)
        }
    }

    static func stateText(_ t: KidHome.Tile) -> String {
        switch t.state {
        case "later": return t.until.map { LF("Not yet – from %@", $0) } ?? L("Not right now")
        case "enough": return L("That’s it for today – tomorrow again")
        case "busy": return L("Wait a little – a grown-up is still answering")
        case "quiet": return L("Sleepy time")
        case "empty": return L("All gone right now")
        case nil, "ok": return t.name
        default: return L("Not right now")
        }
    }
}

/// Reads the tapped name aloud in the household language (only when the parents allowed it; the kid can mute it).
@MainActor
@Observable
final class KidSpeech {
    private let synth = AVSpeechSynthesizer()
    var language: String?
    var allowed = false
    private(set) var muted = UserDefaults.standard.bool(forKey: "kidMode.muted")

    var on: Bool { allowed && !muted }

    func toggle() {
        muted.toggle()
        UserDefaults.standard.set(muted, forKey: "kidMode.muted")
        if muted { synth.stopSpeaking(at: .immediate) }
    }

    func say(_ text: String) {
        guard on, !text.isEmpty else { return }
        synth.stopSpeaking(at: .immediate)
        let u = AVSpeechUtterance(string: text)
        u.voice = AVSpeechSynthesisVoice(language: language ?? Locale.preferredLanguages.first ?? "de")
        u.rate = AVSpeechUtteranceDefaultSpeechRate * 0.92
        u.pitchMultiplier = 1.05
        synth.speak(u)
    }
}

/// "Für Große": the parent PIN leaves kid mode on this device (web: Kids.tsx ExitPad).
struct KidExitPad: View {
    let api: APIClient
    let token: String
    let hasPin: Bool
    let done: () -> Void
    @Environment(\.dismiss) private var dismiss
    @State private var pin = ""
    @State private var error: String?
    @State private var busy = false

    var body: some View {
        NavigationStack {
            VStack(spacing: Theme.Space.s5) {
                if hasPin {
                    Text(L("Enter the PIN to leave kid mode on this tablet.")).font(.subheadline).foregroundStyle(Theme.ink2).multilineTextAlignment(.center)
                    HStack(spacing: 14) {
                        ForEach(0..<max(4, pin.count), id: \.self) { i in
                            Circle().fill(i < pin.count ? Theme.ink : Color.clear)
                                .overlay(Circle().stroke(Theme.ink2, lineWidth: 1.5))
                                .frame(width: 16, height: 16)
                        }
                    }
                    .accessibilityElement()
                    .accessibilityLabel(LF("%d digits entered", pin.count))
                    if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
                    LazyVGrid(columns: Array(repeating: GridItem(.fixed(76), spacing: 16), count: 3), spacing: 14) {
                        ForEach(["1", "2", "3", "4", "5", "6", "7", "8", "9"], id: \.self) { n in key(n) }
                        Button { if !pin.isEmpty { pin.removeLast() } } label: {
                            Image(systemName: "delete.left").font(.title2).frame(width: 76, height: 64)
                        }
                        .accessibilityLabel(L("Delete"))
                        key("0")
                        Button { Task { await check() } } label: {
                            Image(systemName: "checkmark").font(.title2.weight(.bold))
                                .foregroundStyle(Theme.onPrimary)
                                .frame(width: 76, height: 64)
                                .background(pin.count >= 4 ? Theme.primary : Theme.sage, in: RoundedRectangle(cornerRadius: 16))
                        }
                        .disabled(pin.count < 4 || busy)
                        .accessibilityLabel(L("OK"))
                    }
                    .buttonStyle(.plain)
                } else {
                    Text(L("No PIN is set for this profile. To end kid mode, remove this tablet in the app under Settings › Household › Who lives here?."))
                        .multilineTextAlignment(.center)
                }
                Spacer(minLength: 0)
            }
            .padding(Theme.Space.s5)
            .navigationTitle(L("For grown-ups"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
        }
        .presentationDetents([.large])
    }

    private func key(_ n: String) -> some View {
        Button { if pin.count < 8 { pin.append(n) } } label: {
            Text(n).font(.title.weight(.semibold)).foregroundStyle(Theme.ink)
                .frame(width: 76, height: 64)
                .background(Theme.surface2, in: RoundedRectangle(cornerRadius: 16))
        }
    }

    private func check() async {
        busy = true
        defer { busy = false }
        do {
            if let msg = try await api.kidExit(token: token, pin: pin) {
                error = msg
                pin = ""
            } else {
                done()
            }
        } catch let e where KidModeView.isGone(e) {
            done()
        } catch {
            self.error = APIError.from(error).localizedDescription
            pin = ""
        }
    }
}
