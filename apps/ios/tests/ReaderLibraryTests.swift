import Foundation

@main struct ReaderLibraryTests {
    static func main() throws {
        let fm = FileManager.default
        let temp = fm.temporaryDirectory.appendingPathComponent(UUID().uuidString)
        try fm.createDirectory(at: temp, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: temp) }
        try testReadingCaptures(temp)
        let source = temp.appendingPathComponent("source")
        try fm.createDirectory(at: source.appendingPathComponent("images"), withIntermediateDirectories: true)
        try "# 中文\n![image](images/a.png)".write(to: source.appendingPathComponent("read me.md"), atomically: true, encoding: .utf8)
        try Data([1, 2, 3]).write(to: source.appendingPathComponent("images/a.png"))
        try "private".write(to: source.appendingPathComponent("secret.txt"), atomically: true, encoding: .utf8)
        let library = ReaderLibrary(root: temp.appendingPathComponent("library"))
        let imported = try library.importSnapshot(source)
        guard let entry = imported.first else { fatalError("Expected imported document") }
        assert(imported.count == 1)
        try check(library.list().count == 1)
        try check(library.document(collection: entry.collection, path: entry.path).contains("中文"))
        try check(library.asset(collection: entry.collection, path: "images/a.png")["base64"] == "AQID")
        try fm.removeItem(at: source)
        try check(library.document(collection: entry.collection, path: entry.path).contains("中文"))
        try fails(.invalidPath) { _ = try library.document(collection: entry.collection, path: "../manifest.json") }
        try fails(.invalidPath) { _ = try library.document(collection: "../outside", path: "read me.md") }
        try fails(.unavailable) { _ = try library.asset(collection: entry.collection, path: "missing.png") }
        let invalid = temp.appendingPathComponent("invalid.md")
        try Data([0xff, 0xfe]).write(to: invalid)
        try fails(.invalidEncoding) { _ = try library.importSnapshot(invalid) }
        try check(library.list().count == 1)
        let large = temp.appendingPathComponent("large.md")
        try Data(repeating: 65, count: ReaderLibrary.maxDocumentBytes + 1).write(to: large)
        try fails(.tooLarge) { _ = try library.importSnapshot(large) }
        let link = temp.appendingPathComponent("linked.md")
        try fm.createSymbolicLink(at: link, withDestinationURL: large)
        try fails(.invalidPath) { _ = try library.importSnapshot(link) }
        try library.remove(collection: entry.collection)
        try check(library.list().isEmpty)
        assert(fm.fileExists(atPath: invalid.path))
        let incoming = temp.appendingPathComponent("中文 shared #1.MARKDOWN")
        try "# Shared document".write(to: incoming, atomically: true, encoding: .utf8)
        let opened = try library.importOpenedDocument(incoming.absoluteString)
        assert(opened.count == 1)
        try check(library.document(collection: opened[0].collection, path: opened[0].path) == "# Shared document")
        try check(String(contentsOf: incoming, encoding: .utf8) == "# Shared document")
        try fm.removeItem(at: incoming)
        try check(library.document(collection: opened[0].collection, path: opened[0].path) == "# Shared document")
        try fails(.invalidPath) { _ = try library.importOpenedDocument("https://example.invalid/file.md") }
        try fails(.invalidPath) { _ = try library.importOpenedDocument("file://remote-server/path/file.md") }
        try fails(.invalidPath) { _ = try library.importOpenedDocument(invalid.absoluteString + "?query=1") }
        try fails(.unsupportedFile) { _ = try library.importOpenedDocument(temp.appendingPathComponent("file.pdf").absoluteString) }
        try fails(.invalidEncoding) { _ = try library.importOpenedDocument(invalid.absoluteString) }
        try fails(.tooLarge) { _ = try library.importOpenedDocument(large.absoluteString) }
        try fails(.invalidPath) { _ = try library.importOpenedDocument(link.absoluteString) }
        let directory = temp.appendingPathComponent("directory.md")
        try fm.createDirectory(at: directory, withIntermediateDirectories: true)
        try fails(.invalidPath) { _ = try library.importOpenedDocument(directory.absoluteString) }
        try check(library.list().count == 1)
        print("PASS: OS-open URL validation, Unicode/space escaping, offline copy, source protection, unsupported/invalid/oversized input")
        print("PASS: snapshot, offline assets, unicode, source isolation, traversal, missing asset, encoding, atomic failure, size limit, symlink, deletion")
    }

    static func fails(_ expected: ReaderFailure, _ action: () throws -> Void) throws {
        do { try action(); fatalError("Expected \(expected)") }
        catch let error as ReaderFailure { assert(error == expected) }
    }

    static func check(_ condition: @autoclosure () throws -> Bool) throws {
        let value = try condition()
        assert(value)
    }
}
