import Foundation

struct ReadingCapture: Codable, Equatable {
    let requestId: String
    let selectedText: String
    let senseUid: String?
    let sentence: String
    let title: String
    let heading: String
    let filePath: String?
    let line: Int?

    func validate() throws {
        guard UUID(uuidString: requestId) != nil, senseUid == nil, filePath == nil, line == nil,
              !selectedText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
              selectedText.count <= 80, sentence.count <= 2000, title.count <= 300, heading.count <= 300,
              ![selectedText, sentence, title, heading].contains(where: { $0.contains("\0") }) else {
            throw ReadingFailure.invalidTerm
        }
    }
}

struct ReadingTransfer: Codable {
    let schemaVersion: Int
    let captures: [ReadingCapture]
}

enum ReadingFailure: String, Error {
    case invalidTerm, queueFull, storageError, busy
}

struct ReadingCaptureStore {
    let root: URL
    private var file: URL { root.appendingPathComponent("pending-reading.json") }

    func list() throws -> [ReadingCapture] {
        guard FileManager.default.fileExists(atPath: file.path) else { return [] }
        let transfer = try JSONDecoder().decode(ReadingTransfer.self, from: Data(contentsOf: file))
        guard transfer.schemaVersion == 1, transfer.captures.count <= 100 else { throw ReadingFailure.storageError }
        for capture in transfer.captures { try capture.validate() }
        return transfer.captures
    }

    func save(_ capture: ReadingCapture) throws -> ReadingCapture {
        try capture.validate()
        var captures = try list()
        if let existing = captures.first(where: { $0.requestId == capture.requestId }) {
            guard existing == capture else { throw ReadingFailure.invalidTerm }
            return existing
        }
        // Repeated selections of the same source do not create duplicate pending records.
        if let existing = captures.first(where: {
            $0.selectedText == capture.selectedText && $0.sentence == capture.sentence && $0.title == capture.title && $0.heading == capture.heading
        }) { return existing }
        guard captures.count < 100 else { throw ReadingFailure.queueFull }
        captures.append(capture)
        try write(captures)
        return capture
    }

    func remove(_ requestId: String) throws { try write(list().filter { $0.requestId != requestId }) }
    func export() throws -> Data { try JSONEncoder().encode(ReadingTransfer(schemaVersion: 1, captures: list())) }

    private func write(_ captures: [ReadingCapture]) throws {
        try FileManager.default.createDirectory(at: root, withIntermediateDirectories: true)
        let data = try JSONEncoder().encode(ReadingTransfer(schemaVersion: 1, captures: captures))
        try data.write(to: file, options: .atomic)
    }
}
