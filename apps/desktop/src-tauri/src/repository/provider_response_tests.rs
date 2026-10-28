#![allow(clippy::unwrap_used)]
use super::provider::{github_api_error, github_get, gitlab_download_file};
use reqwest::blocking::Client;
use std::{
    io::{Read, Write},
    net::TcpListener,
    thread,
    time::Duration,
};

fn response(
    headers: String,
    body: Vec<u8>,
) -> (reqwest::blocking::Response, thread::JoinHandle<()>) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        assert!(stream.read(&mut request).unwrap() > 0);
        stream.write_all(headers.as_bytes()).unwrap();
        // An early size rejection is allowed to close the socket before the body is sent.
        let _ = stream.write_all(&body);
    });
    let result = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap()
        .get(format!("http://{address}"))
        .send()
        .unwrap();
    (result, server)
}

#[test]
fn provider_error_body_is_bounded_without_losing_permission_diagnostics() {
    let (response, server) = response(
        "HTTP/1.1 403 Forbidden\r\nContent-Length: 999999999\r\nConnection: close\r\n\r\n".into(),
        Vec::new(),
    );
    let error = github_api_error(response, "publish");
    server.join().unwrap();
    assert!(error.contains("Contents to Read and write"));
    assert!(error.contains("size limit"), "{error}");
}

#[test]
fn provider_json_rejects_chunked_oversize_before_deserializing() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        assert!(stream.read(&mut request).unwrap() > 0);
        stream
            .write_all(
                b"HTTP/1.1 200 OK\r\nTransfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
            )
            .unwrap();
        let body = format!("\"{}\"", "x".repeat(16 * 1024 * 1024));
        let _ = write!(stream, "{:x}\r\n{}\r\n0\r\n\r\n", body.len(), body);
    });
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let result = github_get::<String>(&client, &format!("http://{address}"));
    server.join().unwrap();
    assert!(
        matches!(result, Err(error) if error.contains("size limit")),
        "Oversized JSON must be rejected"
    );
}

#[test]
fn gitlab_download_rejects_oversized_declared_body_before_reading() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        assert!(stream.read(&mut request).unwrap() > 0);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 67108865\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let mut binding: super::model::RepositoryBindingDto = serde_json::from_value(serde_json::json!({
        "workspaceRef":"/fixture", "provider":"gitlab", "owner":"owner", "repo":"repo", "branch":"main",
        "remotePath":"", "manifest":{}, "hasSynced":false
    })).unwrap();
    binding.base_url = Some(format!("http://{address}"));
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let error = gitlab_download_file(&client, &binding, "note.md").unwrap_err();
    server.join().unwrap();
    assert!(error.contains("size limit"), "{error}");
}

#[test]
fn bounded_response_checks_actual_bytes_with_or_without_length_or_chunks() {
    for framing in ["length", "chunked", "eof"] {
        for size in [0, 8, 9] {
            let body = vec![b'x'; size];
            let (headers, wire) = match framing {
                "length" => (format!("Content-Length: {size}\r\n"), body.clone()),
                "chunked" => (
                    "Transfer-Encoding: chunked\r\n".into(),
                    if size == 0 {
                        b"0\r\n\r\n".to_vec()
                    } else {
                        format!(
                            "{size:x}\r\n{}\r\n0\r\n\r\n",
                            String::from_utf8_lossy(&body)
                        )
                        .into_bytes()
                    },
                ),
                _ => (String::new(), body.clone()),
            };
            let (response, server) = response(
                format!("HTTP/1.1 200 OK\r\n{headers}Connection: close\r\n\r\n"),
                wire,
            );
            let result = super::response_limits::bytes(response, 8);
            server.join().unwrap();
            if size <= 8 {
                assert_eq!(result.unwrap(), body);
            } else {
                assert!(result.unwrap_err().contains("size limit"));
            }
        }
    }
}

#[test]
fn truncated_bodies_and_invalid_json_remain_failures() {
    let (truncated, server) = response(
        "HTTP/1.1 200 OK\r\nContent-Length: 8\r\nConnection: close\r\n\r\n".into(),
        b"short".to_vec(),
    );
    assert!(super::response_limits::bytes(truncated, 8).is_err());
    server.join().unwrap();
    let (invalid, server) = response(
        "HTTP/1.1 200 OK\r\nContent-Length: 1\r\nConnection: close\r\n\r\n".into(),
        b"{".to_vec(),
    );
    assert!(super::response_limits::json::<serde_json::Value>(invalid, 8).is_err());
    server.join().unwrap();
}

#[test]
fn enumeration_rejects_repeated_pages_and_limits_retained_entries() {
    use super::response_limits::{next_page, EnumerationBudget};
    for invalid in ["1", "0", "-1", "bad"] {
        assert!(next_page(1, invalid).is_err());
    }
    assert_eq!(next_page(1, "2").unwrap(), Some(2));
    assert_eq!(next_page(1, "").unwrap(), None);
    let mut budget = EnumerationBudget::default();
    budget.admit_entries(10_000).unwrap();
    assert!(budget.admit_entries(1).is_err());
    let mut budget = EnumerationBudget::default();
    for page in 0..101 {
        let (response, server) = response(
            "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n".into(),
            b"[]".to_vec(),
        );
        let result = budget.read_page::<Vec<serde_json::Value>>(response);
        server.join().unwrap();
        assert_eq!(result.is_ok(), page < 100);
    }
}

#[test]
fn oversized_successful_commit_acknowledgment_is_an_unknown_outcome() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let address = listener.local_addr().unwrap();
    let server = thread::spawn(move || {
        let (mut stream, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        assert!(stream.read(&mut request).unwrap() > 0);
        stream
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 16777217\r\nConnection: close\r\n\r\n")
            .unwrap();
    });
    let binding = serde_json::from_value(serde_json::json!({ "workspaceRef":"/fixture", "provider":"github", "owner":"owner", "repo":"repo", "branch":"main", "remotePath":"", "manifest":{} })).unwrap();
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_secs(5))
        .build()
        .unwrap();
    let error = super::conditional_publish::github_publish(
        &client,
        &format!("http://{address}"),
        &binding,
        "frozen",
        &Default::default(),
    )
    .unwrap_err();
    server.join().unwrap();
    assert!(error.contains("outcome is unknown"), "{error}");
    assert!(error.contains("size limit"), "{error}");
}

#[test]
fn enumeration_caps_cumulative_wire_bytes_not_only_each_page() {
    let mut budget = super::response_limits::EnumerationBudget::default();
    let page = format!("\"{}\"", "x".repeat(16 * 1024 * 1024 - 2)).into_bytes();
    for _ in 0..4 {
        let (response, server) = response(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
                page.len()
            ),
            page.clone(),
        );
        budget.read_page::<String>(response).unwrap();
        server.join().unwrap();
    }
    let (response, server) = response(
        "HTTP/1.1 200 OK\r\nContent-Length: 2\r\nConnection: close\r\n\r\n".into(),
        b"[]".to_vec(),
    );
    assert!(budget
        .read_page::<Vec<String>>(response)
        .unwrap_err()
        .contains("size limit"));
    server.join().unwrap();
}

#[test]
fn github_raw_download_uses_frozen_ref_and_preserves_large_markdown_and_binary() {
    for (path, body) in [
        ("small.md", b"# small".to_vec()),
        ("large.md", vec![b'x'; 1_048_577]),
        (
            "image.png",
            (0..1_048_577).map(|i| (i % 256) as u8).collect(),
        ),
    ] {
        let (result, request) = github_download_fixture(path, "200 OK", "", &body, false);
        assert_eq!(result.unwrap(), body);
        assert!(
            request.contains(&format!("/{path}?ref=frozen-commit")),
            "{request}"
        );
        assert!(
            request
                .to_ascii_lowercase()
                .contains("accept: application/vnd.github.raw+json"),
            "{request}"
        );
        assert!(request.contains("Bearer fixture-only"));
    }
}

fn github_download_fixture(
    path: &str,
    status: &str,
    framing: &str,
    body: &[u8],
    chunked: bool,
) -> (Result<Vec<u8>, String>, String) {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let endpoint = format!("http://{}/{path}", listener.local_addr().unwrap());
    let body = body.to_vec();
    let status = status.to_owned();
    let framing = framing.to_owned();
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        socket
            .set_read_timeout(Some(Duration::from_secs(5)))
            .unwrap();
        let mut request = Vec::new();
        while !request.windows(4).any(|s| s == b"\r\n\r\n") {
            let mut bytes = [0; 4096];
            let n = socket.read(&mut bytes).unwrap();
            assert!(n > 0);
            request.extend_from_slice(&bytes[..n]);
        }
        write!(
            socket,
            "HTTP/1.1 {status}\r\n{framing}Connection: close\r\n\r\n"
        )
        .unwrap();
        if chunked {
            if write!(socket, "{:x}\r\n", body.len()).is_ok() && socket.write_all(&body).is_ok() {
                let _ = socket.write_all(b"\r\n0\r\n\r\n");
            }
        } else {
            let _ = socket.write_all(&body);
        }
        String::from_utf8(request).unwrap()
    });
    let client = super::provider::github_client("fixture-only").unwrap();
    let result = super::provider::github_download_content(&client, &endpoint, "frozen-commit");
    (result, server.join().unwrap())
}

#[test]
fn github_raw_download_bounds_real_streams_and_preserves_http_failures() {
    let limit = super::response_limits::FILE_BYTES;
    for (size, chunked) in [(limit, false), (limit + 1, false), (limit + 1, true)] {
        let body = vec![b'x'; size];
        let (result, _) = github_download_fixture(
            "attachment.png",
            "200 OK",
            if chunked {
                "Transfer-Encoding: chunked\r\n"
            } else {
                ""
            },
            &body,
            chunked,
        );
        if size == limit {
            assert_eq!(result.unwrap().len(), limit);
        } else {
            assert!(result.unwrap_err().contains("size limit"));
        }
    }
    for status in [
        "401 Unauthorized",
        "403 Forbidden",
        "404 Not Found",
        "429 Too Many Requests",
    ] {
        let (result, _) =
            github_download_fixture("note.md", status, "Content-Length: 0\r\n", b"", false);
        assert!(result.unwrap_err().contains(&status[..3]));
    }
    for (headers, body, expected) in [
        ("Content-Length: 67108865\r\n", &b""[..], "size limit"),
        ("Content-Length: 10\r\n", &b"short"[..], "Could not read"),
        (
            "Transfer-Encoding: chunked\r\n",
            &b"a\r\nshort"[..],
            "Could not read",
        ),
    ] {
        let (result, _) = github_download_fixture("note.md", "200 OK", headers, body, false);
        assert!(result.unwrap_err().contains(expected));
    }
}

#[test]
fn github_download_rejects_redirects_without_forwarding_credentials() {
    let (result, _) = github_download_fixture(
        "note.md",
        "302 Found",
        "Location: http://127.0.0.1:1/untrusted\r\nContent-Length: 0\r\n",
        b"",
        false,
    );
    assert!(result.unwrap_err().contains("302"));
}

#[test]
fn github_download_timeout_is_a_failure_without_partial_content() {
    let listener = TcpListener::bind("127.0.0.1:0").unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let server = thread::spawn(move || {
        let (mut socket, _) = listener.accept().unwrap();
        let mut request = [0; 4096];
        assert!(socket.read(&mut request).unwrap() > 0);
        socket
            .write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 10\r\nConnection: close\r\n\r\nshort")
            .unwrap();
        thread::sleep(Duration::from_millis(150));
    });
    let client = Client::builder()
        .no_proxy()
        .timeout(Duration::from_millis(50))
        .build()
        .unwrap();
    assert!(super::provider::github_download_content(&client, &url, "frozen").is_err());
    server.join().unwrap();
}
