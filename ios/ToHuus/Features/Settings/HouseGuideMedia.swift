import AVFoundation
import AVKit
import CoreTransferable
import PhotosUI
import SwiftUI
import UniformTypeIdentifiers

/// Photos and short videos on a house info card (server: POST/PATCH/DELETE /api/house-guide/cards/:id/media,
/// docs/house-guide.md › Photos and videos). Same visibility as the card. Videos are made smaller on the iPhone
/// (720p) before they are sent – the server takes up to 100 MB per file, that is about 5 minutes after shrinking.
struct HGMedia: Decodable, Sendable, Hashable, Identifiable {
    var id: Int
    /// photo | video
    var kind: String
    /// `/img/…` – for the app signed by the server (`?h=…&e=…&s=…`)
    var url: String
    var caption: String?

    var isVideo: Bool { kind == "video" }
}

enum HGMediaLimits {
    static let maxBytes = 100 * 1024 * 1024
    static let perCard = 8
}

extension APIClient {
    /// POST /api/house-guide/cards/:id/media – multipart `file` (+ `caption`)
    func uploadHouseMedia(card: Int, data: Data, filename: String, mime: String, caption: String? = nil) async throws -> HGMedia {
        var mp = Multipart()
        mp.addFile("file", filename: filename, mimeType: mime, data: data)
        if let caption, !caption.isEmpty { mp.addField("caption", caption) }
        return try await upload("api/house-guide/cards/\(card)/media", multipart: mp, timeout: 600)
    }

    func deleteHouseMedia(card: Int, media: Int) async throws {
        _ = try await send("DELETE", "api/house-guide/cards/\(card)/media/\(media)", as: Ignored.self)
    }
}

// MARK: showing

/// Thumbnails under a card; a tap opens the photo or plays the video.
struct HGMediaStrip: View {
    let media: [HGMedia]
    let title: String
    @Environment(AppModel.self) private var app
    @State private var open: HGMedia?

    var body: some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: Theme.Space.s2) {
                ForEach(media) { m in
                    Button { open = m } label: { HGMediaThumb(media: m, api: app.api) }
                        .buttonStyle(.plain)
                        .accessibilityLabel(m.isVideo ? LF("Video: %@", m.caption ?? title) : LF("Photo: %@", m.caption ?? title))
                }
            }
        }
        .sheet(item: $open) { m in HGMediaViewer(media: m, api: app.api) }
    }
}

struct HGMediaThumb: View {
    let media: HGMedia
    let api: APIClient?
    var size: CGFloat = 96

    var body: some View {
        ZStack {
            if media.isVideo {
                Theme.surface2
                Image(systemName: "play.circle.fill").font(.system(size: 34)).foregroundStyle(Theme.primary)
            } else {
                RemoteImage(url: api?.imageURL(media.url), api: api)
            }
        }
        .frame(width: size, height: size)
        .clipShape(RoundedRectangle(cornerRadius: Theme.Radius.base))
    }
}

/// Full screen: a photo, or the video with the system player (signed URL – no token needed).
struct HGMediaViewer: View {
    let media: HGMedia
    let api: APIClient?
    @Environment(\.dismiss) private var dismiss
    @State private var player: AVPlayer?

    var body: some View {
        NavigationStack {
            VStack(spacing: Theme.Space.s3) {
                if media.isVideo {
                    if let player {
                        VideoPlayer(player: player).onAppear { player.play() }
                    } else {
                        ProgressView()
                    }
                } else {
                    RemoteImage(url: api?.imageURL(media.url), api: api).scaledToFit()
                }
                if let c = media.caption, !c.isEmpty {
                    Text(c).font(.subheadline).foregroundStyle(Theme.ink2).padding(.horizontal)
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
            .background(Color.black.opacity(media.isVideo ? 1 : 0))
            .toolbar { ToolbarItem(placement: .cancellationAction) { Button(L("Close")) { dismiss() } } }
            .onAppear {
                if media.isVideo, let url = api?.imageURL(media.url) { player = AVPlayer(url: url) }
            }
            .onDisappear { player?.pause() }
        }
    }
}

// MARK: adding (card editor)

/// A movie from the photo library, copied to a temporary file.
struct PickedMovie: Transferable {
    let url: URL
    static var transferRepresentation: some TransferRepresentation {
        FileRepresentation(contentType: .movie) { movie in
            SentTransferredFile(movie.url)
        } importing: { received in
            let dest = FileManager.default.temporaryDirectory.appendingPathComponent("hg-\(UUID().uuidString).\(received.file.pathExtension.isEmpty ? "mov" : received.file.pathExtension)")
            try FileManager.default.copyItem(at: received.file, to: dest)
            return PickedMovie(url: dest)
        }
    }
}

enum VideoShrink {
    /// 720p MP4 – a minute of 4K from the camera (~400 MB) becomes ~20 MB.
    static func shrink(_ source: URL) async throws -> URL {
        let asset = AVURLAsset(url: source)
        guard let export = AVAssetExportSession(asset: asset, presetName: AVAssetExportPreset1280x720) else { return source }
        let out = FileManager.default.temporaryDirectory.appendingPathComponent("hg-\(UUID().uuidString).mp4")
        export.outputURL = out
        export.outputFileType = .mp4
        export.shouldOptimizeForNetworkUse = true
        await withCheckedContinuation { (done: CheckedContinuation<Void, Never>) in
            export.exportAsynchronously { done.resume() }
        }
        if export.status == .completed { return out }
        throw export.error ?? CocoaError(.fileWriteUnknown)
    }
}

/// "Fotos und Videos" in the card editor – the limit is said before anyone picks.
struct HGCardMediaSection: View {
    let api: APIClient
    let cardId: Int?
    @State var media: [HGMedia]
    @State private var picks: [PhotosPickerItem] = []
    @State private var busy: String?
    @State private var error: String?

    var body: some View {
        Section {
            if cardId == nil {
                Text(L("Save the card first, then add photos and videos.")).font(.footnote).foregroundStyle(Theme.ink2)
            } else {
                if !media.isEmpty {
                    ScrollView(.horizontal, showsIndicators: false) {
                        HStack(spacing: Theme.Space.s2) {
                            ForEach(media) { m in
                                HGMediaThumb(media: m, api: api, size: 80)
                                    .overlay(alignment: .topTrailing) {
                                        Button { Task { await remove(m) } } label: {
                                            Image(systemName: "xmark.circle.fill").font(.title3).symbolRenderingMode(.palette)
                                                .foregroundStyle(.white, Color.black.opacity(0.55))
                                        }
                                        .accessibilityLabel(L("Remove"))
                                        .padding(2)
                                    }
                            }
                        }
                    }
                }
                if let busy {
                    HStack(spacing: Theme.Space.s2) { ProgressView(); Text(busy).font(.footnote) }
                } else if media.count < HGMediaLimits.perCard {
                    PhotosPicker(selection: $picks, maxSelectionCount: HGMediaLimits.perCard - media.count, matching: .any(of: [.images, .videos])) {
                        Label(L("Add a photo or video"), systemImage: "photo.badge.plus")
                    }
                }
                if let error { Text(error).font(.footnote).foregroundStyle(Theme.empty) }
            }
        } header: {
            Text(L("Photos and videos"))
        } footer: {
            Text(LF("Photos, and videos of about 5 minutes – the app makes them smaller before sending (up to 100 MB). Up to %d per card. Who sees the card sees them too.", HGMediaLimits.perCard))
        }
        .onChange(of: picks) { _, items in
            guard !items.isEmpty, let cardId else { return }
            picks = []
            Task { await add(items, card: cardId) }
        }
    }

    private func add(_ items: [PhotosPickerItem], card: Int) async {
        error = nil
        for (i, item) in items.enumerated() {
            let n = items.count > 1 ? " (\(i + 1)/\(items.count))" : ""
            do {
                if item.supportedContentTypes.contains(where: { $0.conforms(to: .movie) }) {
                    busy = L("Making the video smaller …") + n
                    guard let movie = try await item.loadTransferable(type: PickedMovie.self) else { continue }
                    let small = try await VideoShrink.shrink(movie.url)
                    defer {
                        try? FileManager.default.removeItem(at: movie.url)
                        if small != movie.url { try? FileManager.default.removeItem(at: small) }
                    }
                    let data = try Data(contentsOf: small, options: .mappedIfSafe)
                    if data.count > HGMediaLimits.maxBytes {
                        error = L("Even made smaller, this video is larger than 100 MB. Shorten it in Photos (Edit › trim) and add it again.")
                        continue
                    }
                    busy = L("Sending …") + n
                    media.append(try await api.uploadHouseMedia(card: card, data: data, filename: "video.mp4", mime: "video/mp4"))
                } else {
                    busy = L("Sending …") + n
                    guard let raw = try await item.loadTransferable(type: Data.self), let img = UIImage(data: raw),
                          let jpeg = img.jpegData(compressionQuality: 0.85) else { continue }
                    media.append(try await api.uploadHouseMedia(card: card, data: jpeg, filename: "photo.jpg", mime: "image/jpeg"))
                }
                Haptics.success()
            } catch {
                self.error = APIError.from(error).localizedDescription
            }
        }
        busy = nil
    }

    private func remove(_ m: HGMedia) async {
        guard let cardId else { return }
        do {
            try await api.deleteHouseMedia(card: cardId, media: m.id)
            media.removeAll { $0.id == m.id }
        } catch {
            self.error = APIError.from(error).localizedDescription
        }
    }
}
