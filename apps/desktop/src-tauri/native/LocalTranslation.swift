import Foundation
#if canImport(Translation)
import Translation
#endif

typealias TranslationReply = @convention(c) (UnsafeMutableRawPointer?, UnsafePointer<CChar>) -> Void

@_cdecl("polarbear_translate_local")
func translateLocal(_ input: UnsafePointer<CChar>, _ context: UnsafeMutableRawPointer?, _ reply: @escaping TranslationReply) {
    let text = String(cString: input)
    func finish(_ result: [String: String]) {
        let data = (try? JSONSerialization.data(withJSONObject: result)) ?? Data("{}".utf8)
        String(decoding: data, as: UTF8.self).withCString { reply(context, $0) }
    }
    #if canImport(Translation) && compiler(>=6.2)
    if #available(macOS 26.0, *) {
        Task { @MainActor in
            let source = Locale.Language(identifier: "en")
            let target = Locale.Language(identifier: "zh-Hans")
            let availability = await LanguageAvailability().status(from: source, to: target)
            // Never prepare/download models or use a network translation fallback.
            guard availability == .installed else {
                finish(["error": availability == .supported ? "languagePackMissing" : "unsupportedLanguage"])
                return
            }
            do {
                let session = TranslationSession(installedSource: source, target: target)
                let response = try await session.translate(text)
                finish(["text": response.targetText])
            } catch { finish(["error": "translationFailed"]) }
        }
        return
    }
    #endif
    finish(["error": "unsupportedSystem"])
}
