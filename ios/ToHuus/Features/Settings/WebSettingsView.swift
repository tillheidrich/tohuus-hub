import SwiftUI
import WebKit

/// Rare settings live in the web app. A bearer token can't become a browser cookie by itself, so:
/// 1. `POST /api/auth/app/web-link { next }` → `{ url, expiresIn: 60 }`: a one-time link (60 s, single use) that turns
///    the app token into a cookie session for the same member and household and redirects to `next`.
/// 2. Older servers without it: the web view opens the server and the person signs in there once; the cookie stays
///    in the app's persistent WKWebsiteDataStore.
/// A WKWebView (not ASWebAuthenticationSession) keeps the person inside the app and needs no callback scheme.
struct WebSettingsView: View {
    let api: APIClient
    @Environment(\.dismiss) private var dismiss

    var body: some View {
        NavigationStack {
            WebPageView(api: api, path: "/einstellungen", title: L("Web settings"))
                .toolbar { ToolbarItem(placement: .confirmationAction) { Button(L("Done")) { dismiss() } } }
        }
    }
}

/// A page of the web app inside the app, signed in with the one-time link – for areas the app does not have natively
/// yet (Pflege, Urlaub with the handover, the handover for guests; docs/ios-parity-2026-10-13.md).
struct WebPageView: View {
    let api: APIClient
    /// web route, e.g. "/pflege"
    let path: String
    let title: String
    @State private var url: URL?

    var body: some View {
        Group {
            if let url {
                WebView(url: url, allowedHost: api.baseURL.host())
            } else {
                ProgressView()
            }
        }
        .navigationTitle(title)
        .navigationBarTitleDisplayMode(.inline)
        .task {
            let clean = path.hasPrefix("/") ? String(path.dropFirst()) : path
            url = await api.webSignInLink(next: path) ?? (try? api.url(clean)) ?? api.baseURL
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
