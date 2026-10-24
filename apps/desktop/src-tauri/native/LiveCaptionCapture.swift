import AppKit
import AVFoundation
import CoreMedia
import ScreenCaptureKit

typealias CaptionAudioCallback = @convention(c) (UnsafePointer<Float>?, Int32, UInt64) -> Void
typealias CaptionStatusCallback = @convention(c) (Int32) -> Void
private let captionDiscontinuityStatus: Int32 = 11

@available(macOS 13.0, *)
private final class CaptionCapture: NSObject, SCStreamOutput, SCStreamDelegate, @unchecked Sendable {
    let audio: CaptionAudioCallback
    let status: CaptionStatusCallback
    private let queue = DispatchQueue(label: "dev.polarbear.caption.audio")
    private let lock = NSLock()
    private var active = true
    private var stream: SCStream?
    private var engine: AVAudioEngine?
    private var tapInstalled = false
    private var observers: [NSObjectProtocol] = []
    private let hostOrigin = CMClockGetTime(CMClockGetHostTimeClock()).seconds
    private var audioClock = CaptionAudioClock()
    private var converter: AVAudioConverter?
    private let target = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16_000, channels: 1, interleaved: false)!

    init(audio: @escaping CaptionAudioCallback, status: @escaping CaptionStatusCallback) {
        self.audio = audio
        self.status = status
    }

    func start(microphone: Bool) async {
        do {
            if microphone {
                let allowed = await AVCaptureDevice.requestAccess(for: .audio)
                guard allowed else { fail(3); return }
                guard isActive else { return }
                let engine = AVAudioEngine()
                self.engine = engine
                let input = engine.inputNode
                let format = input.outputFormat(forBus: 0)
                guard format.sampleRate > 0, format.channelCount > 0 else { fail(4); return }
                input.installTap(onBus: 0, bufferSize: 1024, format: format) { [weak self] buffer, time in
                    guard time.isSampleTimeValid, time.isHostTimeValid else { self?.fail(captionDiscontinuityStatus); return }
                    self?.convert(buffer, sourceSeconds: Double(time.sampleTime) / time.sampleRate,
                                  hostSeconds: AVAudioTime.seconds(forHostTime: time.hostTime))
                }
                tapInstalled = true
                try engine.start()
                observers.append(NotificationCenter.default.addObserver(forName: .AVAudioEngineConfigurationChange,
                    object: engine, queue: .main) { [weak self] _ in self?.fail(4) })
            } else {
                let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
                guard isActive else { return }
                guard let display = content.displays.first else { fail(4); return }
                let filter = SCContentFilter(display: display, excludingApplications: [], exceptingWindows: [])
                let config = SCStreamConfiguration()
                config.capturesAudio = true
                config.excludesCurrentProcessAudio = true
                config.sampleRate = 16_000
                config.channelCount = 1
                config.width = 2
                config.height = 2
                config.minimumFrameInterval = CMTime(value: 1, timescale: 1)
                config.queueDepth = 3
                let stream = SCStream(filter: filter, configuration: config, delegate: self)
                self.stream = stream
                try stream.addStreamOutput(self, type: .audio, sampleHandlerQueue: queue)
                try await stream.startCapture()
            }
            guard isActive else { stop(); return }
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.willSleepNotification,
                object: nil, queue: .main) { [weak self] _ in self?.fail(7) })
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.sessionDidResignActiveNotification,
                object: nil, queue: .main) { [weak self] _ in self?.fail(7) })
            observers.append(NSWorkspace.shared.notificationCenter.addObserver(forName: NSWorkspace.screensDidSleepNotification,
                object: nil, queue: .main) { [weak self] _ in self?.fail(7) })
            observers.append(DistributedNotificationCenter.default().addObserver(forName: NSNotification.Name("com.apple.screenIsLocked"),
                object: nil, queue: .main) { [weak self] _ in self?.fail(7) })
            status(1)
        } catch {
            let nativeError = error as NSError
            fail(nativeError.domain == SCStreamErrorDomain && nativeError.code == SCStreamError.userDeclined.rawValue ? 8 : 2)
        }
    }

    private var isActive: Bool { lock.lock(); defer { lock.unlock() }; return active }

    func stop() {
        lock.lock(); active = false; lock.unlock()
        engine?.stop()
        if tapInstalled { engine?.inputNode.removeTap(onBus: 0); tapInstalled = false }
        engine = nil
        if let old = stream { Task { try? await old.stopCapture() } }
        stream = nil
        for observer in observers {
            NotificationCenter.default.removeObserver(observer)
            NSWorkspace.shared.notificationCenter.removeObserver(observer)
            DistributedNotificationCenter.default().removeObserver(observer)
        }
        observers.removeAll()
    }

    private func fail(_ code: Int32) {
        guard isActive else { return }
        status(code)
        DispatchQueue.main.async { self.stop() }
    }

    private func convert(_ buffer: AVAudioPCMBuffer, sourceSeconds: Double, hostSeconds: Double) {
        lock.lock()
        defer { lock.unlock() }
        guard active else { return }
        guard buffer.frameLength > 0 else { return }
        guard audioClock.acceptInput(startSeconds: sourceSeconds, frameCount: buffer.frameLength,
                                     sampleRate: buffer.format.sampleRate,
                                     sessionOffsetSeconds: hostSeconds - hostOrigin) else {
            active = false
            status(captionDiscontinuityStatus)
            return
        }
        if converter == nil { converter = AVAudioConverter(from: buffer.format, to: target) }
        guard let converter, converter.inputFormat == buffer.format else { active = false; status(4); return }
        let capacity = AVAudioFrameCount(ceil(Double(buffer.frameLength) * 16_000 / buffer.format.sampleRate) + 32)
        guard let output = AVAudioPCMBuffer(pcmFormat: target, frameCapacity: capacity) else { status(4); return }
        var supplied = false
        var error: NSError?
        converter.convert(to: output, error: &error) { _, inputStatus in
            if supplied { inputStatus.pointee = .noDataNow; return nil }
            supplied = true
            inputStatus.pointee = .haveData
            return buffer
        }
        guard error == nil, let samples = output.floatChannelData?[0] else { status(4); return }
        var offset = 0
        while offset < Int(output.frameLength) {
            let count = min(512, Int(output.frameLength) - offset)
            guard let timestamp = audioClock.packetTimestamp(frameCount: UInt32(count)) else {
                active = false
                status(captionDiscontinuityStatus)
                return
            }
            audio(samples.advanced(by: offset), Int32(count), timestamp)
            offset += count
        }
    }

    func stream(_ stream: SCStream, didStopWithError error: Error) { fail(2) }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, isActive, sampleBuffer.isValid,
              let description = sampleBuffer.formatDescription else { return }
        let format = AVAudioFormat(cmAudioFormatDescription: description)
        var block: CMBlockBuffer?
        var needed = 0
        let first = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer,
            bufferListSizeNeededOut: &needed, bufferListOut: nil, bufferListSize: 0,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard first == noErr, needed > 0 else { return }
        let allocation = UnsafeMutableRawPointer.allocate(byteCount: needed, alignment: MemoryLayout<AudioBufferList>.alignment)
        defer { allocation.deallocate() }
        let list = allocation.assumingMemoryBound(to: AudioBufferList.self)
        let result = CMSampleBufferGetAudioBufferListWithRetainedBlockBuffer(sampleBuffer,
            bufferListSizeNeededOut: nil, bufferListOut: list, bufferListSize: needed,
            blockBufferAllocator: nil, blockBufferMemoryAllocator: nil, flags: 0, blockBufferOut: &block)
        guard result == noErr,
              let buffer = AVAudioPCMBuffer(pcmFormat: format, bufferListNoCopy: list, deallocator: nil) else { return }
        let timestamp = sampleBuffer.presentationTimeStamp.seconds
        convert(buffer, sourceSeconds: timestamp, hostSeconds: timestamp)
    }
}

private var currentCaptionCapture: AnyObject?

@_cdecl("polarbear_caption_capture_supported")
func captionCaptureSupported() -> Int32 {
    if #available(macOS 13.0, *) { return 1 }
    return 0
}

@_cdecl("polarbear_caption_capture_start")
func captionCaptureStart(_ microphone: Int32, _ audio: @escaping CaptionAudioCallback, _ status: @escaping CaptionStatusCallback) {
    guard #available(macOS 13.0, *) else { status(6); return }
    DispatchQueue.main.async {
        (currentCaptionCapture as? CaptionCapture)?.stop()
        let capture = CaptionCapture(audio: audio, status: status)
        currentCaptionCapture = capture
        Task { @MainActor in await capture.start(microphone: microphone != 0) }
    }
}

@_cdecl("polarbear_caption_capture_stop")
func captionCaptureStop() {
    guard #available(macOS 13.0, *) else { return }
    let stop = {
        (currentCaptionCapture as? CaptionCapture)?.stop()
        currentCaptionCapture = nil
    }
    if Thread.isMainThread { stop() } else { DispatchQueue.main.sync(execute: stop) }
}
