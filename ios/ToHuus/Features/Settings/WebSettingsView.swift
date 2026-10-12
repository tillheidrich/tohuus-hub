import SwiftUI
import WebKit

/// Rare settings live in the web app. A bearer token can't become a browser cookie by itself, so:
/// 1. If the server offers `POST /api/auth/app/web-link` (one-time sign-in link for the signed-in device), the web view
///    opens that link and is signed in at once.
/// 2. Otherwise the web view opens the server and the person signs in there once; the cookie stays in the app's
///    persistent WKWebsiteDataStore, so it is a one-time step.
/// A WKWebView (not ASWebAuthenticationSession) keeps the person inside the app and needs no callback scheme.
struct WebSettingsView: View {
    let api: APIClient
    @Environment(\.dismiss) private var dismiss
    @State private var url: URL?

    var body: some View {
        NavigationStack {
            Group {
                if let url {
                    WebView(url: url, allowedHost: api.baseURL.host())
                } else {
                    ProgressView()
                }
            }
            .navigationTitle(L("Web settings"))
            .navigationBarTitleDisplayMode(.inline)
            .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
            .task {
                url = await api.webSignInLink() ?? (try? api.url("einstellungen")) ?? api.baseURL
            }
        }
    }
}

struct WebView: UIViewRepresentable {
    let url: URL
    let allowedHost: String?

    func makeUIView(context: Context) -> WKWebView {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .default()
        let view = WKWebView(frame: .zero, configuration: config)
        view.navigationDelegate = context.coordinator
        view.allowsBackForwardNavigationGestures = true
        view.load(URLRequest(url: url))
        return view
    }

    func updateUIView(_ view: WKWebView, context: Context) {}

    func makeCoordinator() -> Coordinator { Coordinator(allowedHost: allowedHost) }

    @MainActor
    final class Coordinator: NSObject, WKNavigationDelegate {
        let allowedHost: String?
        init(allowedHost: String?) { self.allowedHost = allowedHost }

        /// Links to other sites open in Safari, not inside the settings view.
        func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction) async -> WKNavigationActionPolicy {
            guard let url = action.request.url, let host = url.host() else { return .allow }
            if host == allowedHost || url.scheme == "about" { return .allow }
            if action.navigationType == .linkActivated {
                await UIApplication.shared.open(url)
                return .cancel
            }
            return .allow
        }
    }
}
