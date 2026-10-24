import Foundation

// Source timestamps detect loss; delivered sample positions determine PCM time.
// Callback arrival time must not be accumulated into the audio clock.
struct CaptionAudioClock {
    private var sourceOrigin: Double?
    private var sourceRate: Double = 0
    private var inputFrames: UInt64 = 0
    private var outputFrames: UInt64 = 0
    private var originMilliseconds: UInt64 = 0

    mutating func acceptInput(startSeconds: Double, frameCount: UInt32,
                              sampleRate: Double, sessionOffsetSeconds: Double) -> Bool {
        guard startSeconds.isFinite, sampleRate.isFinite, sampleRate > 0,
              sessionOffsetSeconds.isFinite, sessionOffsetSeconds >= 0,
              sessionOffsetSeconds < Double(UInt64.max / 1000), frameCount > 0 else { return false }
        if let origin = sourceOrigin {
            guard sampleRate == sourceRate else { return false }
            let expected = origin + Double(inputFrames) / sourceRate
            // Two input samples cover source timestamp quantization, not scheduling jitter.
            guard abs(startSeconds - expected) * sourceRate <= 2 else { return false }
        } else {
            sourceOrigin = startSeconds
            sourceRate = sampleRate
            originMilliseconds = UInt64(sessionOffsetSeconds * 1000)
        }
        let (next, overflow) = inputFrames.addingReportingOverflow(UInt64(frameCount))
        guard !overflow else { return false }
        inputFrames = next
        return true
    }

    mutating func packetTimestamp(frameCount: UInt32) -> UInt64? {
        guard sourceOrigin != nil, frameCount > 0 else { return nil }
        let (timestamp, timeOverflow) = originMilliseconds.addingReportingOverflow(outputFrames / 16)
        let (next, sampleOverflow) = outputFrames.addingReportingOverflow(UInt64(frameCount))
        guard !timeOverflow, !sampleOverflow else { return nil }
        outputFrames = next
        return timestamp
    }
}
