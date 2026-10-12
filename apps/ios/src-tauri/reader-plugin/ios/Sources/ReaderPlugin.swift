import Foundation
import Tauri
import UIKit
import UniformTypeIdentifiers

private struct ImportArgs: Decodable { let folder: Bool }
private struct ResourceArgs: Decodable { let collection: String; let path: String }
private struct CollectionArgs: Decodable { let collection: String }
private struct EntriesResponse: Encodable { let entries: [ReaderEntry] }
private struct OpenArgs: Decodable { let url: String }
private struct OpenResponse: Encodable { let entries: [ReaderEntry]; let error: String? }

final class ReaderPlugin: Plugin, UIDocumentPickerDelegate {
    let language = ReaderLanguage()
    let readingQueue = DispatchQueue(label: "dev.polarbear.reader.captures", qos: .userInitiated)
    var captureStore: ReadingCaptureStore {
        ReadingCaptureStore(root: FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0].appendingPathComponent("ReadingCaptures", isDirectory: true))
    }
    private let queue = DispatchQueue(label: "dev.polarbear.reader.library", qos: .userInitiated)
    private var pending: Invoke?
    private var library: ReaderLibrary {
        let root = FileManager.default.urls(for: .applicationSupportDirectory, in: .userDomainMask)[0]
            .appendingPathComponent("ReaderLibrary", isDirectory: true)
        return ReaderLibrary(root: root)
    }

    @objc func importDocuments(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ImportArgs.self)
        DispatchQueue.main.async {
            guard self.pending == nil else { invoke.reject(ReaderFailure.busy.rawValue); return }
            guard let host = self.manager.viewController, host.presentedViewController == nil else {
                invoke.reject(ReaderFailure.unavailable.rawValue); return
            }
            self.pending = invoke
            let picker = UIDocumentPickerViewController(forOpeningContentTypes: args.folder ? [.folder] : [UTType(filenameExtension: "md") ?? .plainText, UTType(filenameExtension: "markdown") ?? .plainText], asCopy: false)
            picker.delegate = self
            picker.allowsMultipleSelection = false
            host.present(picker, animated: true)
        }
    }

    func documentPickerWasCancelled(_ controller: UIDocumentPickerViewController) {
        pending?.resolve(EntriesResponse(entries: []))
        pending = nil
    }

    func documentPicker(_ controller: UIDocumentPickerViewController, didPickDocumentsAt urls: [URL]) {
        guard let invoke = pending, let source = urls.first else { return }
        pending = nil
        queue.async {
            do {
                invoke.resolve(EntriesResponse(entries: try self.library.importCoordinatedSnapshot(source)))
            } catch { self.reject(invoke, error) }
        }
    }

    // Called only by the Rust OS-open event handler, not exposed through WebView permissions.
    @objc func openDocument(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(OpenArgs.self)
        queue.async {
            do { invoke.resolve(OpenResponse(entries: try self.library.importOpenedDocument(args.url), error: nil)) }
            catch { invoke.resolve(OpenResponse(entries: [], error: (error as? ReaderFailure)?.rawValue ?? ReaderFailure.unavailable.rawValue)) }
        }
    }

    @objc func listDocuments(_ invoke: Invoke) {
        queue.async { do { invoke.resolve(EntriesResponse(entries: try self.library.list())) } catch { self.reject(invoke, error) } }
    }

    @objc func readDocument(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ResourceArgs.self)
        queue.async { do { invoke.resolve(["content": try self.library.document(collection: args.collection, path: args.path)]) } catch { self.reject(invoke, error) } }
    }

    @objc func readAsset(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(ResourceArgs.self)
        queue.async { do { invoke.resolve(try self.library.asset(collection: args.collection, path: args.path)) } catch { self.reject(invoke, error) } }
    }

    @objc func removeCollection(_ invoke: Invoke) throws {
        let args = try invoke.parseArgs(CollectionArgs.self)
        queue.async { do { try self.library.remove(collection: args.collection); invoke.resolve() } catch { self.reject(invoke, error) } }
    }

    private func reject(_ invoke: Invoke, _ error: Error) {
        invoke.reject((error as? ReaderFailure)?.rawValue ?? ReaderFailure.unavailable.rawValue)
    }
}

@_cdecl("init_plugin_reader")
func initPluginReader() -> Plugin { ReaderPlugin() }
