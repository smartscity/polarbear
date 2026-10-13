import AppKit
import Foundation
#if canImport(Translation)
import SwiftUI
import Translation
#endif

typealias TranslationReply = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>) -> Void

final class LocalTranslationRequest {
    let id: String
    let text: String
    let context: UnsafeMutableRawPointer?
    let reply: TranslationReply
    var hosting: NSView?
    var timeout: DispatchWorkItem?
    var finished = false

    init(id: String, text: String, context: UnsafeMutableRawPointer?, reply: @escaping TranslationReply) {
        self.id = id; self.text = text; self.context = context; self.reply = reply
    }
    func finish(_ result: [String: String]) {
        guard !finished else { return }
        finished = true
        timeout?.cancel()
        timeout = nil
        hosting?.removeFromSuperview(); hosting = nil
        localTranslationRequests.removeValue(forKey: id)
        let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
        String(decoding: data, as: UTF8.self).withCString { reply(context, $0) }
    }
}

// All access happens on the AppKit main thread; every request replies exactly once.
private var localTranslationRequests: [String: LocalTranslationRequest] = [:]

#if canImport(Translation) && compiler(>=6.0)
@available(macOS 15.0, *)
private struct InstalledTranslationView: View {
    let request: LocalTranslationRequest
    var body: some View {
        Color.clear.frame(width: 1, height: 1)
            .translationTask(source: Locale.Language(identifier: "en"), target: Locale.Language(identifier: "zh-Hans")) { session in
                guard !request.finished else { return }
                do {
                    let status = await LanguageAvailability().status(from: Locale.Language(identifier: "en"), to: Locale.Language(identifier: "zh-Hans"))
                    guard !Task.isCancelled, !request.finished else { return }
                    guard status == .installed else {
                        request.finish(["error": status == .supported ? "languagePackMissing" : "unsupportedLanguage"]); return
                    }
                    // Do not call prepareTranslation: only installed models are permitted.
                    let result = try await session.translate(request.text)
                    guard !Task.isCancelled else { return }
                    request.finish(["text": result.targetText])
                } catch {
                    if !Task.isCancelled { request.finish(["error": "translationFailed"]) }
                }
            }
    }
}
#endif

@_cdecl("polarbear_translate_local")
func translateLocal(_ identifier: UnsafePointer<CChar>, _ input: UnsafePointer<CChar>, _ context: UnsafeMutableRawPointer?, _ reply: @escaping TranslationReply) {
    let id = String(cString: identifier)
    localTranslationRequests[id]?.finish(["error": "cancelled"])
    let request = LocalTranslationRequest(id: id, text: String(cString: input), context: context, reply: reply)
    localTranslationRequests[id] = request
    guard ProcessInfo.processInfo.operatingSystemVersion.majorVersion >= 15 else {
        request.finish(["error": "unsupportedSystem"]); return
    }
    #if canImport(Translation) && compiler(>=6.0)
    if #available(macOS 15.0, *) {
        let timeout = DispatchWorkItem { request.finish(["error": "timeout"]) }
        request.timeout = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 30, execute: timeout)
        Task { @MainActor in
            let source = Locale.Language(identifier: "en")
            let target = Locale.Language(identifier: "zh-Hans")
            let status = await LanguageAvailability().status(from: source, to: target)
            guard !request.finished else { return }
            guard status == .installed else {
                request.finish(["error": status == .supported ? "languagePackMissing" : "unsupportedLanguage"]); return
            }
            guard let root = (NSApp.keyWindow ?? NSApp.windows.first(where: { $0.isVisible }))?.contentView else {
                request.finish(["error": "windowUnavailable"]); return
            }
            let host = NSHostingView(rootView: InstalledTranslationView(request: request))
            host.frame = NSRect(x: 0, y: 0, width: 1, height: 1)
            host.alphaValue = 0
            request.hosting = host
            root.addSubview(host, positioned: .below, relativeTo: nil)
        }
        return
    }
    #endif
    request.finish(["error": "buildSdkUnavailable"])
}

@_cdecl("polarbear_cancel_translation")
func cancelLocalTranslation(_ identifier: UnsafePointer<CChar>) {
    localTranslationRequests[String(cString: identifier)]?.finish(["error": "cancelled"])
}
