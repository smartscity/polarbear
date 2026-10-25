#![allow(clippy::unwrap_used)]
use super::{
    conditional_publish::{github_publish, gitlab_publish},
    model::RepositoryBindingDto,
    sync_plan::Manifest,
};
use reqwest::blocking::Client;
use serde_json::{json, Value};
use std::{
    collections::BTreeMap,
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

fn binding(provider: &str) -> RepositoryBindingDto {
    serde_json::from_value(json!({"workspaceRef":"/fixture", "provider":provider, "owner":"owner", "repo":"notes", "branch":"main", "remotePath":"docs", "manifest":{}})).unwrap()
}

fn server(responses: Vec<Option<Value>>) -> (String, thread::JoinHandle<Vec<(String, Value)>>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let thread = thread::spawn(move || {
        let mut requests = Vec::new();
        for response in responses {
            let (mut socket, _) = listener.accept().unwrap();
            socket
                .set_read_timeout(Some(Duration::from_secs(5)))
                .unwrap();
            let mut bytes = Vec::new();
            let (header_end, length) = loop {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
                if let Some(end) = bytes.windows(4).position(|s| s == b"\r\n\r\n") {
                    let headers = String::from_utf8_lossy(&bytes[..end]);
                    let length = headers
                        .lines()
                        .find_map(|line| {
                            line.to_ascii_lowercase()
                                .strip_prefix("content-length: ")
                                .map(str::to_owned)
                        })
                        .map(|s| s.parse::<usize>().unwrap())
                        .unwrap_or(0);
                    break (end + 4, length);
                }
            };
            while bytes.len() < header_end + length {
                let mut buffer = [0; 4096];
                let n = socket.read(&mut buffer).unwrap();
                assert!(n > 0);
                bytes.extend_from_slice(&buffer[..n]);
            }
            let headers = String::from_utf8_lossy(&bytes[..header_end]).into_owned();
            let body = if length == 0 {
                Value::Null
            } else {
                serde_json::from_slice(&bytes[header_end..header_end + length]).unwrap()
            };
            requests.push((headers, body));
            if let Some(response) = response {
                let body = response.to_string();
                write!(
                    socket,
                    "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",
                    body.len()
                )
                .unwrap();
            }
        }
        requests
    });
    (url, thread)
}

fn client() -> Client {
    Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
}

#[test]
fn github_publishes_one_atomic_batch_with_the_planned_head_and_returns_its_commit() {
    let (url, server) = server(vec![Some(
        json!({"data":{"createCommitOnBranch":{"commit":{"oid":"acknowledged"}}}}),
    )]);
    let changes = BTreeMap::from([
        ("a.md".into(), Some(b"local".to_vec())),
        ("b.md".into(), None),
    ]);
    assert_eq!(
        github_publish(
            &client(),
            &url,
            &binding("github"),
            "planned-head",
            &changes
        )
        .unwrap(),
        "acknowledged"
    );
    let requests = server.join().unwrap();
    assert_eq!(requests.len(), 1);
    let input = &requests[0].1["variables"]["input"];
    assert_eq!(input["expectedHeadOid"], "planned-head");
    assert_eq!(input["fileChanges"]["additions"][0]["path"], "docs/a.md");
    assert_eq!(input["fileChanges"]["deletions"][0]["path"], "docs/b.md");
}

#[test]
fn github_conflict_and_unknown_outcome_never_retry_with_a_new_head() {
    for response in [Some(json!({"errors":[{"message":"Head changed"}]})), None] {
        let lost = response.is_none();
        let (url, server) = server(vec![response]);
        let error = github_publish(
            &client(),
            &url,
            &binding("github"),
            "planned-head",
            &BTreeMap::new(),
        )
        .unwrap_err();
        assert!(error.contains(if lost { "unknown" } else { "rejected" }));
        assert_eq!(server.join().unwrap().len(), 1);
    }
}

#[test]
fn gitlab_conditions_updates_on_file_versions_read_from_the_frozen_commit() {
    let (url, server) = server(vec![
        Some(json!({"last_commit_id":"file-at-frozen-head"})),
        Some(json!({"id":"acknowledged"})),
    ]);
    let changes = BTreeMap::from([("a.md".into(), Some(b"local".to_vec()))]);
    let remote = Manifest::from([("a.md".into(), "digest".into())]);
    assert_eq!(
        gitlab_publish(
            &client(),
            &url,
            &binding("gitlab"),
            "planned-head",
            &remote,
            &changes
        )
        .unwrap(),
        "acknowledged"
    );
    let requests = server.join().unwrap();
    assert!(requests[0].0.contains("ref=planned-head"));
    assert_eq!(
        requests[1].1["actions"][0]["last_commit_id"],
        "file-at-frozen-head"
    );
    assert_eq!(requests[1].1["branch"], "main");
    assert!(requests[1].1.get("force").is_none());
}
