use serde::{Deserialize, Serialize};
use std::fs;
use std::io::{ErrorKind, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;

use crate::secret_store;

// All windows in the single desktop process share this credential lifecycle.
static IDENTITY_LOCK: Mutex<()> = Mutex::new(());

#[derive(Debug, Serialize, Deserialize, Clone)]
#[serde(rename_all = "camelCase")]
pub(crate) struct RepositoryAccountDto {
    pub provider: String,
    pub account_id: String,
    pub login: String,
    pub avatar_url: Option<String>,
    pub base_url: Option<String>,
    pub connected_at: i64,
}

pub(crate) fn normalize_repository_provider(provider: &str) -> Result<String, String> {
    match provider.trim().to_ascii_lowercase().as_str() {
        "github" => Ok("github".to_owned()),
        "gitlab" => Ok("gitlab".to_owned()),
        _ => Err("Supported repository providers are GitHub and GitLab.".to_owned()),
    }
}

pub(crate) fn repository_provider_label(provider: &str) -> &'static str {
    if provider == "gitlab" {
        "GitLab"
    } else {
        "GitHub"
    }
}

fn with_identity<T>(
    app: &tauri::AppHandle,
    action: impl FnOnce(&DisconnectJournal) -> Result<T, String>,
) -> Result<T, String> {
    let _guard = IDENTITY_LOCK.lock().map_err(|_| cleanup_error())?;
    action(&DisconnectJournal::new(&crate::app_paths::app_config_dir(
        app,
    )?))
}

pub(crate) fn read_account(app: &tauri::AppHandle) -> Result<Option<RepositoryAccountDto>, String> {
    with_identity(app, |journal| {
        journal.ensure_available()?;
        journal.read_account()
    })
}

pub(crate) fn read_connected_account(
    app: &tauri::AppHandle,
) -> Result<Option<RepositoryAccountDto>, String> {
    with_identity(app, |journal| {
        journal.connected(
            |provider| secret_store::read_repository_secret(app, provider),
            || secret_store::delete_repository_secrets(app),
        )
    })
}

pub(crate) fn repository_token(app: &tauri::AppHandle, provider: &str) -> Result<String, String> {
    let provider = normalize_repository_provider(provider)?;
    with_identity(app, |journal| {
        journal.ensure_available()?;
        secret_store::read_repository_secret(app, &provider)?.ok_or_else(|| {
            format!(
                "Connect {} before using repository sync.",
                repository_provider_label(&provider)
            )
        })
    })
}

pub(crate) fn save_account(
    app: &tauri::AppHandle,
    account: &RepositoryAccountDto,
    token: &str,
) -> Result<(), String> {
    with_identity(app, |journal| {
        journal.ensure_available()?;
        secret_store::save_repository_secret(app, &account.provider, token)?;
        if secret_store::read_repository_secret(app, &account.provider)?.as_deref() != Some(token) {
            return Err("Cloud Sync could not verify the saved token.".to_owned());
        }
        let content = serde_json::to_vec_pretty(account).map_err(|error| error.to_string())?;
        fs::write(journal.account_path(), content).map_err(|error| error.to_string())
    })
}

pub(crate) fn ensure_available(app: &tauri::AppHandle) -> Result<(), String> {
    with_identity(app, DisconnectJournal::ensure_available)
}

pub(crate) fn disconnect(app: &tauri::AppHandle) -> Result<(), String> {
    with_identity(app, |journal| {
        journal.disconnect(|| secret_store::delete_repository_secrets(app))
    })
}

fn cleanup_error() -> String {
    serde_json::json!({
        "code": "repository.secretDeletionFailed",
        "message": "Credential cleanup is incomplete. Retry disconnecting Cloud Sync."
    })
    .to_string()
}

fn remove_if_present(path: &Path) -> Result<(), std::io::Error> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

fn sync_directory(path: &Path) -> Result<(), std::io::Error> {
    #[cfg(unix)]
    fs::File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

/// Owns completion of credential cleanup across process restarts.
struct DisconnectJournal {
    directory: PathBuf,
}

impl DisconnectJournal {
    fn new(directory: &Path) -> Self {
        Self {
            directory: directory.to_owned(),
        }
    }

    fn pending(&self) -> Result<bool, String> {
        match fs::symlink_metadata(self.marker_path()) {
            Ok(metadata) if metadata.is_file() => Ok(true),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(false),
            _ => Err(cleanup_error()),
        }
    }

    fn marker_path(&self) -> PathBuf {
        self.directory.join("repository-disconnect.pending")
    }
    fn account_path(&self) -> PathBuf {
        self.directory.join("repository-account.json")
    }

    fn ensure_available(&self) -> Result<(), String> {
        if self.pending()? {
            Err(cleanup_error())
        } else {
            Ok(())
        }
    }

    fn read_account(&self) -> Result<Option<RepositoryAccountDto>, String> {
        match fs::read(self.account_path()) {
            Ok(bytes) => serde_json::from_slice(&bytes)
                .map(Some)
                .map_err(|error| error.to_string()),
            Err(error) if error.kind() == ErrorKind::NotFound => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn connected(
        &self,
        read_secret: impl FnOnce(&str) -> Result<Option<String>, String>,
        delete_secrets: impl FnOnce() -> Result<(), String>,
    ) -> Result<Option<RepositoryAccountDto>, String> {
        if self.pending()? {
            self.recover(delete_secrets)?;
            return Ok(None);
        }
        let Some(account) = self.read_account()? else {
            return Ok(None);
        };
        let provider = normalize_repository_provider(&account.provider)?;
        // A read failure is not evidence that credentials have been deleted.
        if read_secret(&provider)?.is_some_and(|token| !token.trim().is_empty()) {
            return Ok(Some(account));
        }
        // Older versions had no intent marker. Clean every store before hiding stale identity.
        self.disconnect(delete_secrets)?;
        Ok(None)
    }

    fn disconnect(
        &self,
        delete_secrets: impl FnOnce() -> Result<(), String>,
    ) -> Result<(), String> {
        if !self.pending()? {
            let mut file = fs::OpenOptions::new()
                .write(true)
                .create_new(true)
                .open(self.marker_path())
                .map_err(|_| cleanup_error())?;
            file.write_all(b"1\n")
                .and_then(|_| file.sync_all())
                .map_err(|_| cleanup_error())?;
        }
        // Persist intent before deleting any credential, including on retry after a failed sync.
        fs::OpenOptions::new()
            .write(true)
            .open(self.marker_path())
            .and_then(|file| file.sync_all())
            .and_then(|_| sync_directory(&self.directory))
            .map_err(|_| cleanup_error())?;
        delete_secrets().map_err(|_| cleanup_error())?;
        remove_if_present(&self.account_path())
            .and_then(|_| sync_directory(&self.directory))
            .map_err(|_| cleanup_error())?;
        remove_if_present(&self.marker_path())
            .and_then(|_| sync_directory(&self.directory))
            .map_err(|_| cleanup_error())
    }

    fn recover(&self, delete_secrets: impl FnOnce() -> Result<(), String>) -> Result<(), String> {
        if self.pending()? {
            self.disconnect(delete_secrets)?;
        }
        Ok(())
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::cell::Cell;

    struct Fixture(PathBuf);
    impl Fixture {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("polarbear-identity-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            fs::write(path.join("repository-account.json"), b"existing account").unwrap();
            Self(path)
        }
        fn journal(&self) -> DisconnectJournal {
            DisconnectJournal::new(&self.0)
        }
    }
    impl Drop for Fixture {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn partial_deletion_survives_restart_and_retries_without_restoring_secrets() {
        let fixture = Fixture::new();
        let github = Cell::new(true);
        let gitlab = Cell::new(true);
        assert!(fixture
            .journal()
            .disconnect(|| {
                github.set(false);
                Err("private keychain error".into())
            })
            .is_err());
        let restarted = fixture.journal();
        assert!(
            restarted.pending().unwrap(),
            "Cleanup intent must survive a new owner"
        );
        assert!(fixture.0.join("repository-account.json").exists());
        let error = restarted
            .recover(|| Err("private retry error".into()))
            .unwrap_err();
        assert!(error.contains("repository.secretDeletionFailed"));
        assert!(!error.contains("private"));
        assert!(restarted.pending().unwrap());
        fixture
            .journal()
            .recover(|| {
                assert!(!github.get(), "Deleted credentials must never be restored");
                gitlab.set(false);
                Ok(())
            })
            .unwrap();
        assert!(!gitlab.get());
        assert!(!fixture.journal().pending().unwrap());
        assert!(!fixture.0.join("repository-account.json").exists());
        fixture
            .journal()
            .recover(|| panic!("Completed cleanup must not retry"))
            .unwrap();
    }

    #[test]
    fn intent_exists_before_any_destructive_step() {
        let fixture = Fixture::new();
        fixture
            .journal()
            .disconnect(|| {
                assert!(fixture.journal().pending().unwrap());
                Ok(())
            })
            .unwrap();
    }

    #[test]
    fn metadata_failure_keeps_intent_for_restart() {
        let fixture = Fixture::new();
        let account = fixture.0.join("repository-account.json");
        fs::remove_file(&account).unwrap();
        fs::create_dir(&account).unwrap();
        assert!(fixture.journal().disconnect(|| Ok(())).is_err());
        assert!(fixture.journal().pending().unwrap());
        fs::remove_dir(account).unwrap();
        fixture.journal().recover(|| Ok(())).unwrap();
        assert!(!fixture.journal().pending().unwrap());
    }

    #[test]
    fn failed_intent_persistence_never_deletes_credentials() {
        let fixture = Fixture::new();
        fs::create_dir(fixture.0.join("repository-disconnect.pending")).unwrap();
        assert!(fixture
            .journal()
            .disconnect(|| panic!("No deletion without durable intent"))
            .is_err());
    }

    #[test]
    fn restart_after_metadata_removal_still_finishes_cleanup() {
        let fixture = Fixture::new();
        fs::remove_file(fixture.0.join("repository-account.json")).unwrap();
        fs::write(fixture.0.join("repository-disconnect.pending"), b"1\n").unwrap();
        let called = Cell::new(false);
        fixture
            .journal()
            .recover(|| {
                called.set(true);
                Ok(())
            })
            .unwrap();
        assert!(called.get());
        assert!(!fixture.journal().pending().unwrap());
    }

    fn account_fixture(fixture: &Fixture) {
        fs::write(fixture.0.join("repository-account.json"), br#"{"provider":"github","accountId":"1","login":"fixture","avatarUrl":null,"baseUrl":null,"connectedAt":1}"#).unwrap();
    }

    #[test]
    fn credential_read_failure_preserves_account_without_starting_deletion() {
        let fixture = Fixture::new();
        account_fixture(&fixture);
        assert!(fixture
            .journal()
            .connected(
                |_| Err("locked keychain".into()),
                || panic!("Read failure must not delete credentials")
            )
            .is_err());
        assert!(fixture.0.join("repository-account.json").exists());
        assert!(!fixture.journal().pending().unwrap());
    }

    #[test]
    fn legacy_missing_active_secret_cannot_hide_other_credentials() {
        let fixture = Fixture::new();
        account_fixture(&fixture);
        assert!(fixture
            .journal()
            .connected(|_| Ok(None), || Err("other provider remains".into()))
            .is_err());
        assert!(fixture.journal().pending().unwrap());
        assert!(fixture.journal().ensure_available().is_err());
        assert!(fixture.0.join("repository-account.json").exists());
        assert!(fixture
            .journal()
            .connected(
                |_| panic!("Pending cleanup must not authenticate"),
                || Ok(())
            )
            .unwrap()
            .is_none());
    }

    #[test]
    fn healthy_legacy_account_is_unchanged_and_does_not_delete_credentials() {
        let fixture = Fixture::new();
        account_fixture(&fixture);
        let account = fixture
            .journal()
            .connected(
                |provider| {
                    assert_eq!(provider, "github");
                    Ok(Some("token".into()))
                },
                || panic!("Healthy account must not be disconnected"),
            )
            .unwrap()
            .unwrap();
        assert_eq!(account.login, "fixture");
        assert!(fixture.journal().ensure_available().is_ok());
    }

    #[test]
    fn cleanup_recovers_in_a_new_process() {
        let fixture = Fixture::new();
        fs::write(fixture.0.join("github.fixture"), b"fake").unwrap();
        fs::write(fixture.0.join("gitlab.fixture"), b"fake").unwrap();
        for phase in ["partial", "recover"] {
            let output = std::process::Command::new(std::env::current_exe().unwrap())
                .args([
                    "--ignored",
                    "--exact",
                    "repository_identity::tests::restart_process_fixture",
                    "--nocapture",
                ])
                .env("POLARBEAR_IDENTITY_TEST_DIR", &fixture.0)
                .env("POLARBEAR_IDENTITY_TEST_PHASE", phase)
                .output()
                .unwrap();
            assert!(
                output.status.success(),
                "{} {}",
                String::from_utf8_lossy(&output.stdout),
                String::from_utf8_lossy(&output.stderr)
            );
            assert!(!fixture.0.join("github.fixture").exists());
            assert_eq!(fixture.journal().pending().unwrap(), phase == "partial");
            assert_eq!(
                fixture.0.join("gitlab.fixture").exists(),
                phase == "partial"
            );
            assert_eq!(
                fixture.0.join("repository-account.json").exists(),
                phase == "partial"
            );
        }
    }

    #[test]
    #[ignore = "Invoked by cleanup_recovers_in_a_new_process with isolated fixture paths"]
    fn restart_process_fixture() {
        let directory = PathBuf::from(std::env::var("POLARBEAR_IDENTITY_TEST_DIR").unwrap());
        assert!(directory
            .file_name()
            .unwrap()
            .to_string_lossy()
            .starts_with("polarbear-identity-"));
        let journal = DisconnectJournal::new(&directory);
        if std::env::var("POLARBEAR_IDENTITY_TEST_PHASE").unwrap() == "partial" {
            assert!(journal
                .disconnect(|| {
                    fs::remove_file(directory.join("github.fixture")).unwrap();
                    Err("injected GitLab deletion failure".into())
                })
                .is_err());
        } else {
            journal
                .recover(|| {
                    assert!(!directory.join("github.fixture").exists());
                    fs::remove_file(directory.join("gitlab.fixture")).unwrap();
                    Ok(())
                })
                .unwrap();
        }
    }
}
