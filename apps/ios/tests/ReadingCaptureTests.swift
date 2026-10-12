import Foundation

func testReadingCaptures(_ root: URL) throws {
    let store = ReadingCaptureStore(root: root.appendingPathComponent("captures"))
    let capture = ReadingCapture(requestId: UUID().uuidString, selectedText: "resilient", senseUid: nil,
        sentence: "A resilient team.", title: "中文.md", heading: "Teams", filePath: nil, line: nil)
    let saved = try store.save(capture)
    assert(saved == capture)
    _ = try store.save(capture)
    let reopened = ReadingCaptureStore(root: store.root)
    let entries = try reopened.list()
    assert(entries == [capture])
    let data = try store.export()
    let transfer = try JSONDecoder().decode(ReadingTransfer.self, from: data)
    assert(transfer.schemaVersion == 1 && transfer.captures == [capture])
    let changed = ReadingCapture(requestId: capture.requestId, selectedText: "other", senseUid: nil,
        sentence: "", title: "", heading: "", filePath: nil, line: nil)
    do { _ = try store.save(changed); fatalError("Reused IDs must reject different payloads") } catch ReadingFailure.invalidTerm {}
    try store.remove(capture.requestId)
    let empty = try store.list()
    assert(empty.isEmpty)
    try Data("corrupt".utf8).write(to: store.root.appendingPathComponent("pending-reading.json"))
    do { _ = try store.save(capture); fatalError("Corrupt queues must never be silently replaced") } catch {}
    let full = ReadingCaptureStore(root: root.appendingPathComponent("full"))
    for index in 0..<100 {
        _ = try full.save(ReadingCapture(requestId: UUID().uuidString, selectedText: "word", senseUid: nil,
            sentence: "Source \(index)", title: "", heading: "", filePath: nil, line: nil))
    }
    do { _ = try full.save(capture); fatalError("Queue must be bounded") } catch ReadingFailure.queueFull {}
    print("Reading capture persistence, transfer and validation passed")
}
