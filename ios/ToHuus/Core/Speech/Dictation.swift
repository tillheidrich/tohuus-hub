import AVFoundation
import Foundation
import Observation
import Speech

/// On-device dictation (SFSpeechRecognizer, de-DE/en) for the assistant. When speech recognition is not available
/// it records an m4a with AVAudioRecorder, which the server transcribes (/api/assistant/voice).
@MainActor
@Observable
final class Dictation {
    enum Mode { case idle, listening, recording }

    private(set) var mode: Mode = .idle
    private(set) var transcript = ""
    private(set) var error: String?

    @ObservationIgnored private var engine: AVAudioEngine?
    @ObservationIgnored private var request: SFSpeechAudioBufferRecognitionRequest?
    @ObservationIgnored private var task: SFSpeechRecognitionTask?
    @ObservationIgnored private var recorder: AVAudioRecorder?
    @ObservationIgnored private var recordingURL: URL?

    private var recognizer: SFSpeechRecognizer? {
        let preferred = Locale.preferredLanguages.first ?? "de-DE"
        let id = preferred.hasPrefix("en") ? "en-US" : "de-DE"
        return SFSpeechRecognizer(locale: Locale(identifier: id))
    }

    /// Starts listening. Returns false when nothing could be started (no permission).
    func start() async -> Bool {
        error = nil
        transcript = ""
        guard await Self.micAllowed() else {
            error = L("ToHuus may not use the microphone. You can allow it in Settings.")
            return false
        }
        let speechOK = await Self.speechAllowed()
        if speechOK, let r = recognizer, r.isAvailable {
            do {
                try startRecognition(r)
                mode = .listening
                return true
            } catch {
                stopEngine()
            }
        }
        do {
            try startRecording()
            mode = .recording
            return true
        } catch {
            self.error = error.localizedDescription
            return false
        }
    }

    /// Stops. Returns the recognised text, or the recorded audio for server-side transcription.
    func stop() -> (text: String?, audio: Data?) {
        defer { mode = .idle }
        switch mode {
        case .listening:
            request?.endAudio()
            let text = transcript.trimmingCharacters(in: .whitespacesAndNewlines)
            stopEngine()
            return (text.isEmpty ? nil : text, nil)
        case .recording:
            recorder?.stop()
            recorder = nil
            deactivate()
            guard let url = recordingURL else { return (nil, nil) }
            let data = try? Data(contentsOf: url)
            try? FileManager.default.removeItem(at: url)
            return (nil, data)
        case .idle:
            return (nil, nil)
        }
    }

    func cancel() {
        _ = stop()
        transcript = ""
    }

    private func startRecognition(_ recognizer: SFSpeechRecognizer) throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)
        let req = SFSpeechAudioBufferRecognitionRequest()
        req.shouldReportPartialResults = true
        if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
        request = req
        let engine = AVAudioEngine()
        self.engine = engine
        let input = engine.inputNode
        let format = input.outputFormat(forBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: format, block: Self.tapBlock(req))
        engine.prepare()
        try engine.start()
        task = recognizer.recognitionTask(with: req, resultHandler: Self.resultHandler { [weak self] text in
            if let text { self?.transcript = text }
        })
    }

    /// Built outside the main actor: results arrive on a background queue; only the text hops to the main actor.
    nonisolated private static func resultHandler(_ apply: @escaping @MainActor @Sendable (String?) -> Void) -> @Sendable (SFSpeechRecognitionResult?, Error?) -> Void {
        { result, _ in
            let text = result?.bestTranscription.formattedString
            Task { @MainActor in apply(text) }
        }
    }

    /// Built outside the main actor: the tap runs on an audio thread.
    nonisolated private static func tapBlock(_ req: SFSpeechAudioBufferRecognitionRequest) -> AVAudioNodeTapBlock {
        { buffer, _ in req.append(buffer) }
    }

    private func stopEngine() {
        engine?.stop()
        engine?.inputNode.removeTap(onBus: 0)
        engine = nil
        task?.cancel()
        task = nil
        request = nil
        deactivate()
    }

    private func startRecording() throws {
        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .default)
        try session.setActive(true)
        let url = FileManager.default.temporaryDirectory.appendingPathComponent("tohuus-voice-\(UUID().uuidString).m4a")
        let settings: [String: Any] = [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 16000,
            AVNumberOfChannelsKey: 1,
            AVEncoderAudioQualityKey: AVAudioQuality.medium.rawValue,
        ]
        let rec = try AVAudioRecorder(url: url, settings: settings)
        rec.record(forDuration: 60)
        recorder = rec
        recordingURL = url
    }

    private func deactivate() {
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
    }

    nonisolated private static func micAllowed() async -> Bool {
        await AVAudioApplication.requestRecordPermission()
    }

    /// nonisolated: the system calls the permission answer on a background queue. Inside this @MainActor class a
    /// closure would inherit the main actor and the runtime traps (TestFlight crash 14.10., build 6).
    nonisolated private static func speechAllowed() async -> Bool {
        await withCheckedContinuation { (c: CheckedContinuation<Bool, Never>) in
            SFSpeechRecognizer.requestAuthorization { @Sendable status in c.resume(returning: status == .authorized) }
        }
    }
}
