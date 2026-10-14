@preconcurrency import CoreNFC
import SwiftUI

// NFC tags (14 Oct 2026, docs/nfc.md): a tag carries the same link as a ToHuus QR label (".../q/<code>") – a random
// id, nothing else. Write it here, hold the iPhone to it later: in the app ("Read NFC tag") or from the lock screen
// (iOS reads tags in the background; with ToHuus Cloud the link opens the app, otherwise the web app).

enum NFCLabels {
    static var available: Bool { NFCNDEFReaderSession.readingAvailable }

    /// Reads the first link on a tag.
    @MainActor static func read() async throws -> String {
        try await NFCLabelSession.run(.read)
    }

    /// Writes one link onto a tag (overwrites what's on it; locked tags are refused).
    @MainActor static func write(_ url: String) async throws {
        _ = try await NFCLabelSession.run(.write(url))
    }
}

struct NFCError: LocalizedError {
    var message: String
    var errorDescription: String? { message }
}

private final class NFCLabelSession: NSObject, NFCNDEFReaderSessionDelegate, @unchecked Sendable {
    enum Mode {
        case read
        case write(String)
    }

    private let mode: Mode
    private var session: NFCNDEFReaderSession?
    private var cont: CheckedContinuation<String, Error>?
    private let lock = NSLock()
    /// keeps the running session alive until it ends
    @MainActor private static var current: NFCLabelSession?

    private init(_ mode: Mode) { self.mode = mode }

    @MainActor static func run(_ mode: Mode) async throws -> String {
        guard NFCNDEFReaderSession.readingAvailable else { throw NFCError(message: L("This iPhone can't read NFC tags.")) }
        let s = NFCLabelSession(mode)
        current = s
        defer { current = nil }
        return try await withCheckedThrowingContinuation { c in
            s.cont = c
            let session = NFCNDEFReaderSession(delegate: s, queue: nil, invalidateAfterFirstRead: false)
            switch mode {
            case .read: session.alertMessage = L("Hold your iPhone near the tag.")
            case .write: session.alertMessage = L("Hold your iPhone near the tag to write the label onto it.")
            }
            s.session = session
            session.begin()
        }
    }

    private func finish(_ r: Result<String, Error>) {
        lock.lock()
        let c = cont
        cont = nil
        lock.unlock()
        c?.resume(with: r)
    }

    func readerSession(_ session: NFCNDEFReaderSession, didInvalidateWithError error: Error) {
        if let e = error as? NFCReaderError, e.code == .readerSessionInvalidationErrorUserCanceled || e.code == .readerSessionInvalidationErrorFirstNDEFTagRead {
            finish(.failure(CancellationError()))
        } else {
            finish(.failure(error))
        }
    }

    func readerSession(_ session: NFCNDEFReaderSession, didDetectNDEFs messages: [NFCNDEFMessage]) {}

    func readerSession(_ session: NFCNDEFReaderSession, didDetect tags: [NFCNDEFTag]) {
        guard let tag = tags.first else { return }
        if tags.count > 1 {
            session.alertMessage = L("More than one tag – hold only one near the iPhone.")
            session.restartPolling()
            return
        }
        session.connect(to: tag) { [self] err in
            if err != nil {
                session.invalidate(errorMessage: L("Couldn't connect. Please try again."))
                return
            }
            tag.queryNDEFStatus { [self] status, _, err in
                if err != nil || status == .notSupported {
                    session.invalidate(errorMessage: L("This tag doesn't work with ToHuus."))
                    return
                }
                switch mode {
                case .read:
                    tag.readNDEF { [self] message, _ in
                        let link = message?.records.compactMap { $0.wellKnownTypeURIPayload()?.absoluteString }.first
                        guard let link else {
                            session.invalidate(errorMessage: L("There's no ToHuus label on this tag."))
                            return
                        }
                        session.alertMessage = L("Got it.")
                        session.invalidate()
                        finish(.success(link))
                    }
                case .write(let link):
                    guard status == .readWrite else {
                        session.invalidate(errorMessage: L("This tag is locked and can't be written."))
                        return
                    }
                    guard let url = URL(string: link), let payload = NFCNDEFPayload.wellKnownTypeURIPayload(url: url) else {
                        session.invalidate(errorMessage: L("Couldn't write the tag."))
                        return
                    }
                    tag.writeNDEF(NFCNDEFMessage(records: [payload])) { [self] err in
                        if err != nil {
                            session.invalidate(errorMessage: L("Couldn't write the tag."))
                        } else {
                            session.alertMessage = L("Done – the tag now opens this label.")
                            session.invalidate()
                            finish(.success(link))
                        }
                    }
                }
            }
        }
    }
}

/// "Auf NFC-Tag schreiben" for one label (LabelsView) – asks the server for the label's link, then writes it.
struct NFCWriteButton: View {
    let api: APIClient
    let kind: String
    let id: Int
    var onResult: (String) -> Void

    var body: some View {
        if NFCLabels.available {
            Button {
                Task { await write() }
            } label: { Label(L("NFC tag"), systemImage: "wave.3.right") }
                .buttonStyle(.bordered)
                .accessibilityLabel(L("Write onto an NFC tag"))
        }
    }

    private func write() async {
        do {
            guard let label = try await api.qrLabels(kind: kind, ids: [id]).first else { return }
            try await NFCLabels.write(label.url)
            onResult(L("The tag is ready. Hold your iPhone to it to open the label."))
        } catch is CancellationError {
        } catch let e as APIError { onResult(e.localizedDescription) } catch { onResult(error.localizedDescription) }
    }
}
