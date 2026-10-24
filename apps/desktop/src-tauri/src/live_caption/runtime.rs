use super::{CaptionError, CaptionResult};
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::{
    io::{BufRead, BufReader, Read, Write},
    path::PathBuf,
    process::{Child, Command, Stdio},
    sync::{
        atomic::{AtomicBool, AtomicI32, AtomicU32, Ordering},
        mpsc, Arc, Mutex, OnceLock,
    },
    time::{Duration, Instant},
};
use tauri::{Emitter, Manager};

const AUDIO_QUEUE_FRAMES: usize = 312;
const MAX_FRAME_SAMPLES: usize = 512;
const AUDIO_QUEUE_FULL: i32 = 9;
const ENGINE_PIPE_CLOSED: i32 = 10;
const AUDIO_DISCONTINUITY: i32 = 11;
const MAX_EVENT_BYTES: usize = 65536;
static AUDIO: OnceLock<Mutex<Option<CaptureIngress>>> = OnceLock::new();
static CAPTURE_READY: AtomicBool = AtomicBool::new(false);
static CAPTURE_ERROR: AtomicI32 = AtomicI32::new(0);
static AUDIO_LEVEL: AtomicU32 = AtomicU32::new(0);
static RECORDING_FAILED: AtomicBool = AtomicBool::new(false);

fn record_capture_failure(state: &AtomicI32, code: i32) {
    let _ = state.compare_exchange(0, code.max(2), Ordering::AcqRel, Ordering::Acquire);
}

struct Frame {
    at: u64,
    samples: Vec<f32>,
}

fn write_frame(output: &mut impl Write, frame: &Frame) -> std::io::Result<()> {
    if frame.samples.is_empty() || frame.samples.len() > MAX_FRAME_SAMPLES {
        return Err(std::io::Error::new(
            std::io::ErrorKind::InvalidInput,
            "Invalid caption PCM frame size",
        ));
    }
    // Encode once so an ordinary frame needs one pipe write, not one per sample.
    let mut bytes = [0u8; 12 + MAX_FRAME_SAMPLES * 4];
    bytes[..8].copy_from_slice(&frame.at.to_le_bytes());
    bytes[8..12].copy_from_slice(&(frame.samples.len() as u32).to_le_bytes());
    for (index, sample) in frame.samples.iter().enumerate() {
        bytes[12 + index * 4..16 + index * 4].copy_from_slice(&sample.to_le_bytes());
    }
    output.write_all(&bytes[..12 + frame.samples.len() * 4])?;
    output.flush()
}

struct CaptureIngress {
    sender: Option<mpsc::SyncSender<Frame>>,
    failure: Option<i32>,
}

impl CaptureIngress {
    fn new(sender: mpsc::SyncSender<Frame>) -> Self {
        Self {
            sender: Some(sender),
            failure: None,
        }
    }

    fn enqueue(&mut self, frame: Frame) -> Result<(), i32> {
        if let Some(code) = self.failure {
            return Err(code);
        }
        let result = self
            .sender
            .as_ref()
            .ok_or(ENGINE_PIPE_CLOSED)?
            .try_send(frame);
        result.map_err(|error| {
            let code = match error {
                mpsc::TrySendError::Full(_) => AUDIO_QUEUE_FULL,
                mpsc::TrySendError::Disconnected(_) => ENGINE_PIPE_CLOSED,
            };
            // Seal this epoch at the first missing frame; drain only its accepted prefix.
            self.failure = Some(code);
            self.sender = None;
            code
        })
    }
}

fn drain_capture(
    receiver: mpsc::Receiver<Frame>,
    output: &mut impl Write,
    mut recording: Option<super::recording::WavRecording<std::fs::File>>,
) -> std::io::Result<()> {
    let mut result = Ok(());
    for frame in receiver {
        if let Some(recorder) = recording.as_mut() {
            if recorder.append(&frame.samples).is_err() {
                let _ = recorder.finish();
                recording = None;
                RECORDING_FAILED.store(true, Ordering::Release);
            }
        }
        if let Err(error) = write_frame(output, &frame) {
            result = Err(error);
            break;
        }
    }
    if let Some(mut recorder) = recording {
        if recorder.finish().is_err() {
            RECORDING_FAILED.store(true, Ordering::Release);
        }
    }
    result
}

struct EngineProcess(Child);
impl std::ops::Deref for EngineProcess {
    type Target = Child;
    fn deref(&self) -> &Child {
        &self.0
    }
}
impl std::ops::DerefMut for EngineProcess {
    fn deref_mut(&mut self) -> &mut Child {
        &mut self.0
    }
}
impl Drop for EngineProcess {
    fn drop(&mut self) {
        let _ = self.0.kill();
        let _ = self.0.wait();
        stop_capture();
    }
}

#[derive(Clone, Default, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Status {
    pub session_id: Option<String>,
    pub state: String,
    pub source: String,
    pub partial: String,
    pub error: Option<String>,
    pub elapsed_ms: u64,
    pub audio_level: u32,
    pub view_revision: u64,
    pub history_requested: bool,
    pub record_audio: bool,
    pub recording_failed: bool,
    #[serde(skip)]
    pub final_sequence: i64,
    #[serde(skip)]
    pub partial_sequence: i64,
    #[serde(skip)]
    pub capture_generation: i64,
}

pub struct Run {
    pub cancel: Arc<AtomicBool>,
    pub done: mpsc::Receiver<()>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct EngineEvent {
    #[serde(rename = "type")]
    kind: String,
    #[serde(default)]
    sequence: i64,
    #[serde(default)]
    start_ms: i64,
    #[serde(default)]
    end_ms: i64,
    #[serde(default)]
    english: String,
    protocol: Option<u32>,
    code: Option<String>,
}

fn engine_failure_code(code: Option<&str>) -> &'static str {
    match code {
        Some("audioBacklog") => "audioBacklog",
        Some("modelInvalid") => "assetsInvalid",
        Some("engineFailed") => "engineFailed",
        _ => "engineProtocol",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Default)]
    struct FrameWriter {
        bytes: Vec<u8>,
        writes: usize,
        flushed: bool,
        short_write: bool,
        broken_after: Option<usize>,
    }

    impl Write for FrameWriter {
        fn write(&mut self, bytes: &[u8]) -> std::io::Result<usize> {
            if self.broken_after.is_some_and(|limit| self.writes >= limit) {
                return Err(std::io::ErrorKind::BrokenPipe.into());
            }
            self.writes += 1;
            let count = if self.short_write {
                bytes.len().min(7)
            } else {
                bytes.len()
            };
            self.bytes.extend_from_slice(&bytes[..count]);
            Ok(count)
        }

        fn flush(&mut self) -> std::io::Result<()> {
            self.flushed = true;
            Ok(())
        }
    }

    #[test]
    fn batches_pcm_without_changing_protocol_bytes_or_sample_order() {
        for count in [1, 317, MAX_FRAME_SAMPLES] {
            let frame = Frame {
                at: 0x0102030405060708,
                samples: (0..count).map(|i| (i as f32 - 256.0) / 256.0).collect(),
            };
            let mut expected = frame.at.to_le_bytes().to_vec();
            expected.extend_from_slice(&(count as u32).to_le_bytes());
            for sample in &frame.samples {
                expected.extend_from_slice(&sample.to_le_bytes());
            }
            for short_write in [false, true] {
                let mut output = FrameWriter {
                    short_write,
                    ..Default::default()
                };
                write_frame(&mut output, &frame).unwrap();
                assert_eq!(output.bytes, expected);
                assert!(output.flushed);
                if !short_write {
                    assert_eq!(output.writes, 1);
                }
            }
        }
    }

    #[test]
    fn rejects_invalid_frames_and_reports_partial_pipe_failure() {
        let mut output = FrameWriter::default();
        for count in [0, MAX_FRAME_SAMPLES + 1] {
            let error = write_frame(
                &mut output,
                &Frame {
                    at: 0,
                    samples: vec![0.0; count],
                },
            )
            .unwrap_err();
            assert_eq!(error.kind(), std::io::ErrorKind::InvalidInput);
        }
        assert_eq!(output.writes, 0);
        let mut broken = FrameWriter {
            short_write: true,
            broken_after: Some(1),
            ..Default::default()
        };
        let error = write_frame(
            &mut broken,
            &Frame {
                at: 0,
                samples: vec![0.0; MAX_FRAME_SAMPLES],
            },
        )
        .unwrap_err();
        assert_eq!(error.kind(), std::io::ErrorKind::BrokenPipe);
        assert!(!broken.flushed);
        assert_eq!(broken.bytes.len(), 7);
    }

    #[test]
    fn seals_admission_after_overflow_and_drains_the_accepted_prefix() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let mut ingress = CaptureIngress::new(sender);
        let frame = || Frame {
            at: 0,
            samples: vec![0.0; 512],
        };
        assert_eq!(ingress.enqueue(frame()), Ok(()));
        assert_eq!(ingress.enqueue(frame()), Err(AUDIO_QUEUE_FULL));
        receiver.recv().unwrap();
        assert_eq!(ingress.enqueue(frame()), Err(AUDIO_QUEUE_FULL));
        assert!(matches!(
            receiver.try_recv(),
            Err(mpsc::TryRecvError::Disconnected)
        ));
        let (sender, receiver) = mpsc::sync_channel(1);
        let mut ingress = CaptureIngress::new(sender);
        drop(receiver);
        assert_eq!(ingress.enqueue(frame()), Err(ENGINE_PIPE_CLOSED));
        assert_eq!(ingress.enqueue(frame()), Err(ENGINE_PIPE_CLOSED));
    }

    #[test]
    fn stop_drains_accepted_frames_before_closing_the_engine_input() {
        let (sender, receiver) = mpsc::sync_channel(3);
        let mut ingress = CaptureIngress::new(sender);
        let mut expected = FrameWriter::default();
        for index in 0..3 {
            let frame = Frame {
                at: index * 32,
                samples: vec![0.25; MAX_FRAME_SAMPLES],
            };
            write_frame(&mut expected, &frame).unwrap();
            ingress.enqueue(frame).unwrap();
        }
        drop(ingress);
        let mut actual = FrameWriter::default();
        drain_capture(receiver, &mut actual, None).unwrap();
        assert_eq!(actual.bytes, expected.bytes);
        assert_eq!(actual.writes, 3);
    }

    #[test]
    fn later_pipe_failure_cannot_replace_the_original_capture_error() {
        let failure = AtomicI32::new(0);
        record_capture_failure(&failure, AUDIO_QUEUE_FULL);
        record_capture_failure(&failure, ENGINE_PIPE_CLOSED);
        assert_eq!(failure.load(Ordering::Acquire), AUDIO_QUEUE_FULL);
    }

    #[test]
    fn engine_errors_preserve_overload_without_accepting_unknown_codes() {
        let event: EngineEvent =
            serde_json::from_str(r#"{"type":"error","code":"audioBacklog"}"#).unwrap();
        assert_eq!(engine_failure_code(event.code.as_deref()), "audioBacklog");
        assert_eq!(engine_failure_code(Some("modelInvalid")), "assetsInvalid");
        assert_eq!(engine_failure_code(Some("engineFailed")), "engineFailed");
        assert_eq!(
            engine_failure_code(Some("untrusted error")),
            "engineProtocol"
        );
        assert_eq!(engine_failure_code(None), "engineProtocol");
    }
}

#[cfg(target_os = "macos")]
extern "C" {
    fn polarbear_caption_capture_supported() -> i32;
    fn polarbear_caption_capture_start(
        microphone: i32,
        audio: extern "C" fn(*const f32, i32, u64),
        status: extern "C" fn(i32),
    );
    fn polarbear_caption_capture_stop();
}

extern "C" fn on_audio(samples: *const f32, count: i32, at: u64) {
    if CAPTURE_ERROR.load(Ordering::Acquire) != 0 {
        return;
    }
    if samples.is_null() || !(1..=MAX_FRAME_SAMPLES as i32).contains(&count) {
        record_capture_failure(&CAPTURE_ERROR, 2);
        return;
    }
    let Ok(mut sender) = AUDIO.get_or_init(|| Mutex::new(None)).try_lock() else {
        record_capture_failure(&CAPTURE_ERROR, 2);
        return;
    };
    if CAPTURE_ERROR.load(Ordering::Acquire) != 0 {
        return;
    }
    if let Some(sender) = sender.as_mut() {
        // The Swift buffer is valid only during this callback; copy into a bounded queue.
        let frame = Frame {
            at,
            samples: unsafe { std::slice::from_raw_parts(samples, count as usize) }.to_vec(),
        };
        let rms = (frame
            .samples
            .iter()
            .map(|sample| sample * sample)
            .sum::<f32>()
            / frame.samples.len() as f32)
            .sqrt();
        AUDIO_LEVEL.store((rms * 1000.0).clamp(0.0, 100.0) as u32, Ordering::Relaxed);
        if let Err(code) = sender.enqueue(frame) {
            record_capture_failure(&CAPTURE_ERROR, code);
        }
    }
}

extern "C" fn on_status(status: i32) {
    if status == 1 {
        CAPTURE_READY.store(true, Ordering::Release);
    } else {
        record_capture_failure(&CAPTURE_ERROR, status);
    }
}

pub fn stop_capture() {
    #[cfg(target_os = "macos")]
    unsafe {
        polarbear_caption_capture_stop();
    }
    if let Ok(mut sender) = AUDIO.get_or_init(|| Mutex::new(None)).lock() {
        *sender = None;
    }
    AUDIO_LEVEL.store(0, Ordering::Relaxed);
}

pub fn assets(app: &tauri::AppHandle) -> CaptionResult<PathBuf> {
    if !cfg!(target_os = "macos") {
        return Err(CaptionError::new("unsupportedPlatform"));
    }
    #[cfg(target_os = "macos")]
    if unsafe { polarbear_caption_capture_supported() } == 0 {
        return Err(CaptionError::new("unsupportedPlatform"));
    }
    #[cfg(target_arch = "x86_64")]
    if !std::is_x86_feature_detected!("avx2")
        || !std::is_x86_feature_detected!("fma")
        || !std::is_x86_feature_detected!("f16c")
        || !std::is_x86_feature_detected!("bmi2")
    {
        return Err(CaptionError::new("unsupportedCpu"));
    }
    let directory = if cfg!(debug_assertions) {
        PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("resources/caption")
    } else {
        app.path()
            .resource_dir()
            .map_err(|_| CaptionError::new("assetsMissing"))?
            .join("resources/caption")
    };
    for name in [
        "polarbear-caption-engine",
        "ggml-base.en-q5_1.bin",
        "ggml-silero-v6.2.0.bin",
    ] {
        if !directory.join(name).is_file() {
            return Err(CaptionError::new("assetsMissing"));
        }
    }
    let manifest: serde_json::Value =
        serde_json::from_str(include_str!("../../resources/caption/manifest.json"))
            .map_err(|_| CaptionError::new("assetsMissing"))?;
    for model in manifest["models"]
        .as_array()
        .ok_or_else(|| CaptionError::new("assetsMissing"))?
    {
        let name = model["file"]
            .as_str()
            .ok_or_else(|| CaptionError::new("assetsMissing"))?;
        let expected = model["sha256"]
            .as_str()
            .ok_or_else(|| CaptionError::new("assetsMissing"))?;
        let mut file = std::fs::File::open(directory.join(name))
            .map_err(|_| CaptionError::new("assetsMissing"))?;
        let mut hash = Sha256::new();
        let mut buffer = [0u8; 65536];
        loop {
            let count = file
                .read(&mut buffer)
                .map_err(|_| CaptionError::new("assetsMissing"))?;
            if count == 0 {
                break;
            }
            hash.update(&buffer[..count]);
        }
        if format!("{:x}", hash.finalize()) != expected {
            return Err(CaptionError::new("assetsInvalid"));
        }
    }
    Ok(directory)
}

pub fn launch(
    app: tauri::AppHandle,
    session: String,
    source: String,
    offset: u64,
    generation: i64,
    record_audio: bool,
) -> CaptionResult<Run> {
    if !cfg!(target_os = "macos") {
        return Err(CaptionError::new("unsupportedPlatform"));
    }
    let directory = assets(&app)?;
    let recording = if record_audio {
        let path = super::recordings_directory(&app)?
            .join(format!("{session}-{generation}-{offset}ms.wav"));
        Some(
            super::recording::WavRecording::create(&path)
                .map_err(|_| CaptionError::new("recordingsUnavailable"))?,
        )
    } else {
        None
    };
    let mut child = Command::new(directory.join("polarbear-caption-engine"))
        .arg(directory.join("ggml-base.en-q5_1.bin"))
        .arg(directory.join("ggml-silero-v6.2.0.bin"))
        .env_clear()
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::null())
        .spawn()
        .map(EngineProcess)
        .map_err(|_| CaptionError::new("engineSpawn"))?;
    let mut input = child
        .stdin
        .take()
        .ok_or_else(|| CaptionError::new("engineSpawn"))?;
    let output = child
        .stdout
        .take()
        .ok_or_else(|| CaptionError::new("engineSpawn"))?;
    let cancel = Arc::new(AtomicBool::new(false));
    let (sender, receiver) = mpsc::sync_channel::<Frame>(AUDIO_QUEUE_FRAMES);
    let (event_sender, events) = mpsc::sync_channel::<Result<EngineEvent, ()>>(8);
    let (done_sender, done) = mpsc::channel();
    CAPTURE_READY.store(false, Ordering::Release);
    CAPTURE_ERROR.store(0, Ordering::Release);
    RECORDING_FAILED.store(false, Ordering::Release);
    if let Ok(mut slot) = AUDIO.get_or_init(|| Mutex::new(None)).lock() {
        *slot = Some(CaptureIngress::new(sender));
    }
    let writer = std::thread::spawn(move || {
        // Stop closes the sender. Finish the admitted prefix before closing stdin.
        if drain_capture(receiver, &mut input, recording).is_err() {
            record_capture_failure(&CAPTURE_ERROR, ENGINE_PIPE_CLOSED);
        }
    });
    let reader = std::thread::spawn(move || {
        let mut output = BufReader::new(output);
        loop {
            let mut bytes = Vec::new();
            let result = output
                .by_ref()
                .take(MAX_EVENT_BYTES as u64 + 1)
                .read_until(b'\n', &mut bytes);
            if bytes.is_empty() {
                break;
            }
            let event = if result.is_err() || bytes.len() > MAX_EVENT_BYTES {
                Err(())
            } else {
                serde_json::from_slice(&bytes).map_err(|_| ())
            };
            let invalid = event.is_err();
            if event_sender.send(event).is_err() || invalid {
                break;
            }
        }
    });
    let worker_cancel = cancel.clone();
    std::thread::spawn(move || {
        let started = Instant::now();
        let mut stopping = None;
        let mut ready = false;
        let mut capture_offset = offset;
        let mut failure = None;
        loop {
            if CAPTURE_ERROR.load(Ordering::Acquire) != 0 {
                failure.get_or_insert(match CAPTURE_ERROR.load(Ordering::Acquire) {
                    3 => "microphoneDenied",
                    4 => "deviceLost",
                    6 => "unsupportedPlatform",
                    7 => "systemSuspended",
                    8 => "systemAudioDenied",
                    AUDIO_QUEUE_FULL => "audioBacklog",
                    ENGINE_PIPE_CLOSED => "engineFailed",
                    AUDIO_DISCONTINUITY => "captureDiscontinuity",
                    _ => "captureFailed",
                });
                worker_cancel.store(true, Ordering::Release);
            }
            if !ready && started.elapsed() > Duration::from_secs(60) {
                failure.get_or_insert("engineTimeout");
                worker_cancel.store(true, Ordering::Release);
            }
            if worker_cancel.load(Ordering::Acquire) && stopping.is_none() {
                stop_capture();
                stopping = Some(Instant::now());
            }
            if stopping.is_some_and(|time: Instant| time.elapsed() > Duration::from_secs(8)) {
                failure.get_or_insert("finalizationTimeout");
                let _ = child.kill();
                break;
            }
            match events.recv_timeout(Duration::from_millis(100)) {
                Ok(Ok(event)) => match event.kind.as_str() {
                    "ready" if worker_cancel.load(Ordering::Acquire) => {}
                    "ready"
                        if event.protocol == Some(1)
                            && !ready
                            && !worker_cancel.load(Ordering::Acquire) =>
                    {
                        ready = true;
                        capture_offset = offset + started.elapsed().as_millis() as u64;
                        #[cfg(target_os = "macos")]
                        unsafe {
                            polarbear_caption_capture_start(
                                i32::from(source == "microphone"),
                                on_audio,
                                on_status,
                            );
                        }
                    }
                    "partial" if ready => {
                        if event.sequence <= 0
                            || event.sequence >= 1_000_000
                            || app
                                .state::<super::CaptionService>()
                                .accept_partial(
                                    &session,
                                    generation * 1_000_000 + event.sequence,
                                    &event.english,
                                )
                                .is_err()
                        {
                            failure = Some("engineProtocol");
                            worker_cancel.store(true, Ordering::Release);
                        }
                    }
                    "final" if ready => {
                        let saved = (|| {
                            if event.sequence <= 0
                                || event.sequence >= 1_000_000
                                || event.start_ms < 0
                                || event.end_ms < event.start_ms
                            {
                                return Err(CaptionError::new("engineProtocol"));
                            }
                            let start = (capture_offset as i64)
                                .checked_add(event.start_ms)
                                .ok_or_else(|| CaptionError::new("engineProtocol"))?;
                            let end = (capture_offset as i64)
                                .checked_add(event.end_ms)
                                .ok_or_else(|| CaptionError::new("engineProtocol"))?;
                            app.state::<super::CaptionService>().accept_final(
                                &session,
                                generation * 1_000_000 + event.sequence,
                                start,
                                end,
                                &event.english,
                            )
                        })();
                        if let Err(error) = saved {
                            failure = Some(match error.code.as_str() {
                                "caption.engineProtocol" => "engineProtocol",
                                _ => "storageFailed",
                            });
                            worker_cancel.store(true, Ordering::Release);
                        }
                    }
                    "stopped" => {
                        if !worker_cancel.load(Ordering::Acquire) {
                            failure = Some("engineFailed");
                        }
                        break;
                    }
                    "error" => {
                        failure = Some(engine_failure_code(event.code.as_deref()));
                        worker_cancel.store(true, Ordering::Release);
                    }
                    _ => {
                        failure = Some("engineProtocol");
                        worker_cancel.store(true, Ordering::Release);
                    }
                },
                Ok(Err(())) => {
                    failure = Some("engineProtocol");
                    worker_cancel.store(true, Ordering::Release);
                }
                Err(mpsc::RecvTimeoutError::Disconnected) => {
                    if !worker_cancel.load(Ordering::Acquire) {
                        failure = Some("engineFailed");
                    }
                    break;
                }
                Err(mpsc::RecvTimeoutError::Timeout) => {}
            }
            if let Ok(mut status) = app.state::<super::CaptionService>().status.lock() {
                status.elapsed_ms = offset + started.elapsed().as_millis() as u64;
                status.audio_level = AUDIO_LEVEL.load(Ordering::Relaxed);
                status.recording_failed = RECORDING_FAILED.load(Ordering::Acquire);
                if CAPTURE_READY.load(Ordering::Acquire) && status.state == "starting" {
                    status.state = "capturing".into();
                    if app
                        .state::<super::CaptionService>()
                        .with_store(|db| {
                            db.state(&session, "capturing", status.elapsed_ms as i64, false)
                        })
                        .is_err()
                    {
                        failure = Some("storageFailed");
                        worker_cancel.store(true, Ordering::Release);
                    }
                }
            }
            if let Ok(Some(exit)) = child.try_wait() {
                if !exit.success() {
                    failure.get_or_insert("engineFailed");
                    worker_cancel.store(true, Ordering::Release);
                }
                // Drain final events already written to stdout before processing EOF.
            }
        }
        worker_cancel.store(true, Ordering::Release);
        stop_capture();
        let _ = child.kill();
        let _ = child.wait();
        drop(events);
        let _ = writer.join();
        let _ = reader.join();
        if let Ok(mut status) = app.state::<super::CaptionService>().status.lock() {
            status.recording_failed = RECORDING_FAILED.load(Ordering::Acquire);
        }
        if let Some(code) = failure {
            if let Ok(mut status) = app.state::<super::CaptionService>().status.lock() {
                status.state = "failed".into();
                status.error = Some(code.into());
                status.partial.clear();
                let _ = app
                    .state::<super::CaptionService>()
                    .with_store(|db| db.state(&session, "failed", status.elapsed_ms as i64, true));
            }
            let _ = app.emit("polarbear-caption-error", code);
        }
        drop(child);
        let _ = done_sender.send(());
    });
    Ok(Run { cancel, done })
}
