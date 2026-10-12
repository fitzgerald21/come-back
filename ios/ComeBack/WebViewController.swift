import UIKit
import WebKit
import GoogleSignIn

/// Hosts the web app and bridges the few things a web view can't do on its own:
/// Google sign-in (Google refuses OAuth inside embedded web views) and keeping the screen awake.
final class WebViewController: UIViewController, WKScriptMessageHandler, WKNavigationDelegate, WKUIDelegate {
    private var webView: WKWebView!
    private let background = UIColor(red: 0.051, green: 0.102, blue: 0.122, alpha: 1)

    // Web app calls navigator.wakeLock.request("screen"); route that to the idle timer.
    private let wakeLockShim = """
    (function () {
      var post = function (m) { window.webkit.messageHandlers.native.postMessage(m); };
      Object.defineProperty(navigator, "wakeLock", { configurable: true, value: {
        request: function () {
          post({ type: "wake", on: true });
          return Promise.resolve({ release: function () { post({ type: "wake", on: false }); return Promise.resolve(); } });
        }
      } });
      window.CB_NATIVE = true;
    })();
    """

    override func loadView() {
        let config = WKWebViewConfiguration()
        config.setURLSchemeHandler(AppSchemeHandler(), forURLScheme: AppSchemeHandler.scheme)
        config.allowsInlineMediaPlayback = true
        config.mediaTypesRequiringUserActionForPlayback = []
        config.userContentController.addUserScript(WKUserScript(source: wakeLockShim, injectionTime: .atDocumentStart, forMainFrameOnly: true))
        config.userContentController.add(self, name: "native")

        webView = WKWebView(frame: .zero, configuration: config)
        webView.navigationDelegate = self
        webView.uiDelegate = self
        webView.isOpaque = false
        webView.backgroundColor = background
        webView.scrollView.backgroundColor = background
        webView.scrollView.contentInsetAdjustmentBehavior = .never
        webView.scrollView.bounces = false
        webView.scrollView.minimumZoomScale = 1
        webView.scrollView.maximumZoomScale = 1
        webView.allowsLinkPreview = false
        if #available(iOS 16.4, *) { webView.isInspectable = true }
        view = webView
        webView.load(URLRequest(url: URL(string: "\(AppSchemeHandler.scheme)://localhost/index.html")!))
    }

    override var prefersStatusBarHidden: Bool { false }
    override var preferredStatusBarStyle: UIStatusBarStyle { .lightContent }

    // MARK: JS -> native

    func userContentController(_ ucc: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any], let type = body["type"] as? String else { return }
        switch type {
        case "wake":
            UIApplication.shared.isIdleTimerDisabled = (body["on"] as? Bool) ?? false
        case "signIn":
            signIn()
        case "signOut":
            GIDSignIn.sharedInstance.signOut()
        default:
            break
        }
    }

    private func signIn() {
        GIDSignIn.sharedInstance.signIn(withPresenting: self) { [weak self] result, error in
            guard let self = self else { return }
            guard let user = result?.user, let idToken = user.idToken?.tokenString else {
                let code = (error as NSError?)?.code
                let cancelled = code == GIDSignInError.canceled.rawValue
                self.call("window.CB_NATIVE_SIGNIN_FAILED && window.CB_NATIVE_SIGNIN_FAILED(cancelled)", ["cancelled": cancelled])
                return
            }
            self.call("window.CB_NATIVE_SIGNIN && window.CB_NATIVE_SIGNIN(idToken, accessToken)",
                      ["idToken": idToken, "accessToken": user.accessToken.tokenString])
        }
    }

    private func call(_ js: String, _ args: [String: Any]) {
        webView.callAsyncJavaScript(js, arguments: args, in: nil, in: .page, completionHandler: nil)
    }

    // MARK: navigation

    /// Top-level links to anywhere other than the bundled app (iframes, such as Firebase's, are left alone) open in Safari instead of replacing the app.
    func webView(_ webView: WKWebView, decidePolicyFor action: WKNavigationAction, decisionHandler: @escaping (WKNavigationActionPolicy) -> Void) {
        if action.targetFrame?.isMainFrame == true, let url = action.request.url, let scheme = url.scheme, scheme != AppSchemeHandler.scheme, scheme != "about", scheme != "blob", scheme != "data" {
            UIApplication.shared.open(url)
            decisionHandler(.cancel)
        } else {
            decisionHandler(.allow)
        }
    }

    /// iOS can kill the web content process while the app is in the background, leaving a blank view. Bring the app back;
    /// the page restores an unfinished sit from its saved state.
    func webViewWebContentProcessDidTerminate(_ webView: WKWebView) {
        UIApplication.shared.isIdleTimerDisabled = false
        webView.load(URLRequest(url: URL(string: "\(AppSchemeHandler.scheme)://localhost/index.html")!))
    }

    func webView(_ webView: WKWebView, createWebViewWith configuration: WKWebViewConfiguration, for action: WKNavigationAction, windowFeatures: WKWindowFeatures) -> WKWebView? {
        if let url = action.request.url { UIApplication.shared.open(url) }
        return nil
    }
}
