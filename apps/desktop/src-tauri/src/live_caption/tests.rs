#![allow(clippy::unwrap_used)] // Test setup and assertions deliberately fail on invalid fixtures.
use super::*;

fn service() -> CaptionService {
    let db = store::CaptionStore::memory();
    let id = db.create("microphone").unwrap();
    CaptionService {
        database: Mutex::new(Some(db)),
        status: Mutex::new(runtime::Status {
            session_id: Some(id),
            state: "capturing".into(),
            ..Default::default()
        }),
        ..Default::default()
    }
}

#[test]
fn final_commit_and_partial_are_one_projection_without_text_deduplication() {
    let service = service();
    let id = service.live_snapshot().unwrap().status.session_id.unwrap();
    service
        .accept_partial(&id, 1, "Permanently. Permanently.")
        .unwrap();
    service
        .accept_final(&id, 1, 0, 1000, "Permanently. Permanently.")
        .unwrap();
    service.accept_partial(&id, 1, "stale partial").unwrap();
    service
        .accept_final(&id, 1, 0, 1000, "duplicate event must not replace text")
        .unwrap();
    let snapshot = service.live_snapshot().unwrap();
    assert!(snapshot.status.partial.is_empty());
    assert_eq!(snapshot.segments.len(), 1);
    assert_eq!(snapshot.segments[0].english, "Permanently. Permanently.");
    service.accept_partial(&id, 3, "next utterance").unwrap();
    service.accept_partial(&id, 2, "older revision").unwrap();
    service
        .accept_final(&id, 2, 1000, 2000, "Another final.")
        .unwrap();
    assert_eq!(
        service.live_snapshot().unwrap().status.partial,
        "next utterance"
    );
}

#[test]
fn simulated_two_hour_history_without_a_panel_or_translator_remains_bounded() {
    let service = service();
    let id = service.live_snapshot().unwrap().status.session_id.unwrap();
    // Logical audio time, not a two-hour wall-clock microphone qualification.
    for sequence in 1..=7200 {
        service
            .accept_partial(&id, sequence, "English speech")
            .unwrap();
        service
            .accept_final(
                &id,
                sequence,
                (sequence - 1) * 1000,
                sequence * 1000,
                "English speech.",
            )
            .unwrap();
    }
    let snapshot = service.live_snapshot().unwrap();
    assert_eq!(snapshot.status.state, "capturing");
    assert!(snapshot.status.partial.is_empty());
    assert_eq!(snapshot.segments.len(), 200);
    assert_eq!(snapshot.segments.last().unwrap().end_ms, 7_200_000);
    assert_eq!(service.with_store(|db| db.pending()).unwrap(), 7200);
    assert_eq!(
        service.with_store(|db| db.list("", 0)).unwrap()[0].count,
        7200
    );
}

#[test]
fn failed_persistence_does_not_publish_a_final_or_discard_its_partial() {
    let service = service();
    let id = service.live_snapshot().unwrap().status.session_id.unwrap();
    service.accept_partial(&id, 1, "Uncommitted text").unwrap();
    assert!(service
        .accept_final(&id, 1, 1000, 0, "Uncommitted text")
        .is_err());
    let snapshot = service.live_snapshot().unwrap();
    assert_eq!(snapshot.status.partial, "Uncommitted text");
    assert!(snapshot.segments.is_empty());
}

#[test]
fn events_from_a_previous_session_or_capture_epoch_cannot_pollute_current_text() {
    let service = service();
    let id = service.live_snapshot().unwrap().status.session_id.unwrap();
    service
        .accept_partial("previous-session", 1, "old speech")
        .unwrap();
    service
        .accept_final("previous-session", 1, 0, 1000, "old speech")
        .unwrap();
    service.status.lock().unwrap().capture_generation = 1;
    service.accept_partial(&id, 1, "old epoch").unwrap();
    service.accept_final(&id, 1, 0, 1000, "old epoch").unwrap();
    assert!(service.live_snapshot().unwrap().segments.is_empty());
    assert!(service.live_snapshot().unwrap().status.partial.is_empty());
    service
        .accept_final(&id, 1_000_001, 2000, 3000, "new epoch")
        .unwrap();
    assert_eq!(
        service.live_snapshot().unwrap().segments[0].english,
        "new epoch"
    );
}

#[test]
fn recording_requires_an_explicit_start_request_flag() {
    let request: Request =
        serde_json::from_str(r#"{"action":"start","source":"microphone"}"#).unwrap();
    assert!(matches!(
        request,
        Request::Start {
            record_audio: false,
            ..
        }
    ));
    let request: Request =
        serde_json::from_str(r#"{"action":"start","source":"microphone","recordAudio":true}"#)
            .unwrap();
    assert!(matches!(
        request,
        Request::Start {
            record_audio: true,
            ..
        }
    ));
}
