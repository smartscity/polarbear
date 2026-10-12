import Foundation
import XCTest
@testable import PolarbearDocumentStore

final class TestBookmarks: BookmarkAccess {
    var denied = false
    var stale = false
    var creates = 0
    var starts = 0
    var stops = 0

    func create(_ url: URL) throws -> Data { creates += 1; return Data(url.absoluteString.utf8) }
    func resolve(_ data: Data) throws -> (url: URL, stale: Bool) {
        if denied { throw DocumentFailure.permission }
        return (URL(string: String(decoding: data, as: UTF8.self))!, stale)
    }
    func start(_ url: URL) -> Bool { starts += 1; return true }
    func stop(_ url: URL) { stops += 1 }
}

final class TestCoordination: DocumentCoordination {
    var beforeWrite: ((URL) throws -> Void)?
    var failure: Error?
    var writes = 0
    private let system = SystemDocumentCoordination()

    func read<T>(_ url: URL, _ accessor: (URL) throws -> T) throws -> T { try system.read(url, accessor) }
    func write<T>(_ url: URL, _ accessor: (URL) throws -> T) throws -> T {
        writes += 1
        if let failure { throw failure }
        return try system.write(url) { coordinated in
            try beforeWrite?(coordinated)
            return try accessor(coordinated)
        }
    }
}

final class LinkedDocumentStoreTests: XCTestCase {
    private var root: URL!
    private var source: URL!
    private var storage: URL!
    private var file: URL!
    private var bookmarks: TestBookmarks!
    private var coordination: TestCoordination!
    private var store: LinkedDocumentStore!
    private var ref: DocumentReference!

    override func setUpWithError() throws {
        root = FileManager.default.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        source = root.appendingPathComponent("iCloud test 中文")
        storage = root.appendingPathComponent("private")
        try FileManager.default.createDirectory(at: source, withIntermediateDirectories: true)
        file = source.appendingPathComponent("文章 #1.md")
        try Data("# Original\r\n中文 😀\r\n".utf8).write(to: file)
        bookmarks = TestBookmarks()
        coordination = TestCoordination()
        store = LinkedDocumentStore(storage: storage, access: bookmarks, coordination: coordination)
        let workspace = try store.connect(selectedFolder: source)
        ref = DocumentReference(workspaceId: workspace.id, relativePath: file.lastPathComponent)
    }

    override func tearDownWithError() throws {
        store = nil
        try FileManager.default.removeItem(at: root)
    }

    private func draft(_ text: String = "# Edited", generation: Int = 1) throws -> (DocumentSnapshot, EditToken) {
        let snapshot = try store.open(ref)
        let token = EditToken(sessionId: snapshot.sessionId, generation: generation)
        XCTAssertEqual(try store.persistDraft(ref, baseRevision: snapshot.revision, text: text, token: token), generation)
        return (snapshot, token)
    }

    private func expect(_ failure: DocumentFailure, _ action: () throws -> Void, file: StaticString = #filePath, line: UInt = #line) {
        XCTAssertThrowsError(try action(), file: file, line: line) {
            XCTAssertEqual($0 as? DocumentFailure, failure, file: file, line: line)
        }
    }

    func testExactBytesAndNativeOnlyGrantPersistence() throws {
        let snapshot = try store.open(ref)
        let bytes = try Data(contentsOf: file)
        XCTAssertEqual(snapshot.revision, revision(bytes))
        XCTAssertTrue(snapshot.revision.hasPrefix("sha256:"))
        XCTAssertEqual(Data(snapshot.text.utf8), bytes)
        let reopened = LinkedDocumentStore(storage: storage, access: bookmarks, coordination: coordination)
        XCTAssertEqual(try reopened.workspaces().count, 1)
        XCTAssertEqual(try reopened.open(ref).text, snapshot.text)
        XCTAssertEqual(bookmarks.starts, bookmarks.stops)
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: source.path), [file.lastPathComponent])
    }

    func testSystemBookmarksRoundTripOnMacOS() throws {
        let native = LinkedDocumentStore(storage: root.appendingPathComponent("system-grants"))
        let workspace = try native.connect(selectedFolder: source)
        let target = DocumentReference(workspaceId: workspace.id, relativePath: ref.relativePath)
        XCTAssertEqual(try native.open(target).text, try String(contentsOf: file, encoding: .utf8))
    }

    func testStaleBookmarksRenewAndBalanceScopes() throws {
        bookmarks.stale = true
        _ = try store.open(ref)
        XCTAssertEqual(bookmarks.creates, 2)
        XCTAssertEqual(bookmarks.starts, bookmarks.stops)
    }

    func testAtomicSaveArchivesRecoveryAndAdvancesRevision() throws {
        let (snapshot, token) = try draft("new 中文\r\n")
        let result = try store.save(ref, expectedRevision: snapshot.revision, token: token)
        XCTAssertEqual(result.kind, .saved)
        XCTAssertEqual(result.revision, revision(Data("new 中文\r\n".utf8)))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "new 中文\r\n")
        XCTAssertNil(try store.pendingDraft(ref))
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: storage.appendingPathComponent("drafts/history").path).count, 1)
        let next = EditToken(sessionId: snapshot.sessionId, generation: 2)
        _ = try store.persistDraft(ref, baseRevision: result.revision!, text: "next", token: next)
        XCTAssertEqual(try store.pendingDraft(ref)?.baseText, "new 中文\r\n")
    }

    func testRevisionCheckRunsInsideCoordinatedWrite() throws {
        let (snapshot, token) = try draft()
        coordination.beforeWrite = { try Data("external".utf8).write(to: $0) }
        let result = try store.save(ref, expectedRevision: snapshot.revision, token: token)
        XCTAssertEqual(result.kind, .conflict)
        XCTAssertEqual(result.revision, revision(Data("external".utf8)))
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "external")
        XCTAssertEqual(try store.pendingDraft(ref)?.text, "# Edited")
        let conflicts = storage.appendingPathComponent("drafts/conflicts")
        let record = try FileManager.default.contentsOfDirectory(at: conflicts, includingPropertiesForKeys: nil).first!
        let json = try JSONSerialization.jsonObject(with: Data(contentsOf: record)) as! [String: Any]
        XCTAssertEqual(json["currentText"] as? String, "external")
        XCTAssertNotNil(json["draft"])
    }

    func testRepeatedConflictsPreserveEachRemoteVersion() throws {
        let (snapshot, token) = try draft()
        for value in ["remote one", "remote two"] {
            try Data(value.utf8).write(to: file)
            XCTAssertEqual(try store.save(ref, expectedRevision: snapshot.revision, token: token).kind, .conflict)
        }
        XCTAssertEqual(try FileManager.default.contentsOfDirectory(atPath: storage.appendingPathComponent("drafts/conflicts").path).count, 2)
    }

    func testDeletedSourceIsNotRecreated() throws {
        let (snapshot, token) = try draft()
        try FileManager.default.removeItem(at: file)
        XCTAssertEqual(try store.save(ref, expectedRevision: snapshot.revision, token: token).kind, .missing)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
        XCTAssertNotNil(try store.pendingDraft(ref))
    }

    func testDeletionDuringCoordinationIsNotRecreated() throws {
        let (snapshot, token) = try draft()
        coordination.beforeWrite = { try FileManager.default.removeItem(at: $0) }
        XCTAssertEqual(try store.save(ref, expectedRevision: snapshot.revision, token: token).kind, .missing)
        XCTAssertFalse(FileManager.default.fileExists(atPath: file.path))
    }

    func testUnavailableRootIsNotReportedAsDeletedDocument() throws {
        let (snapshot, token) = try draft()
        try FileManager.default.moveItem(at: source, to: root.appendingPathComponent("disconnected"))
        let result = try store.save(ref, expectedRevision: snapshot.revision, token: token)
        XCTAssertEqual(result.kind, .deferred)
        XCTAssertEqual(result.reason, .unavailable)
        XCTAssertNotNil(try store.pendingDraft(ref))
    }

    func testRevokedBookmarkKeepsDraftAvailableWithoutSourceAccess() throws {
        let (snapshot, token) = try draft()
        bookmarks.denied = true
        let result = try store.save(ref, expectedRevision: snapshot.revision, token: token)
        XCTAssertEqual(result.kind, .deferred)
        XCTAssertEqual(result.reason, .permission)
        XCTAssertEqual(try store.pendingDraft(ref)?.text, "# Edited")
        XCTAssertEqual(bookmarks.starts, bookmarks.stops)
    }

    func testProviderWriteFailureRetainsDraftAndOriginal() throws {
        let (snapshot, token) = try draft()
        coordination.failure = NSError(domain: NSCocoaErrorDomain, code: NSFileWriteNoPermissionError)
        let result = try store.save(ref, expectedRevision: snapshot.revision, token: token)
        XCTAssertEqual(result.reason, .permission)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), snapshot.text)
        XCTAssertNotNil(try store.pendingDraft(ref))
    }

    func testProviderDownloadPendingDefersWithoutEmptyReplacement() throws {
        let (snapshot, token) = try draft()
        coordination.failure = DocumentFailure.downloading
        let result = try store.save(ref, expectedRevision: snapshot.revision, token: token)
        XCTAssertEqual(result.kind, .deferred)
        XCTAssertEqual(result.reason, .downloading)
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), snapshot.text)
        XCTAssertNotNil(try store.pendingDraft(ref))
    }

    func testOlderGenerationCannotOverwriteOrClearNewerDraft() throws {
        let (snapshot, old) = try draft()
        let next = EditToken(sessionId: old.sessionId, generation: 2)
        _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "newer", token: next)
        expect(.staleGeneration) { _ = try store.save(ref, expectedRevision: snapshot.revision, token: old) }
        expect(.staleGeneration) { _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "late", token: old) }
        XCTAssertEqual(try store.pendingDraft(ref)?.text, "newer")
        XCTAssertEqual(coordination.writes, 0)
    }

    func testDraftAcknowledgmentRetryIsIdempotentButPayloadCannotChange() throws {
        let (snapshot, token) = try draft()
        XCTAssertEqual(try store.persistDraft(ref, baseRevision: snapshot.revision, text: "# Edited", token: token), 1)
        expect(.staleGeneration) { _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "different", token: token) }
    }

    func testIdempotentRetryRequiresIdenticalBytesNotUnicodeEquivalence() throws {
        let (snapshot, token) = try draft("e\u{301}")
        expect(.staleGeneration) {
            _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "\u{e9}", token: token)
        }
        XCTAssertEqual(Array(try store.pendingDraft(ref)!.text.utf8), Array("e\u{301}".utf8))
    }

    func testSessionBoundToDocumentAndReopenRejectsLateMessages() throws {
        let snapshot = try store.open(ref)
        let token = EditToken(sessionId: snapshot.sessionId, generation: 1)
        let other = DocumentReference(workspaceId: ref.workspaceId, relativePath: "other.md")
        expect(.invalidSession) { _ = try store.persistDraft(other, baseRevision: snapshot.revision, text: "bad", token: token) }
        _ = try store.open(ref)
        expect(.invalidSession) { _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "late", token: token) }
    }

    func testRestartRequiresExplicitRecoveryBeforeEditing() throws {
        let (_, token) = try draft("recover me")
        store.close(sessionId: token.sessionId)
        store = LinkedDocumentStore(storage: storage, access: bookmarks, coordination: coordination)
        let snapshot = try store.open(ref)
        XCTAssertEqual(snapshot.recovery?.text, "recover me")
        let next = EditToken(sessionId: snapshot.sessionId, generation: 2)
        expect(.recoveryRequired) { _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "overwrite", token: next) }
        let resumed = try store.resumeDraft(ref, sessionId: snapshot.sessionId, recoveryId: snapshot.recovery!.id)
        XCTAssertEqual(resumed.text, "recover me")
        XCTAssertEqual(try store.save(ref, expectedRevision: snapshot.revision,
            token: EditToken(sessionId: snapshot.sessionId, generation: resumed.generation)).kind, .saved)
    }

    func testRecoveryCannotReplayAgainstChangedSource() throws {
        _ = try draft()
        try Data("new external".utf8).write(to: file)
        let snapshot = try store.open(ref)
        expect(.revisionMismatch) { _ = try store.resumeDraft(ref, sessionId: snapshot.sessionId, recoveryId: snapshot.recovery!.id) }
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), "new external")
    }

    func testLocalJournalFailurePreventsSourceWrite() throws {
        let (snapshot, token) = try draft()
        try Data("block history directory".utf8).write(to: storage.appendingPathComponent("drafts/history"))
        expect(.storageFailure) { _ = try store.save(ref, expectedRevision: snapshot.revision, token: token) }
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), snapshot.text)
        XCTAssertNotNil(try store.pendingDraft(ref))
    }

    func testDraftStorageFailureDoesNotAcknowledgeOrWriteSource() throws {
        let snapshot = try store.open(ref)
        try FileManager.default.createDirectory(at: storage.appendingPathComponent("drafts"), withIntermediateDirectories: true)
        try Data("block pending directory".utf8).write(to: storage.appendingPathComponent("drafts/pending"))
        expect(.storageFailure) {
            _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "not durable",
                token: EditToken(sessionId: snapshot.sessionId, generation: 1))
        }
        XCTAssertEqual(try String(contentsOf: file, encoding: .utf8), snapshot.text)
        XCTAssertEqual(coordination.writes, 0)
    }

    func testByteOrderMarkAndLineEndingsRoundTrip() throws {
        let original = Data([0xef, 0xbb, 0xbf]) + Data("# BOM\r\n".utf8)
        try original.write(to: file)
        let snapshot = try store.open(ref)
        XCTAssertEqual(Data(snapshot.text.utf8), original)
        let token = EditToken(sessionId: snapshot.sessionId, generation: 1)
        _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: snapshot.text, token: token)
        XCTAssertEqual(try store.save(ref, expectedRevision: snapshot.revision, token: token).kind, .saved)
        XCTAssertEqual(try Data(contentsOf: file), original)
    }

    func testInvalidGenerationAndRevisionAreRejectedBeforePersistence() throws {
        let snapshot = try store.open(ref)
        for generation in [-1, 0, DocumentLimits.generation + 1] {
            expect(.staleGeneration) {
                _ = try store.persistDraft(ref, baseRevision: snapshot.revision, text: "bad",
                    token: EditToken(sessionId: snapshot.sessionId, generation: generation))
            }
        }
        expect(.revisionMismatch) {
            _ = try store.persistDraft(ref, baseRevision: "old-fnv-token", text: "bad",
                token: EditToken(sessionId: snapshot.sessionId, generation: 1))
        }
        XCTAssertNil(try store.pendingDraft(ref))
    }

    func testSiblingPrefixDoesNotAuthorizeOutsideDocument() throws {
        let outside = root.appendingPathComponent("iCloud test 中文-other")
        try FileManager.default.createDirectory(at: outside, withIntermediateDirectories: true)
        try Data("private".utf8).write(to: outside.appendingPathComponent("private.md"))
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("escape"), withDestinationURL: outside)
        expect(.invalidPath) {
            _ = try store.open(DocumentReference(workspaceId: ref.workspaceId, relativePath: "escape/private.md"))
        }
    }

    func testCorruptDraftCannotBeSilentlyDropped() throws {
        _ = try draft()
        let pending = storage.appendingPathComponent("drafts/pending").appendingPathComponent(ref.storageId + ".json")
        try Data("not json".utf8).write(to: pending)
        expect(.invalidMetadata) { _ = try store.open(ref) }
    }

    func testRejectsTraversalAbsolutePathsHiddenFilesAndSymlinks() throws {
        for path in ["../escape.md", "/tmp/file.md", "folder//a.md", "./a.md", "a\\b.md", ".hidden.md", "a.txt"] {
            let target = DocumentReference(workspaceId: ref.workspaceId, relativePath: path)
            expect(.invalidPath) { _ = try store.open(target) }
        }
        let link = source.appendingPathComponent("alias.md")
        try FileManager.default.createSymbolicLink(at: link, withDestinationURL: file)
        expect(.invalidPath) { _ = try store.open(DocumentReference(workspaceId: ref.workspaceId, relativePath: "alias.md")) }
        let directoryLink = source.appendingPathComponent("linked")
        try FileManager.default.createSymbolicLink(at: directoryLink, withDestinationURL: source)
        expect(.invalidPath) { _ = try store.open(DocumentReference(workspaceId: ref.workspaceId, relativePath: "linked/" + file.lastPathComponent)) }
    }

    func testRejectsInvalidEncodingAndOversizedDocuments() throws {
        try Data([0xff, 0xfe]).write(to: file)
        expect(.invalidEncoding) { _ = try store.open(ref) }
        try Data(repeating: 65, count: DocumentLimits.bytes + 1).write(to: file)
        expect(.tooLarge) { _ = try store.open(ref) }
    }

    func testDirectoryListingIsBoundedAndDoesNotFollowSymlinks() throws {
        let nested = source.appendingPathComponent("nested")
        try FileManager.default.createDirectory(at: nested, withIntermediateDirectories: true)
        try Data().write(to: nested.appendingPathComponent("second.MARKDOWN"))
        try Data().write(to: source.appendingPathComponent("image.png"))
        try FileManager.default.createSymbolicLink(at: source.appendingPathComponent("alias"), withDestinationURL: nested)
        XCTAssertEqual(Set(try store.documents(workspaceId: ref.workspaceId)), Set([ref.relativePath, "nested/second.MARKDOWN"]))
    }

    func testDirectoryLimitRejectsPartialSuccess() throws {
        for index in 0..<DocumentLimits.directoryEntries {
            try Data().write(to: source.appendingPathComponent("entry-\(index).md"))
        }
        expect(.tooLarge) { _ = try store.documents(workspaceId: ref.workspaceId) }
    }

    func testChangedSourceAfterExplicitRecoveryStillConflictsAtSave() throws {
        _ = try draft("offline edits")
        let reopened = try store.open(ref)
        let resumed = try store.resumeDraft(ref, sessionId: reopened.sessionId, recoveryId: reopened.recovery!.id)
        try Data("arrived after resume".utf8).write(to: file)
        let result = try store.save(ref, expectedRevision: reopened.revision,
            token: EditToken(sessionId: reopened.sessionId, generation: resumed.generation))
        XCTAssertEqual(result.kind, .conflict)
        XCTAssertEqual(try store.pendingDraft(ref)?.text, "offline edits")
    }
}
