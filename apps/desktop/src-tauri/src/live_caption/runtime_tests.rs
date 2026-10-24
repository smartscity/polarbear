#![allow(clippy::unwrap_used)] // Fixture failures must fail the test, not be recovered.

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
