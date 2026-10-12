import AVFoundation
import Foundation
import Tauri
import Translation
import UIKit

final class ReaderLanguage: NSObject, AVSpeechSynthesizerDelegate {
    private let speech = AVSpeechSynthesizer()
    private var speaking: (AVSpeechUtterance, Invoke)?
    private var translation: Invoke?
    private var task: Task<Void, Never>?
    private var deadline: DispatchWorkItem?

    override init() {
        super.init()
        speech.delegate = self
        NotificationCenter.default.addObserver(self, selector: #selector(background), name: UIApplication.didEnterBackgroundNotification, object: nil)
    }

    deinit { NotificationCenter.default.removeObserver(self) }
    @objc private func background() { stop(); cancel() }

    func stop() {
        let previous = speaking
        speaking = nil
        speech.stopSpeaking(at: .immediate)
        previous?.1.resolve()
    }

    func speak(_ text: String, invoke: Invoke) {
        guard valid(text) else { invoke.reject("invalidTerm"); return }
        stop()
        guard let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language == "en-US" })
            ?? AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language.hasPrefix("en-") }) else {
            invoke.reject("speechUnavailable"); return
        }
        let utterance = AVSpeechUtterance(string: text)
        utterance.voice = voice
        speaking = (utterance, invoke)
        speech.speak(utterance)
    }

    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didFinish utterance: AVSpeechUtterance) { finishSpeech(utterance) }
    func speechSynthesizer(_ synthesizer: AVSpeechSynthesizer, didCancel utterance: AVSpeechUtterance) { finishSpeech(utterance) }
    private func finishSpeech(_ utterance: AVSpeechUtterance) {
        guard speaking?.0 === utterance else { return }
        speaking?.1.resolve(); speaking = nil
    }

    func cancel() {
        deadline?.cancel(); deadline = nil
        task?.cancel(); task = nil
        translation?.reject("cancelled"); translation = nil
    }

    func translate(_ text: String, invoke: Invoke) {
        cancel()
        guard valid(text) else { invoke.reject("invalidTerm"); return }
        guard #available(iOS 26.0, *) else { invoke.reject("unsupportedSystem"); return }
        translation = invoke
        let timeout = DispatchWorkItem { [weak self] in
            guard let self, self.translation === invoke else { return }
            invoke.reject("timeout"); self.translation = nil; self.task?.cancel()
        }
        deadline = timeout
        DispatchQueue.main.asyncAfter(deadline: .now() + 20, execute: timeout)
        task = Task { @MainActor [weak self] in
            let source = Locale.Language(identifier: "en")
            let target = Locale.Language(identifier: "zh-Hans")
            let status = await LanguageAvailability().status(from: source, to: target)
            guard !Task.isCancelled, let self, self.translation === invoke else { return }
            guard status == .installed else {
                self.fail(status == .supported ? "languagePackMissing" : "unsupportedLanguage", invoke: invoke); return
            }
            do {
                // Installed-only sessions never request model downloads or a remote fallback.
                let session = TranslationSession(installedSource: source, target: target)
                let response = try await session.translate(text)
                guard !Task.isCancelled, self.translation === invoke else { return }
                self.deadline?.cancel(); self.translation = nil
                invoke.resolve(["text": response.targetText])
            } catch {
                guard !Task.isCancelled, self.translation === invoke else { return }
                self.fail("translationFailed", invoke: invoke)
            }
        }
    }

    private func fail(_ code: String, invoke: Invoke) {
        deadline?.cancel(); translation = nil; invoke.reject(code)
    }

    private func valid(_ text: String) -> Bool {
        !text.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty && text.count <= 2000 && !text.contains("\0")
    }
}
