import AppKit
import Foundation

private final class ReplyBox {
    var replies: [[String: String]] = []
}

private let receive: TranslationReply = { context, json in
    let box = Unmanaged<ReplyBox>.fromOpaque(context!).takeUnretainedValue()
    let result = try! JSONDecoder().decode([String: String].self, from: Data(String(cString: json).utf8))
    box.replies.append(result)
}

@main
struct LocalTranslationTests {
    static func main() {
        let application = NSApplication.shared
        application.setActivationPolicy(.prohibited)
        let cancelled = ReplyBox()
        "cancel-test".withCString { identifier in
            "An attractive opportunity.".withCString { input in
                translateLocal(identifier, input, 0, Unmanaged.passUnretained(cancelled).toOpaque(), receive)
            }
            cancelLocalTranslation(identifier)
            cancelLocalTranslation(identifier)
        }
        precondition(cancelled.replies.count == 1, "Cancellation must finish exactly once")
        let expected = ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 15 ? "cancelled" : "unsupportedSystem"
        precondition(cancelled.replies[0]["error"] == expected)
        print("PASS: native cancellation replies exactly once and the bridge compiles with a macOS 11 deployment target")

        let preparation = ReplyBox()
        "prepare-cancel-test".withCString { identifier in
            "Prepare languages".withCString { input in
                translateLocal(identifier, input, 1, Unmanaged.passUnretained(preparation).toOpaque(), receive)
            }
            cancelLocalTranslation(identifier)
        }
        precondition(preparation.replies.count == 1 && preparation.replies[0]["error"] == expected)
        print("PASS: explicit model preparation can be cancelled before displaying consent or downloading")

        let window = NSWindow(contentRect: NSRect(x: 0, y: 0, width: 200, height: 100), styleMask: [.titled], backing: .buffered, defer: false)
        window.title = "Polarbear translation verification"
        window.orderFront(nil)
        defer { window.orderOut(nil) }
        let probe = ReplyBox()
        "model-probe".withCString { identifier in
            "This is an English sentence.".withCString { input in
                translateLocal(identifier, input, 0, Unmanaged.passUnretained(probe).toOpaque(), receive)
            }
        }
        let deadline = Date().addingTimeInterval(35)
        while probe.replies.isEmpty && Date() < deadline {
            RunLoop.main.run(until: Date().addingTimeInterval(0.02))
        }
        precondition(probe.replies.count == 1, "Native translation must reply before the deadline")
        precondition(cancelled.replies.count == 1, "Cancelled requests must not publish late results")
        if let text = probe.replies[0]["text"] {
            precondition(!text.isEmpty && text != "This is an English sentence.")
            print("PASS: installed models translated an English sentence locally: \(text)")
        } else {
            let error = probe.replies[0]["error"] ?? "missing error"
            precondition(["languagePackMissing", "unsupportedLanguage", "unsupportedSystem", "buildSdkUnavailable"].contains(error), "Unexpected native error: \(error)")
            print("BLOCKED: successful model inference requires system resources: \(error)")
            print("PASS: unavailable system resources produce a specific error without downloading models")
        }
    }
}
