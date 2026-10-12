import Foundation

/// Atomic local snapshots. Pending work is never subject to age-based eviction.
final class DraftJournal {
    private let root: URL
    private let fm = FileManager.default

    init(root: URL) { self.root = root }

    func read(_ ref: DocumentReference) throws -> DocumentDraft? {
        let file = root.appendingPathComponent("pending").appendingPathComponent(ref.storageId + ".json")
        let data: Data
        do {
            // Two document strings can each expand sixfold when JSON-escaped.
            guard (try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0) <= DocumentLimits.bytes * 12 + 8192 else {
                throw DocumentFailure.invalidMetadata
            }
            data = try Data(contentsOf: file)
        }
        catch let error as NSError where error.domain == NSCocoaErrorDomain && error.code == NSFileReadNoSuchFileError { return nil }
        catch let error as DocumentFailure { throw error }
        catch { throw DocumentFailure.storageFailure }
        let draft: DocumentDraft
        do { draft = try JSONDecoder().decode(DocumentDraft.self, from: data) }
        catch { throw DocumentFailure.invalidMetadata }
        guard draft.schemaVersion == 1, draft.document == ref,
              draft.baseRevision == revision(Data(draft.baseText.utf8)),
              draft.generation > 0, draft.generation <= DocumentLimits.generation,
              draft.recordedAt.isFinite, draft.recordedAt > 0,
              UUID(uuidString: draft.id) != nil, UUID(uuidString: draft.sessionId) != nil else { throw DocumentFailure.invalidMetadata }
        _ = try checkedText(Data(draft.baseText.utf8))
        _ = try checkedText(Data(draft.text.utf8))
        return draft
    }

    func persist(_ draft: DocumentDraft) throws {
        try write(draft, directory: "pending", name: draft.document.storageId)
    }

    func archive(_ draft: DocumentDraft) throws {
        try write(draft, directory: "history", name: UUID().uuidString)
    }

    func preserveConflict(_ draft: DocumentDraft, current: Data) throws {
        struct Conflict: Encodable {
            let schemaVersion: Int
            let draft: DocumentDraft
            let currentText: String
            let currentRevision: String
        }
        do {
            let folder = root.appendingPathComponent("conflicts")
            try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            let record = Conflict(schemaVersion: 1, draft: draft, currentText: try checkedText(current), currentRevision: revision(current))
            try JSONEncoder().encode(record).write(to: folder.appendingPathComponent(draft.id + "-" + digest(current) + ".json"), options: .atomic)
        } catch { throw DocumentFailure.storageFailure }
    }

    func complete(_ draft: DocumentDraft) throws {
        guard try read(draft.document) == draft else { throw DocumentFailure.staleGeneration }
        do { try fm.removeItem(at: root.appendingPathComponent("pending").appendingPathComponent(draft.document.storageId + ".json")) }
        catch { throw DocumentFailure.storageFailure }
    }

    private func write(_ draft: DocumentDraft, directory: String, name: String) throws {
        do {
            let folder = root.appendingPathComponent(directory)
            try fm.createDirectory(at: folder, withIntermediateDirectories: true, attributes: [.posixPermissions: 0o700])
            try JSONEncoder().encode(draft).write(to: folder.appendingPathComponent(name + ".json"), options: .atomic)
        } catch { throw DocumentFailure.storageFailure }
    }
}
