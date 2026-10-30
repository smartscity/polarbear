import AppKit
import WebKit

// The real production renderer runs under the native tauri:// scheme without network access.
final class GanttProbe: NSObject, WKURLSchemeHandler, WKNavigationDelegate {
    private let script = try! Data(contentsOf: URL(fileURLWithPath: CommandLine.arguments[1]))
    private let source = try! String(contentsOfFile: CommandLine.arguments[2], encoding: .utf8)
    private var view: WKWebView!
    func run() {
        let config = WKWebViewConfiguration()
        config.websiteDataStore = .nonPersistent()
        config.setURLSchemeHandler(self, forURLScheme: "tauri")
        if #available(macOS 14.0, *) { config.preferences.inactiveSchedulingPolicy = .none }
        view = WKWebView(frame: NSRect(x: 0, y: 0, width: 1280, height: 800), configuration: config)
        view.navigationDelegate = self
        view.load(URLRequest(url: URL(string: "tauri://localhost/")!))
        DispatchQueue.main.asyncAfter(deadline: .now() + 60) { self.fail("Native Gantt acceptance timed out") }
    }
    func webView(_ webView: WKWebView, start task: WKURLSchemeTask) {
        let js = task.request.url!.path == "/gantt.js"
        let html = "<!doctype html><meta charset='utf-8'><meta http-equiv='Content-Security-Policy' content=\"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'none'\"><script src='/gantt.js'></script>"
        let data = js ? script : Data(html.utf8)
        task.didReceive(URLResponse(url: task.request.url!, mimeType: js ? "application/javascript" : "text/html", expectedContentLength: data.count, textEncodingName: "utf-8"))
        task.didReceive(data); task.didFinish()
    }
    func webView(_ webView: WKWebView, stop task: WKURLSchemeTask) {}
    func webView(_ webView: WKWebView, didFinish navigation: WKNavigation!) {
        webView.callAsyncJavaScript("return await GanttProbe.run(source);", arguments: ["source": source], in: nil, in: .page) { result in
            switch result {
            case .failure(let error): self.fail("Native Gantt failed: \(error)")
            case .success(let value):
                guard let report = value as? [String: Any], report["source"] as? String == self.source, report["cases"] as? Int == 6 else { self.fail("Native source integrity mismatch"); return }
                print("PASS: 6 production-renderer cases in macOS WKWebView under tauri://localhost; original source unchanged; no unhandled errors or leaked SVG containers")
                exit(0)
            }
        }
    }
    func webView(_ webView: WKWebView, didFailProvisionalNavigation navigation: WKNavigation!, withError error: Error) { fail("Native navigation failed: \(error)") }
    private func fail(_ message: String) { fputs(message + "\n", stderr); exit(1) }
}
guard CommandLine.arguments.count == 3 else { exit(2) }
let app = NSApplication.shared
app.setActivationPolicy(.prohibited)
let probe = GanttProbe()
probe.run()
app.run()
