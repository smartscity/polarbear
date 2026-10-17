import AppKit
import WebKit

// Test-only host matching the production translator's hidden NSWindow lifecycle.
final class Probe: NSObject, WKScriptMessageHandler, WKNavigationDelegate {
    private var window: NSWindow!
    private var activity: NSObjectProtocol?

    func run(url: URL, policy: String) {
        let configuration = WKWebViewConfiguration()
        if policy == "disabled" {
            guard #available(macOS 14.0, *) else {
                fputs("Native background policy requires macOS 14 or newer\n", stderr)
                exit(2)
            }
            configuration.preferences.inactiveSchedulingPolicy = .none
        }
        configuration.userContentController.add(self, name: "probe")
        let frame = NSRect(x: 0, y: 0, width: 640, height: 480)
        let view = WKWebView(frame: frame, configuration: configuration)
        view.navigationDelegate = self
        window = NSWindow(contentRect: frame, styleMask: [.titled], backing: .buffered, defer: false)
        window.contentView = view
        // Keep the host awake as active audio capture would, without making the webview visible.
        activity = ProcessInfo.processInfo.beginActivity(options: .userInitiatedAllowingIdleSystemSleep,
            reason: "Explicit offline caption qualification")
        view.load(URLRequest(url: url))
        // Match the production queue's 90-second job deadline after 330 seconds idle.
        DispatchQueue.main.asyncAfter(deadline: .now() + 430) {
            fputs("Hidden translator did not complete within 430 seconds\n", stderr)
            exit(3)
        }
    }

    func userContentController(_ userContentController: WKUserContentController, didReceive message: WKScriptMessage) {
        guard let body = message.body as? [String: Any],
              let data = try? JSONSerialization.data(withJSONObject: body),
              let text = String(data: data, encoding: .utf8) else { exit(4) }
        print(text)
        fflush(stdout)
        if body["complete"] as? Bool == true {
            if let activity { ProcessInfo.processInfo.endActivity(activity) }
            exit(body["error"] == nil ? 0 : 5)
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fputs("Native fixture navigation failed: \(error)\n", stderr)
        exit(6)
    }
}

guard CommandLine.arguments.count == 3, let url = URL(string: CommandLine.arguments[1]),
      url.host == "127.0.0.1", ["default", "disabled"].contains(CommandLine.arguments[2]) else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = Probe()
probe.run(url: url, policy: CommandLine.arguments[2])
app.run()
