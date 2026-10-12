import Foundation

enum ReaderFailure: String, Error {
    case invalidPath, unsupportedFile, tooLarge, emptyImport, invalidEncoding, unavailable, busy
}

struct ReaderEntry: Codable {
    let collection: String
    let path: String
    let importedAt: Double

}

/// Immutable snapshots. No operation accepts an arbitrary source path from JavaScript.
final class ReaderLibrary {
    static let maxDocumentBytes = 5 * 1024 * 1024
    static let maxAssetBytes = 20 * 1024 * 1024
    static let maxCollectionBytes = 100 * 1024 * 1024
    static let maxFiles = 2000
    static let imageTypes = ["png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
                             "gif": "image/gif", "webp": "image/webp", "svg": "image/svg+xml"]
    let root: URL
    private let fm = FileManager.default

    init(root: URL) { self.root = root.resolvingSymlinksInPath().standardizedFileURL }

    func importOpenedDocument(_ value: String) throws -> [ReaderEntry] {
        guard let url = URL(string: value), url.isFileURL,
              url.host == nil || url.host == "" || url.host == "localhost",
              url.query == nil, url.fragment == nil else { throw ReaderFailure.invalidPath }
        guard isMarkdown(url) else { throw ReaderFailure.unsupportedFile }
        return try importCoordinatedSnapshot(url, documentOnly: true)
    }

    func importCoordinatedSnapshot(_ source: URL, documentOnly: Bool = false) throws -> [ReaderEntry] {
        let scoped = source.startAccessingSecurityScopedResource()
        defer { if scoped { source.stopAccessingSecurityScopedResource() } }
        var coordinationError: NSError?
        var result: Result<[ReaderEntry], Error>?
        NSFileCoordinator().coordinate(readingItemAt: source, options: [], error: &coordinationError) { url in
            result = Result {
                if documentOnly {
                    let info = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                    guard info.isRegularFile == true, info.isSymbolicLink != true else { throw ReaderFailure.invalidPath }
                }
                return try self.importSnapshot(url)
            }
        }
        if let coordinationError { throw coordinationError }
        guard let result else { throw ReaderFailure.unavailable }
        return try result.get()
    }

    func list() throws -> [ReaderEntry] {
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        return try fm.contentsOfDirectory(at: root, includingPropertiesForKeys: nil)
            .filter { UUID(uuidString: $0.lastPathComponent) != nil }
            .flatMap { folder in
                try JSONDecoder().decode([ReaderEntry].self, from: Data(contentsOf: folder.appendingPathComponent("manifest.json")))
            }.sorted { $0.importedAt > $1.importedAt }
    }

    func importSnapshot(_ sourceURL: URL) throws -> [ReaderEntry] {
        guard try sourceURL.resourceValues(forKeys: [.isSymbolicLinkKey]).isSymbolicLink != true else { throw ReaderFailure.invalidPath }
        let source = sourceURL.resolvingSymlinksInPath().standardizedFileURL
        try fm.createDirectory(at: root, withIntermediateDirectories: true)
        let id = UUID().uuidString
        let staging = root.appendingPathComponent(".import-" + id, isDirectory: true)
        let content = staging.appendingPathComponent("content", isDirectory: true)
        try fm.createDirectory(at: content, withIntermediateDirectories: true)
        defer { try? fm.removeItem(at: staging) }
        let values = try source.resourceValues(forKeys: [.isDirectoryKey, .isSymbolicLinkKey])
        guard values.isSymbolicLink != true else { throw ReaderFailure.invalidPath }
        var files: [URL] = []
        if values.isDirectory == true {
            var traversalError: Error?
            guard let walker = fm.enumerator(at: source,
                includingPropertiesForKeys: [.isRegularFileKey, .isSymbolicLinkKey, .fileSizeKey],
                options: [.skipsHiddenFiles, .skipsPackageDescendants],
                errorHandler: { _, error in traversalError = error; return false }) else { throw ReaderFailure.unavailable }
            var visited = 0
            for case let url as URL in walker {
                visited += 1
                guard visited <= Self.maxFiles else { throw ReaderFailure.tooLarge }
                let info = try url.resourceValues(forKeys: [.isRegularFileKey, .isSymbolicLinkKey])
                guard info.isSymbolicLink != true else { walker.skipDescendants(); continue }
                if info.isRegularFile == true { files.append(url) }
            }
            if let traversalError { throw traversalError }
        } else {
            guard isMarkdown(source) else { throw ReaderFailure.unsupportedFile }
            files = [source]
        }
        var total = 0
        var entries: [ReaderEntry] = []
        let importedAt = Date().timeIntervalSince1970 * 1000
        for originalFile in files {
            let file = originalFile.resolvingSymlinksInPath().standardizedFileURL
            if values.isDirectory == true && !file.pathComponents.starts(with: source.pathComponents) { throw ReaderFailure.invalidPath }
            let markdown = isMarkdown(file)
            guard markdown || Self.imageTypes[file.pathExtension.lowercased()] != nil else { continue }
            let size = try file.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? 0
            total += size
            guard size <= (markdown ? Self.maxDocumentBytes : Self.maxAssetBytes),
                  total <= Self.maxCollectionBytes else { throw ReaderFailure.tooLarge }
            let relative = values.isDirectory == true
                ? file.pathComponents.dropFirst(source.pathComponents.count).joined(separator: "/") : file.lastPathComponent
            let destination = try containedURL(base: content, path: relative, mustExist: false)
            try fm.createDirectory(at: destination.deletingLastPathComponent(), withIntermediateDirectories: true)
            // Validate UTF-8 before committing the collection; never silently replace invalid bytes.
            if markdown {
                guard String(data: try Data(contentsOf: file), encoding: .utf8) != nil else { throw ReaderFailure.invalidEncoding }
                entries.append(ReaderEntry(collection: id, path: relative, importedAt: importedAt))
            }
            try fm.copyItem(at: file, to: destination)
        }
        guard !entries.isEmpty else { throw ReaderFailure.emptyImport }
        try JSONEncoder().encode(entries).write(to: staging.appendingPathComponent("manifest.json"), options: .atomic)
        try fm.moveItem(at: staging, to: root.appendingPathComponent(id))
        return entries
    }

    func document(collection: String, path: String) throws -> String {
        let url = try resource(collection: collection, path: path)
        guard isMarkdown(url) else { throw ReaderFailure.unsupportedFile }
        let data = try boundedData(url, limit: Self.maxDocumentBytes)
        guard let text = String(data: data, encoding: .utf8) else { throw ReaderFailure.invalidEncoding }
        return text
    }

    func asset(collection: String, path: String) throws -> [String: String] {
        let url = try resource(collection: collection, path: path)
        guard let mime = Self.imageTypes[url.pathExtension.lowercased()] else { throw ReaderFailure.unsupportedFile }
        return ["mime": mime, "base64": try boundedData(url, limit: Self.maxAssetBytes).base64EncodedString()]
    }

    func remove(collection: String) throws {
        guard UUID(uuidString: collection) != nil else { throw ReaderFailure.invalidPath }
        try fm.removeItem(at: root.appendingPathComponent(collection))
    }

    private func resource(collection: String, path: String) throws -> URL {
        guard UUID(uuidString: collection) != nil else { throw ReaderFailure.invalidPath }
        return try containedURL(base: root.appendingPathComponent(collection).appendingPathComponent("content"), path: path, mustExist: true)
    }

    private func containedURL(base: URL, path: String, mustExist: Bool) throws -> URL {
        guard !path.isEmpty, !path.hasPrefix("/"), !path.contains("\\"), !path.contains("\0"),
              !path.split(separator: "/").contains("..") else { throw ReaderFailure.invalidPath }
        let canonicalBase = base.resolvingSymlinksInPath().standardizedFileURL
        let target = canonicalBase.appendingPathComponent(path).standardizedFileURL
        let resolvedBase = canonicalBase.path.hasSuffix("/") ? canonicalBase.path : canonicalBase.path + "/"
        guard target.resolvingSymlinksInPath().path.hasPrefix(resolvedBase) else { throw ReaderFailure.invalidPath }
        if mustExist && !fm.fileExists(atPath: target.path) { throw ReaderFailure.unavailable }
        return target
    }

    private func boundedData(_ url: URL, limit: Int) throws -> Data {
        guard (try url.resourceValues(forKeys: [.fileSizeKey]).fileSize ?? limit + 1) <= limit else { throw ReaderFailure.tooLarge }
        return try Data(contentsOf: url)
    }

    private func isMarkdown(_ url: URL) -> Bool { ["md", "markdown"].contains(url.pathExtension.lowercased()) }
}
