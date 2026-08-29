use serde::Serialize;
use serde_json::{json, Map, Value};
use std::env;
use std::fs;
use std::io::{BufRead, BufReader, Read, Write};
use std::path::{Path, PathBuf};
use std::process::{Command, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::sync::Mutex;
use std::thread;
use std::time::Duration;

const API_VERSION: &str = "1.2";
const MAX_FRAME_BYTES: u64 = 1024 * 1024;
static REQUEST_SEQUENCE: AtomicU64 = AtomicU64::new(1);
const ALLOWED_METHODS: &[&str] = &[
    "system.hello",
    "projects.status",
    "system.shutdown",
    "memories.list",
    "memories.get",
    "memories.record",
    "memories.history",
    "memories.update",
    "memories.verify",
    "memories.archive",
    "memories.restore",
    "memories.complete",
    "memories.feedback",
    "memories.relate",
    "memories.purge_preview",
    "memories.purge",
    "contexts.explain",
    "usage.token_savings",
    "usage.token_savings_reset",
    "projects.diagnostics",
    "projects.config",
    "projects.config_update",
    "maintenance.preview",
    "maintenance.run",
    "backups.list",
    "backups.create",
    "backups.verify",
    "backups.restore_preview",
    "backups.restore",
    "knowledge.promote_preview",
    "knowledge.promote",
];

#[derive(Default)]
pub struct MemoryAdminState {
    current_workspace: Mutex<Option<PathBuf>>,
}

impl MemoryAdminState {
    fn bind(&self, workspace_root: &str) -> Result<String, String> {
        let canonical = canonical_memory_workspace(workspace_root)?;
        let mut current = self.current_workspace.lock().map_err(|_| {
            error(
                "MEMORY_STATE_FAILED",
                "Memory workspace state is unavailable.",
            )
        })?;
        *current = Some(PathBuf::from(&canonical));
        Ok(canonical)
    }

    fn authorize(&self, workspace_root: &str) -> Result<String, String> {
        let canonical = canonical_memory_workspace(workspace_root)?;
        let current = self.current_workspace.lock().map_err(|_| {
            error(
                "MEMORY_STATE_FAILED",
                "Memory workspace state is unavailable.",
            )
        })?;
        if current.as_deref() != Some(Path::new(&canonical)) {
            return Err(error(
                "MEMORY_WORKSPACE_DENIED",
                "Memory requests are limited to the Desktop's current workspace.",
            ));
        }
        Ok(canonical)
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct MemoryAdminError {
    code: &'static str,
    message: String,
}

fn error(code: &'static str, message: impl Into<String>) -> String {
    serde_json::to_string(&MemoryAdminError {
        code,
        message: message.into(),
    })
    .unwrap_or_else(|_| {
        "{\"code\":\"MEMORY_ERROR\",\"message\":\"Memory request failed.\"}".to_owned()
    })
}

fn data_root() -> Result<PathBuf, String> {
    if let Ok(path) = env::var("POLARBEAR_MEMORY_DATA_DIR") {
        return Ok(PathBuf::from(path));
    }
    let home = env::var_os("HOME").map(PathBuf::from).ok_or_else(|| {
        error(
            "MEMORY_HOME_UNAVAILABLE",
            "The current user data directory is unavailable.",
        )
    })?;
    #[cfg(target_os = "macos")]
    return Ok(home.join("Library/Application Support/Polarbear Memory"));
    #[cfg(all(unix, not(target_os = "macos")))]
    return Ok(env::var_os("XDG_DATA_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".local/share"))
        .join("polarbear-memory"));
    #[allow(unreachable_code)]
    Err(error(
        "MEMORY_PLATFORM_UNSUPPORTED",
        "The Memory Admin API is unavailable on this platform.",
    ))
}

fn service_paths() -> Result<(PathBuf, PathBuf, PathBuf), String> {
    let directory = data_root()?.join("service");
    Ok((
        directory.clone(),
        directory.join("admin-v1.sock"),
        directory.join("admin-v1.token"),
    ))
}

#[cfg(unix)]
fn validate_private_path(path: &Path, expected_kind: &str) -> Result<(), String> {
    use std::os::unix::fs::{FileTypeExt, MetadataExt};
    let metadata = fs::symlink_metadata(path).map_err(|_| {
        error(
            "MEMORY_SERVICE_UNAVAILABLE",
            "Polarbear Memory service is not running.",
        )
    })?;
    let expected = match expected_kind {
        "directory" => metadata.file_type().is_dir(),
        "file" => metadata.file_type().is_file(),
        "socket" => metadata.file_type().is_socket(),
        _ => false,
    };
    if !expected || metadata.uid() != unsafe { libc::geteuid() } || metadata.mode() & 0o077 != 0 {
        return Err(error(
            "MEMORY_SERVICE_UNSAFE",
            "Memory service ownership or permissions are unsafe.",
        ));
    }
    Ok(())
}

#[cfg(unix)]
fn spawn_service() -> Result<(), String> {
    let executable =
        env::var("POLARBEAR_MEMORY_COMMAND").unwrap_or_else(|_| "polarbear-memory".to_owned());
    Command::new(executable)
        .args(["service", "run"])
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null())
        .spawn()
        .map_err(|_| {
            error(
            "MEMORY_ENGINE_NOT_INSTALLED",
            "Polarbear Memory Engine was not found. Install it or set POLARBEAR_MEMORY_COMMAND.",
        )
        })?;
    Ok(())
}

#[cfg(unix)]
fn connect_or_start(socket_path: &Path) -> Result<std::os::unix::net::UnixStream, String> {
    use std::os::unix::net::UnixStream;
    if let Ok(stream) = UnixStream::connect(socket_path) {
        return Ok(stream);
    }
    spawn_service()?;
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(100));
        if let Ok(stream) = UnixStream::connect(socket_path) {
            return Ok(stream);
        }
    }
    Err(error(
        "MEMORY_SERVICE_UNAVAILABLE",
        "Polarbear Memory service did not become ready.",
    ))
}

#[cfg(unix)]
fn service_status_unix() -> Result<Value, String> {
    use std::os::unix::net::UnixStream;
    let (directory, socket_path, token_path) = service_paths()?;
    if !socket_path.exists() {
        return Ok(json!({ "running": false }));
    }
    validate_private_path(&directory, "directory")?;
    validate_private_path(&socket_path, "socket")?;
    validate_private_path(&token_path, "file")?;
    Ok(json!({ "running": UnixStream::connect(socket_path).is_ok() }))
}

#[cfg(unix)]
fn start_service_unix() -> Result<Value, String> {
    if service_status_unix()?
        .get("running")
        .and_then(Value::as_bool)
        == Some(true)
    {
        return Ok(json!({ "running": true }));
    }
    spawn_service()?;
    for _ in 0..20 {
        thread::sleep(Duration::from_millis(100));
        if service_status_unix()?
            .get("running")
            .and_then(Value::as_bool)
            == Some(true)
        {
            return Ok(json!({ "running": true }));
        }
    }
    Err(error(
        "MEMORY_SERVICE_UNAVAILABLE",
        "Polarbear Memory service did not become ready.",
    ))
}

#[cfg(unix)]
fn canonical_memory_workspace(workspace_root: &str) -> Result<String, String> {
    let root = fs::canonicalize(workspace_root).map_err(|_| {
        error(
            "MEMORY_WORKSPACE_DENIED",
            "The Memory workspace is unavailable.",
        )
    })?;
    if !root.is_dir() {
        return Err(error(
            "MEMORY_WORKSPACE_DENIED",
            "The Memory workspace is not a directory.",
        ));
    }
    let project_root = root
        .ancestors()
        .find(|path| path.join(".git").exists())
        .ok_or_else(|| {
            error(
                "MEMORY_WORKSPACE_DENIED",
                "The Memory workspace is not a Git repository.",
            )
        })?;
    if !project_root.join(".polarbear/config.toml").is_file() {
        return Err(error(
            "MEMORY_WORKSPACE_DENIED",
            "This workspace has not initialized Polarbear Memory.",
        ));
    }
    Ok(root.to_string_lossy().to_string())
}

#[cfg(unix)]
fn request_unix(workspace_root: String, method: String, params: Value) -> Result<Value, String> {
    let (directory, socket_path, token_path) = service_paths()?;
    if !ALLOWED_METHODS.contains(&method.as_str()) {
        return Err(error(
            "MEMORY_METHOD_DENIED",
            "The Desktop is not allowed to call this Memory capability.",
        ));
    }
    if workspace_root.len() > 16 * 1024 || method.len() > 128 {
        return Err(error(
            "MEMORY_REQUEST_TOO_LARGE",
            "The Memory request exceeds its size limit.",
        ));
    }
    let canonical_workspace = if method == "system.hello" {
        String::new()
    } else {
        canonical_memory_workspace(&workspace_root)?
    };
    let mut payload = match params {
        Value::Object(map) => map,
        _ => Map::new(),
    };
    if method != "system.hello" {
        payload.insert("projectRoot".to_owned(), Value::String(canonical_workspace));
    }

    let mut stream = connect_or_start(&socket_path)?;
    validate_private_path(&directory, "directory")?;
    validate_private_path(&socket_path, "socket")?;
    validate_private_path(&token_path, "file")?;
    let token = fs::read_to_string(&token_path).map_err(|_| {
        error(
            "MEMORY_SERVICE_UNAVAILABLE",
            "Memory service authentication is unavailable.",
        )
    })?;
    let request_id = format!(
        "desktop-{}-{}",
        std::process::id(),
        REQUEST_SEQUENCE.fetch_add(1, Ordering::Relaxed)
    );
    let request = json!({
        "id": request_id,
        "apiVersion": API_VERSION,
        "token": token.trim(),
        "method": method,
        "params": payload,
    });
    let frame = serde_json::to_vec(&request).map_err(|_| {
        error(
            "MEMORY_REQUEST_INVALID",
            "The Memory request could not be encoded.",
        )
    })?;
    if frame.len() > MAX_FRAME_BYTES as usize {
        return Err(error(
            "MEMORY_REQUEST_TOO_LARGE",
            "The Memory request exceeds its size limit.",
        ));
    }
    stream
        .set_read_timeout(Some(Duration::from_secs(5)))
        .map_err(|_| {
            error(
                "MEMORY_SERVICE_UNAVAILABLE",
                "Memory service timeout could not be configured.",
            )
        })?;
    stream
        .write_all(&frame)
        .and_then(|_| stream.write_all(b"\n"))
        .map_err(|_| {
            error(
                "MEMORY_SERVICE_UNAVAILABLE",
                "Could not send the Memory request.",
            )
        })?;
    let mut response = String::new();
    BufReader::new(stream)
        .take(MAX_FRAME_BYTES)
        .read_line(&mut response)
        .map_err(|_| {
            error(
                "MEMORY_SERVICE_UNAVAILABLE",
                "Could not read the Memory response.",
            )
        })?;
    let envelope: Value = serde_json::from_str(&response).map_err(|_| {
        error(
            "MEMORY_PROTOCOL_ERROR",
            "Memory service returned an invalid response.",
        )
    })?;
    if envelope.get("id").and_then(Value::as_str) != Some(request_id.as_str()) {
        return Err(error(
            "MEMORY_PROTOCOL_ERROR",
            "Memory service returned a mismatched response.",
        ));
    }
    if envelope.get("ok").and_then(Value::as_bool) == Some(true) {
        return Ok(envelope.get("result").cloned().unwrap_or(Value::Null));
    }
    let api_error = envelope.get("error").cloned().unwrap_or_else(|| {
        json!({
            "code": "MEMORY_ENGINE_ERROR",
            "message": "Memory Engine rejected the request."
        })
    });
    Err(api_error.to_string())
}

#[cfg(all(test, unix))]
#[allow(clippy::expect_used, clippy::unwrap_used)]
mod tests {
    use super::{canonical_memory_workspace, request_unix, MemoryAdminState};
    use std::fs;
    use std::io::{BufRead, BufReader, Write};
    use std::os::unix::fs::PermissionsExt;
    use std::os::unix::net::UnixListener;
    use std::process::{Command, Stdio};
    use std::time::Duration;

    fn temporary(name: &str) -> std::path::PathBuf {
        std::env::temp_dir().join(format!(
            "polarbear-memory-admin-{name}-{}",
            std::process::id()
        ))
    }

    #[test]
    fn memory_workspace_requires_git_and_initialized_project() {
        let root = temporary("workspace-policy");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(root.join(".git")).expect("create git marker");
        assert!(canonical_memory_workspace(root.to_str().expect("path")).is_err());
        fs::create_dir_all(root.join(".polarbear")).expect("create config directory");
        fs::write(root.join(".polarbear/config.toml"), "schema_version = 1\n")
            .expect("write config");
        assert_eq!(
            canonical_memory_workspace(root.to_str().expect("path")).expect("authorized"),
            fs::canonicalize(&root)
                .expect("canonical")
                .to_string_lossy()
                .to_string()
        );
        fs::remove_dir_all(root).expect("cleanup");
    }

    #[test]
    fn native_state_rejects_a_workspace_that_is_not_currently_bound() {
        let first = temporary("bound-workspace");
        let second = temporary("denied-workspace");
        for root in [&first, &second] {
            let _ = fs::remove_dir_all(root);
            fs::create_dir_all(root.join(".git")).expect("create git marker");
            fs::create_dir_all(root.join(".polarbear")).expect("create project config");
            fs::write(root.join(".polarbear/config.toml"), "schema_version = 1\n")
                .expect("write config");
        }
        let state = MemoryAdminState::default();
        state.bind(first.to_str().expect("path")).expect("bind");
        assert!(state.authorize(first.to_str().expect("path")).is_ok());
        assert!(state.authorize(second.to_str().expect("path")).is_err());
        fs::remove_dir_all(first).expect("cleanup first");
        fs::remove_dir_all(second).expect("cleanup second");
    }

    #[test]
    fn rust_proxy_authenticates_and_preserves_the_engine_protocol_contract() {
        let root = temporary("proxy-workspace");
        let data =
            std::path::PathBuf::from("/tmp").join(format!("pbm-proxy-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&data);
        fs::create_dir_all(root.join(".git")).expect("create git marker");
        fs::create_dir_all(root.join(".polarbear")).expect("create project config");
        fs::write(root.join(".polarbear/config.toml"), "schema_version = 1\n")
            .expect("write config");
        let service = data.join("service");
        fs::create_dir_all(&service).expect("create service");
        fs::set_permissions(&service, fs::Permissions::from_mode(0o700)).expect("service mode");
        let token_path = service.join("admin-v1.token");
        fs::write(&token_path, "test-token").expect("token");
        fs::set_permissions(&token_path, fs::Permissions::from_mode(0o600)).expect("token mode");
        let socket_path = service.join("admin-v1.sock");
        let listener = UnixListener::bind(&socket_path).expect("bind socket");
        fs::set_permissions(&socket_path, fs::Permissions::from_mode(0o600)).expect("socket mode");
        let root_for_server = fs::canonicalize(&root)
            .expect("canonical root")
            .to_string_lossy()
            .to_string();
        let server = std::thread::spawn(move || {
            let (mut stream, _) = listener.accept().expect("accept");
            let mut line = String::new();
            BufReader::new(stream.try_clone().expect("clone"))
                .read_line(&mut line)
                .expect("read request");
            let request: serde_json::Value = serde_json::from_str(&line).expect("request json");
            assert_eq!(request["token"], "test-token");
            assert_eq!(request["method"], "projects.status");
            assert_eq!(request["params"]["projectRoot"], root_for_server);
            let response = serde_json::json!({
                "id": request["id"],
                "ok": true,
                "result": { "counts": { "total": 1 } }
            });
            writeln!(stream, "{response}").expect("write response");
        });
        let previous = std::env::var_os("POLARBEAR_MEMORY_DATA_DIR");
        unsafe { std::env::set_var("POLARBEAR_MEMORY_DATA_DIR", &data) };
        let response = request_unix(
            root.to_string_lossy().to_string(),
            "projects.status".to_owned(),
            serde_json::json!({}),
        )
        .expect("proxy response");
        if let Some(value) = previous {
            unsafe { std::env::set_var("POLARBEAR_MEMORY_DATA_DIR", value) };
        } else {
            unsafe { std::env::remove_var("POLARBEAR_MEMORY_DATA_DIR") };
        }
        server.join().expect("server");
        assert_eq!(response["counts"]["total"], 1);
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(data).expect("cleanup data");
    }

    #[test]
    #[ignore = "set POLARBEAR_MEMORY_E2E_CLI to the built Engine dist/cli.js"]
    fn rust_proxy_reaches_the_real_engine_and_sqlite() {
        let cli = std::env::var("POLARBEAR_MEMORY_E2E_CLI").expect("Engine CLI path");
        let root = temporary("real-engine-workspace");
        let data = std::path::PathBuf::from("/tmp")
            .join(format!("pbm-real-engine-{}", std::process::id()));
        let _ = fs::remove_dir_all(&root);
        let _ = fs::remove_dir_all(&data);
        fs::create_dir_all(&root).expect("create root");
        assert!(Command::new("git")
            .arg("init")
            .arg("-q")
            .current_dir(&root)
            .status()
            .expect("git")
            .success());
        let run = |args: &[&str]| {
            Command::new("node")
                .arg(&cli)
                .args(args)
                .current_dir(&root)
                .env("POLARBEAR_MEMORY_DATA_DIR", &data)
                .status()
                .expect("Engine command")
        };
        assert!(run(&["init"]).success());
        assert!(run(&[
            "record",
            "--type",
            "DECISION",
            "--summary",
            "Real cross-process Memory"
        ])
        .success());
        let mut engine = Command::new("node")
            .arg(&cli)
            .args(["service", "run"])
            .current_dir(&root)
            .env("POLARBEAR_MEMORY_DATA_DIR", &data)
            .stdin(Stdio::null())
            .stdout(Stdio::null())
            .stderr(Stdio::null())
            .spawn()
            .expect("start real Engine");
        for _ in 0..30 {
            if data.join("service/admin-v1.sock").exists() {
                break;
            }
            std::thread::sleep(Duration::from_millis(100));
        }
        let previous = std::env::var_os("POLARBEAR_MEMORY_DATA_DIR");
        unsafe { std::env::set_var("POLARBEAR_MEMORY_DATA_DIR", &data) };
        let response = request_unix(
            root.to_string_lossy().to_string(),
            "projects.status".to_owned(),
            serde_json::json!({}),
        )
        .expect("real Engine response");
        assert_eq!(response["counts"]["total"], 1);
        let recorded = request_unix(
            root.to_string_lossy().to_string(),
            "memories.record".to_owned(),
            serde_json::json!({
                "type": "TODO",
                "summary": "Validate Desktop V2 administration",
                "entities": [{
                    "kind": "MODULE",
                    "canonicalKey": "desktop:memory",
                    "displayName": "Desktop Memory"
                }]
            }),
        )
        .expect("record through real Engine");
        let memory_id = recorded["id"].as_str().expect("recorded Memory id");
        let feedback = request_unix(
            root.to_string_lossy().to_string(),
            "memories.feedback".to_owned(),
            serde_json::json!({ "memoryId": memory_id, "useful": true, "reason": "E2E validation" }),
        )
        .expect("feedback through real Engine");
        assert_eq!(feedback["usage"]["positiveFeedbackCount"], 1);
        let completed = request_unix(
            root.to_string_lossy().to_string(),
            "memories.complete".to_owned(),
            serde_json::json!({ "memoryId": memory_id, "state": "COMPLETED", "reason": "E2E passed" }),
        )
        .expect("complete through real Engine");
        assert_eq!(completed["completionState"], "COMPLETED");
        let savings = request_unix(
            root.to_string_lossy().to_string(),
            "usage.token_savings".to_owned(),
            serde_json::json!({}),
        )
        .expect("token savings through real Engine");
        assert!(savings["estimatedSavedTokens"].is_number());
        request_unix(
            root.to_string_lossy().to_string(),
            "system.shutdown".to_owned(),
            serde_json::json!({}),
        )
        .expect("shutdown real Engine");
        assert!(engine.wait().expect("Engine exit").success());
        if let Some(value) = previous {
            unsafe { std::env::set_var("POLARBEAR_MEMORY_DATA_DIR", value) };
        } else {
            unsafe { std::env::remove_var("POLARBEAR_MEMORY_DATA_DIR") };
        }
        fs::remove_dir_all(root).expect("cleanup root");
        fs::remove_dir_all(data).expect("cleanup data");
    }
}

#[tauri::command]
pub fn memory_admin_bind_workspace(
    state: tauri::State<'_, MemoryAdminState>,
    workspace_root: String,
) -> Result<String, String> {
    state.bind(&workspace_root)
}

#[tauri::command]
pub async fn memory_service_status() -> Result<Value, String> {
    #[cfg(unix)]
    {
        tauri::async_runtime::spawn_blocking(service_status_unix)
            .await
            .map_err(|_| error("MEMORY_SERVICE_FAILED", "Memory service task failed."))?
    }
    #[cfg(not(unix))]
    Err(error(
        "MEMORY_PLATFORM_UNSUPPORTED",
        "Memory service controls require Unix-domain sockets.",
    ))
}

#[tauri::command]
pub async fn memory_service_start() -> Result<Value, String> {
    #[cfg(unix)]
    {
        tauri::async_runtime::spawn_blocking(start_service_unix)
            .await
            .map_err(|_| error("MEMORY_SERVICE_FAILED", "Memory service task failed."))?
    }
    #[cfg(not(unix))]
    Err(error(
        "MEMORY_PLATFORM_UNSUPPORTED",
        "Memory service controls require Unix-domain sockets.",
    ))
}

#[tauri::command]
pub async fn memory_service_stop(
    state: tauri::State<'_, MemoryAdminState>,
    workspace_root: String,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let authorized_workspace = state.authorize(&workspace_root)?;
        tauri::async_runtime::spawn_blocking(move || {
            request_unix(
                authorized_workspace,
                "system.shutdown".to_owned(),
                json!({}),
            )
        })
        .await
        .map_err(|_| error("MEMORY_SERVICE_FAILED", "Memory service task failed."))?
    }
    #[cfg(not(unix))]
    {
        let _ = (state, workspace_root);
        Err(error(
            "MEMORY_PLATFORM_UNSUPPORTED",
            "Memory service controls require Unix-domain sockets.",
        ))
    }
}

#[tauri::command]
pub async fn memory_admin_request(
    state: tauri::State<'_, MemoryAdminState>,
    workspace_root: String,
    method: String,
    params: Value,
) -> Result<Value, String> {
    #[cfg(unix)]
    {
        let authorized_workspace = state.authorize(&workspace_root)?;
        tauri::async_runtime::spawn_blocking(move || {
            request_unix(authorized_workspace, method, params)
        })
        .await
        .map_err(|_| error("MEMORY_SERVICE_FAILED", "Memory service task failed."))?
    }
    #[cfg(not(unix))]
    {
        let _ = (workspace_root, method, params);
        Err(error(
            "MEMORY_PLATFORM_UNSUPPORTED",
            "MVP4 requires a Unix-domain socket platform.",
        ))
    }
}
