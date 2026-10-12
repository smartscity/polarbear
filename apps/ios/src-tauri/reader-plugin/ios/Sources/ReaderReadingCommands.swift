import Foundation
import Tauri
import UIKit

private struct TextArgs: Decodable { let text: String }
private struct CaptureArgs: Decodable { let capture: ReadingCapture }
private struct RemoveCaptureArgs: Decodable { let requestId: String }

extension ReaderPlugin {
    @objc func translateText(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(TextArgs.self)
        DispatchQueue.main.async { self.language.translate(args.text, invoke: invoke) }
    }
    @objc func cancelTranslation(_ invoke: Invoke) {
        DispatchQueue.main.async { self.language.cancel(); invoke.resolve() }
    }
    @objc func speakText(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(TextArgs.self)
        DispatchQueue.main.async { self.language.speak(args.text, invoke: invoke) }
    }
    @objc func stopSpeech(_ invoke: Invoke) {
        DispatchQueue.main.async { self.language.stop(); invoke.resolve() }
    }
    @objc func showDictionary(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(TextArgs.self)
        DispatchQueue.main.async {
            guard args.text.count <= 80, UIReferenceLibraryViewController.dictionaryHasDefinition(forTerm: args.text) else {
                invoke.reject("dictionaryUnavailable"); return
            }
            guard let host = self.manager.viewController, host.presentedViewController == nil else { invoke.reject("busy"); return }
            host.present(UIReferenceLibraryViewController(term: args.text), animated: true)
            invoke.resolve()
        }
    }
    @objc func listCaptures(_ invoke: Invoke) {
        readingQueue.async { do { invoke.resolve(try self.captureStore.list()) } catch { self.rejectReading(invoke, error) } }
    }
    @objc func saveCapture(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CaptureArgs.self)
        readingQueue.async { do { invoke.resolve(try self.captureStore.save(args.capture)) } catch { self.rejectReading(invoke, error) } }
    }
    @objc func removeCapture(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(RemoveCaptureArgs.self)
        readingQueue.async { do { try self.captureStore.remove(args.requestId); invoke.resolve() } catch { self.rejectReading(invoke, error) } }
    }
    @objc func shareCaptures(_ invoke: Invoke) {
        readingQueue.async {
            do {
                let data = try self.captureStore.export()
                let directory = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString, isDirectory: true)
                try FileManager.default.createDirectory(at: directory, withIntermediateDirectories: true)
                let url = directory.appendingPathComponent("Polarbear-reading.json")
                try data.write(to: url, options: [.atomic, .completeFileProtection])
                DispatchQueue.main.async { self.presentTransfer(url, directory: directory, invoke: invoke) }
            } catch { self.rejectReading(invoke, error) }
        }
    }
    private func presentTransfer(_ url: URL, directory: URL, invoke: Invoke) {
        guard let host = manager.viewController, host.presentedViewController == nil else {
            try? FileManager.default.removeItem(at: directory); invoke.reject("busy"); return
        }
        let sheet = UIActivityViewController(activityItems: [url], applicationActivities: nil)
        sheet.popoverPresentationController?.sourceView = host.view
        sheet.popoverPresentationController?.sourceRect = CGRect(x: host.view.bounds.midX, y: host.view.bounds.maxY, width: 1, height: 1)
        sheet.completionWithItemsHandler = { _, completed, _, error in
            try? FileManager.default.removeItem(at: directory)
            if error != nil { invoke.reject("unavailable") } else { invoke.resolve(["shared": completed]) }
        }
        host.present(sheet, animated: true)
    }
    private func rejectReading(_ invoke: Invoke, _ error: Error) {
        invoke.reject((error as? ReadingFailure)?.rawValue ?? "storageError")
    }
}
