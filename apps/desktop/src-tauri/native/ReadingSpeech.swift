import AVFoundation
import Foundation

private let readingSpeech = AVSpeechSynthesizer()

@_cdecl("polarbear_speak_reading")
func speakReading(_ input: UnsafePointer<CChar>, _ locale: UnsafePointer<CChar>) -> Int32 {
    let language = String(cString: locale)
    guard ["en-US", "en-GB"].contains(language),
          let voice = AVSpeechSynthesisVoice.speechVoices().first(where: { $0.language == language }) else { return 1 }
    readingSpeech.stopSpeaking(at: .immediate)
    let utterance = AVSpeechUtterance(string: String(cString: input))
    utterance.voice = voice
    readingSpeech.speak(utterance)
    return 0
}

@_cdecl("polarbear_stop_reading")
func stopReading() { readingSpeech.stopSpeaking(at: .immediate) }
