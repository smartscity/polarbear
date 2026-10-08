use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::Manager;

const MAX_REQUEST_BYTES: usize = 32 * 1024;
#[cfg(unix)]
const MAX_RESPONSE_BYTES: u64 = 256 * 1024;

#[derive(Deserialize, Serialize)]
#[serde(tag = "method", rename_all = "camelCase", deny_unknown_fields)]
pub enum VocabOperation {
    Lookup { query: String },
    Save { capture: Value },
    Speak { text: String },
}

#[derive(Debug, Serialize)]
pub struct VocabError {
    code: String,
    message: String,
}

fn failure(code: &str) -> VocabError {
    VocabError {
        code: code.into(),
        message: format!("Vocab: {code}"),
    }
}

#[tauri::command]
pub async fn vocab_request(
    app: tauri::AppHandle,
    operation: VocabOperation,
) -> Result<Value, VocabError> {
    let mut request =
        serde_json::to_vec(&serde_json::json!({"version": 1, "operation": operation}))
            .map_err(|_| failure("invalidInput"))?;
    request.push(b'\n');
    if request.len() > MAX_REQUEST_BYTES {
        return Err(failure("invalidInput"));
    }
    let directory = app
        .path()
        .data_dir()
        .map_err(|_| failure("unavailable"))?
        .join("com.polarbear.vocab")
        .join("reading");
    tauri::async_runtime::spawn_blocking(move || exchange(&directory, &request))
        .await
        .map_err(|_| failure("unavailable"))?
}

#[cfg(unix)]
fn exchange(directory: &std::path::Path, request: &[u8]) -> Result<Value, VocabError> {
    use std::io::{BufRead, BufReader, Read, Write};
    use std::os::unix::net::UnixStream;
    use std::time::{Duration, Instant};
    let path = directory.join("v1.sock");
    let mut stream = match UnixStream::connect(&path) {
        Ok(stream) => stream,
        Err(_) => {
            launch_vocab()?;
            let deadline = Instant::now() + Duration::from_secs(8);
            loop {
                if let Ok(stream) = UnixStream::connect(&path) {
                    break stream;
                }
                if Instant::now() >= deadline {
                    return Err(failure("unavailable"));
                }
                std::thread::sleep(Duration::from_millis(100));
            }
        }
    };
    validate_socket(directory, &path)?;
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| failure("unavailable"))?;
    stream
        .set_write_timeout(Some(Duration::from_secs(2)))
        .map_err(|_| failure("unavailable"))?;
    stream
        .write_all(request)
        .map_err(|_| failure("unavailable"))?;
    let mut bytes = Vec::new();
    BufReader::new(stream.take(MAX_RESPONSE_BYTES + 1))
        .read_until(b'\n', &mut bytes)
        .map_err(|_| failure("timeout"))?;
    if bytes.len() as u64 > MAX_RESPONSE_BYTES || bytes.last() != Some(&b'\n') {
        return Err(failure("invalidResponse"));
    }
    decode_response(&bytes)
}

#[cfg(unix)]
fn validate_socket(directory: &std::path::Path, path: &std::path::Path) -> Result<(), VocabError> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let dir = std::fs::symlink_metadata(directory).map_err(|_| failure("unavailable"))?;
    let socket = std::fs::symlink_metadata(path).map_err(|_| failure("unavailable"))?;
    // The per-user socket is the local trust boundary; no bearer token is persisted.
    let uid = unsafe { libc::geteuid() };
    if !dir.is_dir()
        || dir.uid() != uid
        || dir.mode() & 0o077 != 0
        || !socket.file_type().is_socket()
        || socket.uid() != uid
        || socket.mode() & 0o077 != 0
    {
        return Err(failure("unsafeEndpoint"));
    }
    Ok(())
}

#[cfg(not(unix))]
fn exchange(_directory: &std::path::Path, _request: &[u8]) -> Result<Value, VocabError> {
    Err(failure("unsupportedPlatform"))
}

#[cfg(unix)]
fn launch_vocab() -> Result<(), VocabError> {
    #[cfg(target_os = "macos")]
    {
        let status = std::process::Command::new("/usr/bin/open")
            .args(["-g", "-b", "com.polarbear.vocab"])
            .status()
            .map_err(|_| failure("notInstalled"))?;
        if status.success() {
            Ok(())
        } else {
            Err(failure("notInstalled"))
        }
    }
    #[cfg(not(target_os = "macos"))]
    Err(failure("unavailable"))
}

#[cfg(any(unix, test))]
fn decode_response(bytes: &[u8]) -> Result<Value, VocabError> {
    let response: Value = serde_json::from_slice(bytes).map_err(|_| failure("invalidResponse"))?;
    if let Some(code) = response.get("error").and_then(Value::as_str) {
        return Err(failure(code));
    }
    if response.get("version").and_then(Value::as_u64) != Some(1) {
        return Err(failure("unsupportedVersion"));
    }
    response
        .get("result")
        .cloned()
        .ok_or_else(|| failure("invalidResponse"))
}

#[cfg(test)]
mod tests {
    use super::decode_response;
    #[test]
    fn requires_an_acknowledged_versioned_response() {
        assert!(decode_response(br#"{"version":1,"result":[]}"#).is_ok());
        assert!(decode_response(br#"{"version":1}"#).is_err());
        assert!(decode_response(br#"{"version":2,"result":null}"#).is_err());
        assert!(decode_response(br#"{"error":"operationFailed"}"#).is_err());
    }

    #[cfg(unix)]
    #[test]
    fn exchanges_a_bounded_request_with_a_private_local_socket() {
        use std::io::{BufRead, BufReader, Write};
        use std::os::unix::{fs::PermissionsExt, net::UnixListener};
        let suffix = std::time::SystemTime::now()
            .duration_since(std::time::UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let directory =
            std::path::PathBuf::from(format!("/tmp/pb-vocab-{}-{suffix}", std::process::id()));
        std::fs::create_dir(&directory).unwrap();
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o700)).unwrap();
        let path = directory.join("v1.sock");
        let listener = UnixListener::bind(&path).unwrap();
        std::fs::set_permissions(&path, std::fs::Permissions::from_mode(0o600)).unwrap();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().unwrap();
            let mut line = String::new();
            BufReader::new(&stream).read_line(&mut line).unwrap();
            assert_eq!(line, "{\"version\":1}\n");
            stream
                .write_all(b"{\"version\":1,\"result\":[]}\n")
                .unwrap();
        });
        let result = super::exchange(&directory, b"{\"version\":1}\n");
        server.join().unwrap();
        assert_eq!(result.unwrap(), serde_json::json!([]));
        std::fs::set_permissions(&directory, std::fs::Permissions::from_mode(0o755)).unwrap();
        assert_eq!(
            super::validate_socket(&directory, &path).unwrap_err().code,
            "unsafeEndpoint"
        );
        std::fs::remove_dir_all(directory).unwrap();
    }
}
