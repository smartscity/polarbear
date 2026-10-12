import Foundation

/// Native-only document authority. The host owns one instance per local storage root
/// and calls it on a background queue, never from a file-presenter callback.
/// This serial foundation intentionally does not promise cloud upload completion.
public final class LinkedDocumentStore {
    private struct Session {
        let document: DocumentReference
        var base: Data
        var generation: Int
        var savedGeneration: Int
        var recovery: DocumentDraft?
    }

    private let lock = NSRecursiveLock()
    private let grants: WorkspaceGrants
    private let journal: DraftJournal
    private let coordination: any DocumentCoordination
    private var sessions: [String: Session] = [:]

    public convenience init(storage: URL) {
        self.init(storage: storage, access: SystemBookmarkAccess(), coordination: SystemDocumentCoordination())
    }

    init(storage: URL, access: any BookmarkAccess, coordination: any DocumentCoordination) {
        grants = WorkspaceGrants(directory: storage.appendingPathComponent("workspaces"), access: access)
        journal = DraftJournal(root: storage.appendingPathComponent("drafts"))
        self.coordination = coordination
    }

    /// Only call with a native picker result. No public IPC method may accept this URL.
    public func connect(selectedFolder: URL) throws -> LinkedWorkspace {
        try synchronized { try grants.connect(selectedFolder) }
    }

    public func workspaces() throws -> [LinkedWorkspace] {
        try synchronized { try grants.list() }
    }

    public func documents(workspaceId: String) throws -> [String] {
        try synchronized {
            try grants.withRoot(workspaceId) { root in
                try coordination.read(root) { directory in
                    try requireDirectory(directory)
                    let base = directory.resolvingSymlinksInPath().standardizedFileURL
                    var traversalError: Error?
                    guard let walker = FileManager.default.enumerator(at: base,
                        includingPropertiesForKeys: [.isSymbolicLinkKey, .isRegularFileKey],
                        options: [.skipsHiddenFiles, .skipsPackageDescendants],
                        errorHandler: { _, error in traversalError = error; return false }) else { throw DocumentFailure.unavailable }
                    var paths: [String] = []
                    var visited = 0
                    for case let url as URL in walker {
                        visited += 1
                        guard visited <= DocumentLimits.directoryEntries else { throw DocumentFailure.tooLarge }
                        let values = try url.resourceValues(forKeys: [.isSymbolicLinkKey, .isRegularFileKey])
                        // Foundation does not descend through symbolic links. Calling skipDescendants
                        // here can instead suppress the next real directory in the enumeration.
                        if values.isSymbolicLink == true { continue }
                        guard values.isRegularFile == true, ["md", "markdown"].contains(url.pathExtension.lowercased()) else { continue }
                        let file = url.resolvingSymlinksInPath().standardizedFileURL
                        guard file.pathComponents.starts(with: base.pathComponents) else { throw DocumentFailure.invalidPath }
                        paths.append(file.pathComponents.dropFirst(base.pathComponents.count).joined(separator: "/"))
                    }
                    if let traversalError { throw DocumentFailure.classify(traversalError) }
                    return paths.sorted { $0.localizedStandardCompare($1) == .orderedAscending }
                }
            }
        }
    }

    public func open(_ ref: DocumentReference) throws -> DocumentSnapshot {
        try synchronized {
            let data = try read(ref)
            let pending = try journal.read(ref)
            // A reopened document supersedes its previous session; late messages cannot mutate it.
            sessions = sessions.filter { $0.value.document != ref }
            let id = UUID().uuidString
            sessions[id] = Session(document: ref, base: data, generation: 0, savedGeneration: 0, recovery: pending)
            return DocumentSnapshot(sessionId: id, text: try checkedText(data), revision: revision(data), recovery: pending)
        }
    }

    /// Recover drafts even when their original file is missing or its grant cannot be restored.
    public func pendingDraft(_ ref: DocumentReference) throws -> DocumentDraft? {
        try synchronized { try journal.read(ref) }
    }

    public func persistDraft(_ ref: DocumentReference, baseRevision: String, text: String, token: EditToken) throws -> Int {
        try synchronized {
            var session = try sessionFor(ref, token.sessionId)
            guard session.recovery == nil else { throw DocumentFailure.recoveryRequired }
            guard baseRevision == revision(session.base) else { throw DocumentFailure.revisionMismatch }
            guard token.generation > session.savedGeneration, token.generation >= session.generation,
                  token.generation > 0, token.generation <= DocumentLimits.generation else { throw DocumentFailure.staleGeneration }
            _ = try checkedText(Data(text.utf8))
            if let previous = try journal.read(ref) {
                guard previous.sessionId == token.sessionId else { throw DocumentFailure.recoveryRequired }
                if previous.generation == token.generation {
                    guard previous.text.utf8.elementsEqual(text.utf8) else { throw DocumentFailure.staleGeneration }
                    return token.generation
                }
                guard token.generation > previous.generation else { throw DocumentFailure.staleGeneration }
            }
            let draft = DocumentDraft(schemaVersion: 1, id: UUID().uuidString, document: ref,
                sessionId: token.sessionId, generation: token.generation, baseRevision: baseRevision,
                baseText: try checkedText(session.base), text: text, recordedAt: Date().timeIntervalSince1970 * 1000)
            try journal.persist(draft)
            session.generation = token.generation
            sessions[token.sessionId] = session
            return token.generation
        }
    }

    public func save(_ ref: DocumentReference, expectedRevision: String, token: EditToken) throws -> DocumentSaveResult {
        try synchronized {
            var session = try sessionFor(ref, token.sessionId)
            guard session.recovery == nil else { throw DocumentFailure.recoveryRequired }
            guard expectedRevision == revision(session.base) else { throw DocumentFailure.revisionMismatch }
            guard let draft = try journal.read(ref), draft.sessionId == token.sessionId,
                  draft.generation == token.generation, session.generation == token.generation else { throw DocumentFailure.staleGeneration }
            let content = Data(draft.text.utf8)
            let outcome: DocumentSaveResult
            do {
                outcome = try grants.withRoot(ref.workspaceId) { root in
                    let file = try documentURL(root: root, relativePath: ref.relativePath)
                    try requestMaterializationIfNeeded(file)
                    return try coordination.write(file) { coordinated in
                        let validated = try documentURL(root: root, relativePath: ref.relativePath)
                        guard coordinated.standardizedFileURL == validated.standardizedFileURL else { throw DocumentFailure.unavailable }
                        // The revision check and replacement share the same coordinated accessor.
                        let current = try readDocumentBytes(coordinated)
                        guard revision(current) == expectedRevision else {
                            try journal.preserveConflict(draft, current: current)
                            return DocumentSaveResult(kind: .conflict, generation: token.generation,
                                revision: revision(current), recoveryId: draft.id, reason: .revisionMismatch)
                        }
                        // Do not write the source unless its recovery history has been stored first.
                        try journal.archive(draft)
                        try content.write(to: coordinated, options: .atomic)
                        return DocumentSaveResult(kind: .saved, generation: token.generation,
                            revision: revision(content), recoveryId: nil, reason: nil)
                    }
                }
            } catch {
                let failure = DocumentFailure.classify(error)
                switch failure {
                case .missing:
                    return DocumentSaveResult(kind: .missing, generation: token.generation,
                        revision: nil, recoveryId: draft.id, reason: .missing)
                case .permission, .unavailable, .downloading:
                    return DocumentSaveResult(kind: .deferred, generation: token.generation,
                        revision: nil, recoveryId: draft.id, reason: failure)
                default: throw failure
                }
            }
            if outcome.kind == .saved {
                // If cleanup fails, retain the draft for explicit recovery on reopening.
                try journal.complete(draft)
                session.base = content
                session.savedGeneration = token.generation
                sessions[token.sessionId] = session
            }
            return outcome
        }
    }

    /// Explicit recovery only. A changed source requires the future conflict UI instead.
    public func resumeDraft(_ ref: DocumentReference, sessionId: String, recoveryId: String) throws -> DocumentDraft {
        try synchronized {
            var session = try sessionFor(ref, sessionId)
            guard let pending = session.recovery, pending.id == recoveryId,
                  try journal.read(ref) == pending else { throw DocumentFailure.recoveryRequired }
            guard pending.baseRevision == revision(session.base) else { throw DocumentFailure.revisionMismatch }
            let resumed = DocumentDraft(schemaVersion: 1, id: pending.id, document: ref,
                sessionId: sessionId, generation: pending.generation, baseRevision: pending.baseRevision,
                baseText: pending.baseText, text: pending.text, recordedAt: pending.recordedAt)
            try journal.persist(resumed)
            session.generation = resumed.generation
            session.recovery = nil
            sessions[sessionId] = session
            return resumed
        }
    }

    public func close(sessionId: String) {
        lock.lock()
        defer { lock.unlock() }
        // Closing a session never discards its pending draft.
        sessions.removeValue(forKey: sessionId)
    }

    private func read(_ ref: DocumentReference) throws -> Data {
        do {
            return try grants.withRoot(ref.workspaceId) { root in
                let file = try documentURL(root: root, relativePath: ref.relativePath)
                try requestMaterializationIfNeeded(file)
                return try coordination.read(file) { coordinated in
                    let validated = try documentURL(root: root, relativePath: ref.relativePath)
                    guard coordinated.standardizedFileURL == validated.standardizedFileURL else { throw DocumentFailure.unavailable }
                    return try readDocumentBytes(coordinated)
                }
            }
        } catch { throw DocumentFailure.classify(error) }
    }

    private func sessionFor(_ ref: DocumentReference, _ id: String) throws -> Session {
        guard let session = sessions[id], session.document == ref else { throw DocumentFailure.invalidSession }
        return session
    }

    private func synchronized<T>(_ action: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try action()
    }
}
