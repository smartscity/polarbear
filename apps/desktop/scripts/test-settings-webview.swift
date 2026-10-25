import AppKit
import WebKit

// Isolated, nonpersistent WebViews exercise the packaged app's tauri:// origin.
// Independent JavaScript contexts prevent a module-local mutex from passing.
final class SettingsProbe: NSObject, WKURLSchemeHandler, WKNavigationDelegate {
    private let script = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    private var views: [WKWebView] = []
    private var loaded = 0
    private var completed = 0

    func run() {
        let store = WKWebsiteDataStore.nonPersistent()
        for _ in 0..<2 {
            let config = WKWebViewConfiguration()
            config.websiteDataStore = store
            config.setURLSchemeHandler(self, forURLScheme: "tauri")
            if #available(macOS 14.0, *) { config.preferences.inactiveSchedulingPolicy = .none }
            let view = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 400), configuration: config)
            view.navigationDelegate = self
            views.append(view)
            view.load(URLRequest(url: URL(string: "tauri://localhost/")!))
        }
        DispatchQueue.main.asyncAfter(deadline: .now() + 30) { self.fail("Native settings lock fixture timed out") }
    }

    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let isScript = task.request.url!.path == "/settings.js"
        let data = isScript ? script : Data("<!doctype html><title>Settings transaction fixture</title><script src='/settings.js'></script>".utf8)
        task.didReceive(URLResponse(url: task.request.url!, mimeType: isScript ? "application/javascript" : "text/html", expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data)
        task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}

    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        loaded += 1
        if loaded == 3 { verifySnapshots(); return }
        guard loaded == 2 else { return }
        for (index, view) in views.enumerated() {
            view.callAsyncJavaScript("""
                if (!isSecureContext || !navigator.locks) throw new Error('No secure-origin Web Locks');
                const seed = () => ({writer0: 0, writer1: 0});
                await SettingsPersistence.initializeSettings(seed);
                for (let i = 0; i < 100; i++) {
                    await SettingsPersistence.commitSettings(seed, value => ({...value, [field]: value[field] + 1}));
                }
                return true;
                """, arguments: ["field": "writer\(index)"], in: nil, in: .page) { result in
                    switch result {
                    case .failure(let error): self.fail("Native settings lock failed: \(error)")
                    case .success:
                        self.completed += 1
                        if self.completed == 2 { self.verify() }
                    }
                }
        }
    }

    private func verify() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = views[0].configuration.websiteDataStore
        config.setURLSchemeHandler(self, forURLScheme: "tauri")
        let fresh = WKWebView(frame: NSRect(x: 0, y: 0, width: 600, height: 400), configuration: config)
        fresh.navigationDelegate = self
        views.append(fresh)
        fresh.load(URLRequest(url: URL(string: "tauri://localhost/")!))
    }

    private func verifySnapshots(attempt: Int = 0) {
        var verified = 0
        var valid = true
        for (index, view) in views.enumerated() {
            view.callAsyncJavaScript("await SettingsPersistence.initializeSettings(() => ({writer0: 0, writer1: 0})); return SettingsPersistence.cachedSettings();", arguments: [:], in: nil, in: .page) { result in
                let value: Any?
                switch result {
                case .failure(let error): self.fail("Native settings read failed: \(error)"); return
                case .success(let snapshot): value = snapshot
                }
                if (value as? [String: Int]) != ["writer0": 100, "writer1": 100] {
                    valid = false
                    if attempt == 100 { fputs("Observer \(index): \(String(describing: value))\n", stderr) }
                }
                verified += 1
                if verified == 3 {
                    if !valid {
                        if attempt == 100 { self.fail("Native settings snapshot mismatch") }
                        // Storage notifications reach other renderers asynchronously. Only
                        // reread observers; never repeat or repair any acknowledged write.
                        DispatchQueue.main.asyncAfter(deadline: .now() + 0.025) { self.verifySnapshots(attempt: attempt + 1) }
                        return
                    }
                    print("PASS: production settings transactions merge 200 updates under tauri://localhost; both writers and a new WKWebView agree")
                    exit(0)
                }
            }
        }
    }

    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) {
        fail("Native settings fixture navigation failed: \(error)")
    }
    private func fail(_ message: String) { fputs(message + "\n", stderr); exit(1) }
}

guard CommandLine.arguments.count == 2 else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = SettingsProbe()
probe.run()
app.run()
