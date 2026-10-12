import Foundation

/// Server-sent events from /api/events: yields the topic lists of `change` events. Reconnects with backoff until the
/// task is cancelled.
struct EventStream: Sendable {
    let client: APIClient

    func topics() -> AsyncStream<[String]> {
        AsyncStream { continuation in
            let task = Task {
                var delay: UInt64 = 1
                while !Task.isCancelled {
                    do {
                        var req = try client.request("GET", "api/events", timeout: 3600)
                        req.setValue("text/event-stream", forHTTPHeaderField: "Accept")
                        let (bytes, resp) = try await URLSession.shared.bytes(for: req)
                        let status = (resp as? HTTPURLResponse)?.statusCode ?? 0
                        if status == 401 { client.onUnauthorized(); break }
                        guard status == 200 else { throw APIError.server(status: status, message: "events") }
                        delay = 1
                        // a fresh connection may have missed changes – tell listeners to refresh everything
                        continuation.yield(["*"])
                        var event = ""
                        var data = ""
                        for try await line in bytes.lines {
                            if Task.isCancelled { break }
                            if line.hasPrefix("event:") {
                                event = line.dropFirst(6).trimmingCharacters(in: .whitespaces)
                            } else if line.hasPrefix("data:") {
                                data += line.dropFirst(5).trimmingCharacters(in: .whitespaces)
                            } else if line.isEmpty || line.hasPrefix(":") {
                                if !line.hasPrefix(":") {
                                    if event == "change", let topics = Self.parseTopics(data) { continuation.yield(topics) }
                                    event = ""
                                    data = ""
                                }
                            }
                            // URLSession's `lines` skips empty lines, so dispatch as soon as data is complete
                            if event == "change", !data.isEmpty, let topics = Self.parseTopics(data) {
                                continuation.yield(topics)
                                event = ""
                                data = ""
                            }
                        }
                    } catch {
                        if Task.isCancelled { break }
                    }
                    try? await Task.sleep(nanoseconds: delay * 1_000_000_000)
                    delay = min(delay * 2, 60)
                }
                continuation.finish()
            }
            continuation.onTermination = { _ in task.cancel() }
        }
    }

    static func parseTopics(_ data: String) -> [String]? {
        guard let d = data.data(using: .utf8),
              let obj = try? JSONSerialization.jsonObject(with: d) as? [String: Any],
              let topics = obj["topics"] as? [String] else { return nil }
        return topics
    }
}
