import Foundation

@main
struct CaptionAudioClockTests {
    static func main() {
        var clock = CaptionAudioClock()
        var emitted = 0
        for index in 0..<100 {
            precondition(clock.acceptInput(startSeconds: Double(index * 1024) / 48_000,
                                          frameCount: 1024, sampleRate: 48_000,
                                          sessionOffsetSeconds: 2 + Double(index) * 0.023))
            // Resampler output packet sizes vary; callback delay must not enter PCM time.
            let count = index % 3 == 0 ? 342 : 341
            precondition(clock.packetTimestamp(frameCount: UInt32(count)) == 2000 + UInt64(emitted / 16))
            emitted += count
        }
        // A source gap is rejected even though the output counter could hide it.
        precondition(!clock.acceptInput(startSeconds: Double(101 * 1024) / 48_000,
                                       frameCount: 1024, sampleRate: 48_000, sessionOffsetSeconds: 4))
        precondition(!clock.acceptInput(startSeconds: 0, frameCount: 1024,
                                       sampleRate: 48_000, sessionOffsetSeconds: 4))
        precondition(!clock.acceptInput(startSeconds: Double(100 * 1024) / 48_000,
                                       frameCount: 1024, sampleRate: 44_100, sessionOffsetSeconds: 4))
        var fragmented = CaptionAudioClock()
        precondition(fragmented.acceptInput(startSeconds: 50, frameCount: 5633,
                                           sampleRate: 16_000, sessionOffsetSeconds: 1))
        var total = 0
        for count in [512, 512, 512, 512, 512, 512, 512, 512, 512, 512, 100, 413] {
            precondition(fragmented.packetTimestamp(frameCount: UInt32(count)) == 1000 + UInt64(total / 16))
            total += count
        }
        var invalid = CaptionAudioClock()
        precondition(invalid.packetTimestamp(frameCount: 512) == nil)
        for start in [Double.nan, .infinity] {
            precondition(!invalid.acceptInput(startSeconds: start, frameCount: 512,
                                             sampleRate: 16_000, sessionOffsetSeconds: 0))
        }
        precondition(!invalid.acceptInput(startSeconds: 0, frameCount: 512,
                                         sampleRate: 0, sessionOffsetSeconds: 0))
        precondition(!invalid.acceptInput(startSeconds: 0, frameCount: 512,
                                         sampleRate: 16_000, sessionOffsetSeconds: -1))
        print("Caption clock: source continuity, resampling counts, packet fragmentation and callback jitter PASS")
    }
}
