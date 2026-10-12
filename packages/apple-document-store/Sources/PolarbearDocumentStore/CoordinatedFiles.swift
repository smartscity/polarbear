import Foundation

protocol DocumentCoordination {
    func read<T>(_ url: URL, _ accessor: (URL) throws -> T) throws -> T
    func write<T>(_ url: URL, _ accessor: (URL) throws -> T) throws -> T
}

struct SystemDocumentCoordination: DocumentCoordination {
    func read<T>(_ url: URL, _ accessor: (URL) throws -> T) throws -> T {
        var error: NSError?
        var result: Result<T, Error>?
        NSFileCoordinator().coordinate(readingItemAt: url, options: [], error: &error) { coordinated in
            result = Result { try accessor(coordinated) }
        }
        if let error { throw error }
        guard let result else { throw DocumentFailure.unavailable }
        return try result.get()
    }

    func write<T>(_ url: URL, _ accessor: (URL) throws -> T) throws -> T {
        var error: NSError?
        var result: Result<T, Error>?
        NSFileCoordinator().coordinate(writingItemAt: url, options: .forReplacing, error: &error) { coordinated in
            result = Result { try accessor(coordinated) }
        }
        if let error { throw error }
        guard let result else { throw DocumentFailure.unavailable }
        return try result.get()
    }
}

func requestMaterializationIfNeeded(_ url: URL) throws {
    let values = try url.resourceValues(forKeys: [.isUbiquitousItemKey, .ubiquitousItemDownloadingStatusKey])
    if values.isUbiquitousItem == true, values.ubiquitousItemDownloadingStatus == .notDownloaded {
        // Materialization is a user-authorized consequence of opening the linked document.
        try FileManager.default.startDownloadingUbiquitousItem(at: url)
        throw DocumentFailure.downloading
    }
}

func readDocumentBytes(_ url: URL) throws -> Data {
    try requestMaterializationIfNeeded(url)
    let values = try url.resourceValues(forKeys: [.fileSizeKey, .isRegularFileKey, .isSymbolicLinkKey])
    guard values.isSymbolicLink != true, values.isRegularFile == true else { throw DocumentFailure.invalidPath }
    guard (values.fileSize ?? 0) <= DocumentLimits.bytes else { throw DocumentFailure.tooLarge }
    let handle = try FileHandle(forReadingFrom: url)
    defer { try? handle.close() }
    var data = Data()
    while data.count <= DocumentLimits.bytes {
        let part = try handle.read(upToCount: DocumentLimits.bytes + 1 - data.count) ?? Data()
        if part.isEmpty { break }
        data.append(part)
    }
    _ = try checkedText(data)
    return data
}
