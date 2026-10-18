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
const MAX_EVENT_BYTES: usize = 65536;
static AUDIO: OnceLock<Mutex<Option<mpsc::SyncSender<Frame>>>> = OnceLock::new();
static CAPTURE_FAILED: AtomicBool = AtomicBool::new(false);
static CAPTURE_READY: AtomicBool = AtomicBool::new(false);
static CAPTURE_ERROR: AtomicI32 = AtomicI32::new(0);
static AUDIO_LEVEL: AtomicU32 = AtomicU32::new(0);

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

fn enqueue_frame(sender: &mpsc::SyncSender<Frame>, frame: Frame) -> Result<(), i32> {
    sender.try_send(frame).map_err(|error| match error {
        mpsc::TrySendError::Full(_) => AUDIO_QUEUE_FULL,
        mpsc::TrySendError::Disconnected(_) => ENGINE_PIPE_CLOSED,
    })
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
    fn distinguishes_a_full_capture_queue_from_a_disconnected_engine() {
        let (sender, receiver) = mpsc::sync_channel(1);
        let frame = || Frame {
            at: 0,
            samples: vec![0.0; 512],
        };
        assert_eq!(enqueue_frame(&sender, frame()), Ok(()));
        assert_eq!(enqueue_frame(&sender, frame()), Err(AUDIO_QUEUE_FULL));
        receiver.recv().unwrap();
        assert_eq!(enqueue_frame(&sender, frame()), Ok(()));
        drop(receiver);
        assert_eq!(enqueue_frame(&sender, frame()), Err(ENGINE_PIPE_CLOSED));
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
    if samples.is_null() || !(1..=MAX_FRAME_SAMPLES as i32).contains(&count) {
        CAPTURE_FAILED.store(true, Ordering::Release);
        return;
    }
    let Ok(sender) = AUDIO.get_or_init(|| Mutex::new(None)).try_lock() else {
        CAPTURE_FAILED.store(true, Ordering::Release);
        return;
    };
    if let Some(sender) = sender.as_ref() {
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
        if let Err(code) = enqueue_frame(sender, frame) {
            CAPTURE_ERROR.store(code, Ordering::Release);
            CAPTURE_FAILED.store(true, Ordering::Release);
        }
    }
}

extern "C" fn on_status(status: i32) {
    if status == 1 {
        CAPTURE_READY.store(true, Ordering::Release);
    } else {
        CAPTURE_ERROR.store(status, Ordering::Release);
        CAPTURE_FAILED.store(true, Ordering::Release);
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
) -> CaptionResult<Run> {
    if !cfg!(target_os = "macos") {
        return Err(CaptionError::new("unsupportedPlatform"));
    }
    let directory = assets(&app)?;
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
    let writer_cancel = cancel.clone();
    let (sender, receiver) = mpsc::sync_channel::<Frame>(AUDIO_QUEUE_FRAMES);
    let (event_sender, events) = mpsc::sync_channel::<Result<EngineEvent, ()>>(8);
    let (done_sender, done) = mpsc::channel();
    CAPTURE_FAILED.store(false, Ordering::Release);
    CAPTURE_READY.store(false, Ordering::Release);
    CAPTURE_ERROR.store(0, Ordering::Release);
    if let Ok(mut slot) = AUDIO.get_or_init(|| Mutex::new(None)).lock() {
        *slot = Some(sender);
    }
    let writer = std::thread::spawn(move || {
        while !writer_cancel.load(Ordering::Acquire) {
            let frame = match receiver.recv_timeout(Duration::from_millis(100)) {
                Ok(frame) => frame,
                Err(mpsc::RecvTimeoutError::Timeout) => continue,
                Err(_) => break,
            };
            if writer_cancel.load(Ordering::Acquire) {
                break;
            }
            let result = write_frame(&mut input, &frame);
            if result.is_err() {
                CAPTURE_ERROR.store(ENGINE_PIPE_CLOSED, Ordering::Release);
                CAPTURE_FAILED.store(true, Ordering::Release);
                break;
            }
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
            if CAPTURE_READY.load(Ordering::Acquire)
                && super::store::now()
                    - app
                        .state::<super::CaptionService>()
                        .panel_seen
                        .load(Ordering::Acquire)
                    > 10_000
            {
                failure.get_or_insert("panelUnavailable");
                worker_cancel.store(true, Ordering::Release);
            }
            if CAPTURE_FAILED.load(Ordering::Acquire) {
                failure.get_or_insert(match CAPTURE_ERROR.load(Ordering::Acquire) {
                    3 => "microphoneDenied",
                    4 => "deviceLost",
                    6 => "unsupportedPlatform",
                    7 => "systemSuspended",
                    8 => "systemAudioDenied",
                    AUDIO_QUEUE_FULL => "audioBacklog",
                    ENGINE_PIPE_CLOSED => "engineFailed",
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
                        if let Ok(mut status) = app.state::<super::CaptionService>().status.lock() {
                            status.partial = event.english;
                        }
                    }
                    "final" if ready => {
                        let saved = app.state::<super::CaptionService>().with_store(|db| {
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
                            db.append(
                                &session,
                                generation * 1_000_000 + event.sequence,
                                start,
                                end,
                                &event.english,
                            )?;
                            if db.pending()? > 60 {
                                return Err(CaptionError::new("translationBacklog"));
                            }
                            Ok(())
                        });
                        if let Err(error) = saved {
                            failure = Some(match error.code.as_str() {
                                "caption.translationBacklog" => "translationBacklog",
                                "caption.engineProtocol" => "engineProtocol",
                                _ => "storageFailed",
                            });
                            worker_cancel.store(true, Ordering::Release);
                        }
                        if let Ok(mut status) = app.state::<super::CaptionService>().status.lock() {
                            status.partial.clear();
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
