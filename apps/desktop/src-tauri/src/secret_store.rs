use std::collections::BTreeMap;
use std::fs;
#[cfg(all(test, unix))]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use tauri::Manager;

mod credential_file;
use credential_file::{clear as clear_fallback_file, write as write_fallback_file};

const KEYCHAIN_SERVICE: &str = "dev.polarbear.app";
const GITHUB_TOKEN_KEY: &str = "github_token";
const GITLAB_TOKEN_KEY: &str = "gitlab_token";

trait SecretStore {
    fn save_secret(&self, key: &str, value: &str) -> Result<(), String>;
    fn get_secret(&self, key: &str) -> Result<Option<String>, String>;
    fn delete_secret(&self, key: &str) -> Result<(), String>;
}

struct KeychainSecretStore;

impl SecretStore for KeychainSecretStore {
    fn save_secret(&self, key: &str, value: &str) -> Result<(), String> {
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|error| error.to_string())?;
        entry.set_password(value).map_err(|error| error.to_string())
    }

    fn get_secret(&self, key: &str) -> Result<Option<String>, String> {
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|error| error.to_string())?;
        match entry.get_password() {
            Ok(secret) => Ok(Some(secret)),
            Err(keyring::Error::NoEntry) => Ok(None),
            Err(error) => Err(error.to_string()),
        }
    }

    fn delete_secret(&self, key: &str) -> Result<(), String> {
        let entry =
            keyring::Entry::new(KEYCHAIN_SERVICE, key).map_err(|error| error.to_string())?;
        match entry.delete_credential() {
            Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
            Err(error) => Err(error.to_string()),
        }
    }
}

pub(crate) fn read_repository_secret(
    app: &tauri::AppHandle,
    provider: &str,
) -> Result<Option<String>, String> {
    let key = repository_secret_key(provider);
    let result = KeychainSecretStore.get_secret(key);
    if matches!(&result, Ok(Some(secret)) if !secret.trim().is_empty()) {
        let _ = write_fallback_secrets(app, &BTreeMap::new());
    }
    resolve_secret_read(result, || {
        #[cfg(debug_assertions)]
        {
            Ok(read_fallback_secrets(app)?
                .remove(key)
                .filter(|secret| !secret.trim().is_empty()))
        }

        #[cfg(not(debug_assertions))]
        Ok(None)
    })
}

fn resolve_secret_read(
    keychain: Result<Option<String>, String>,
    fallback: impl FnOnce() -> Result<Option<String>, String>,
) -> Result<Option<String>, String> {
    if let Ok(Some(secret)) = &keychain {
        if !secret.trim().is_empty() {
            return Ok(Some(secret.clone()));
        }
    }
    match fallback() {
        Ok(Some(secret)) if !secret.trim().is_empty() => Ok(Some(secret)),
        Ok(_) if keychain.is_ok() => Ok(None),
        _ => Err(serde_json::json!({
            "code": "repository.secretReadFailed",
            "message": "Cloud Sync could not read saved credentials. Check keychain access and try again."
        }).to_string()),
    }
}

pub(crate) fn save_repository_secret(
    app: &tauri::AppHandle,
    provider: &str,
    token: &str,
) -> Result<(), String> {
    secure_write_result(save_repository_secret_inner(app, provider, token))
}

fn secure_write_result(result: Result<(), String>) -> Result<(), String> {
    result.map_err(|_| serde_json::json!({
        "code": "repository.secretWriteFailed",
        "message": "Cloud Sync could not securely store credentials. Check credential-store and configuration directory permissions, then reconnect."
    }).to_string())
}

fn save_repository_secret_inner(
    app: &tauri::AppHandle,
    provider: &str,
    token: &str,
) -> Result<(), String> {
    let key = repository_secret_key(provider);
    let keychain_verified = KeychainSecretStore
        .save_secret(key, token)
        .and_then(|_| KeychainSecretStore.get_secret(key))
        .map(|saved| saved.as_deref() == Some(token))
        .unwrap_or(false);

    if keychain_verified {
        return write_fallback_secrets(app, &BTreeMap::new());
    }

    #[cfg(debug_assertions)]
    {
        let mut fallback_secrets = read_fallback_secrets(app)?;
        fallback_secrets.insert(key.to_owned(), token.to_owned());
        write_fallback_secrets(app, &fallback_secrets)
    }

    #[cfg(not(debug_assertions))]
    Err("Cloud Sync could not save the token in the system keychain.".to_owned())
}

pub(crate) fn delete_repository_secrets(app: &tauri::AppHandle) -> Result<(), String> {
    delete_repository_secrets_using(&KeychainSecretStore, || {
        write_fallback_secrets(app, &BTreeMap::new())
    })
}

fn delete_repository_secrets_using(
    store: &dyn SecretStore,
    clear_fallback: impl FnOnce() -> Result<(), String>,
) -> Result<(), String> {
    // Attempt every location even after a partial failure; retries are idempotent.
    let github = store.delete_secret(GITHUB_TOKEN_KEY);
    let gitlab = store.delete_secret(GITLAB_TOKEN_KEY);
    let fallback = clear_fallback();
    if github.is_err() || gitlab.is_err() || fallback.is_err() {
        return Err(serde_json::json!({
            "code": "repository.secretDeletionFailed",
            "message": "Some saved credentials could not be removed. Retry disconnecting Cloud Sync."
        }).to_string());
    }
    Ok(())
}

fn repository_secret_key(provider: &str) -> &'static str {
    match provider {
        "gitlab" => GITLAB_TOKEN_KEY,
        _ => GITHUB_TOKEN_KEY,
    }
}

fn fallback_secrets_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    let path = app
        .path()
        .app_config_dir()
        .map_err(|error| error.to_string())?;
    fs::create_dir_all(&path).map_err(|error| error.to_string())?;
    Ok(path.join("repository-secrets.json"))
}

#[cfg(debug_assertions)]
fn read_fallback_secrets(app: &tauri::AppHandle) -> Result<BTreeMap<String, String>, String> {
    let path = fallback_secrets_path(app)?;
    let Some(content) = credential_file::read(&path)? else {
        return Ok(BTreeMap::new());
    };
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_fallback_secrets(
    app: &tauri::AppHandle,
    secrets: &BTreeMap<String, String>,
) -> Result<(), String> {
    let path = fallback_secrets_path(app)?;
    if secrets.is_empty() {
        return clear_fallback_file(&path);
    }

    let content = serde_json::to_string(secrets).map_err(|error| error.to_string())?;
    write_fallback_file(&path, content.as_bytes())
}

#[cfg(test)]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::cell::RefCell;

    #[test]
    fn credential_publication_failure_has_a_stable_code_without_private_details() {
        let error =
            secure_write_result(Err("fixture-token and private-path".to_owned())).unwrap_err();
        let value: serde_json::Value = serde_json::from_str(&error).unwrap();
        assert_eq!(value["code"], "repository.secretWriteFailed");
        assert!(!error.contains("fixture-token"));
        assert!(!error.contains("private-path"));
        assert!(secure_write_result(Ok(())).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn fallback_never_writes_through_a_symbolic_link() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let outside = directory.join("outside.json");
        let path = directory.join("repository-secrets.json");
        fs::write(&outside, b"original").unwrap();
        std::os::unix::fs::symlink(&outside, &path).unwrap();
        let result = write_fallback_file(&path, b"new secret");
        let unchanged = fs::read(&outside).unwrap() == b"original";
        fs::remove_dir_all(directory).unwrap();
        assert!(result.is_err(), "A symlink is not a credential file");
        assert!(unchanged, "An unrelated file must never receive a secret");
    }

    #[cfg(unix)]
    #[test]
    fn fallback_replacement_does_not_modify_a_hard_link_or_reuse_public_permissions() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("repository-secrets.json");
        let alias = directory.join("legacy-copy.json");
        fs::write(&path, b"original").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o644)).unwrap();
        fs::hard_link(&path, &alias).unwrap();
        let result = write_fallback_file(&path, b"new secret");
        let alias_content = fs::read(&alias).unwrap();
        let saved = fs::read(&path).unwrap();
        let mode = fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        let count = fs::read_dir(&directory).unwrap().count();
        fs::remove_dir_all(directory).unwrap();
        result.unwrap();
        assert_eq!(alias_content, b"original");
        assert_eq!(saved, b"new secret");
        assert_eq!(mode, 0o600);
        assert_eq!(count, 2, "Staging files must not remain after publication");
    }

    #[cfg(unix)]
    #[test]
    fn inaccessible_fallback_is_not_acknowledged_as_absent() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("repository-secrets.json");
        fs::write(&path, b"fixture").unwrap();
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o000)).unwrap();
        let result = clear_fallback_file(&path);
        fs::set_permissions(&directory, fs::Permissions::from_mode(0o700)).unwrap();
        assert!(path.exists());
        fs::remove_dir_all(directory).unwrap();
        assert!(
            result.is_err(),
            "Denied access must not look like successful deletion"
        );
    }

    #[test]
    fn unavailable_keychain_is_not_reported_as_a_missing_credential() {
        let result = resolve_secret_read(Err("private OS error".into()), || Ok(None));
        let error = result.unwrap_err();
        assert!(error.contains("repository.secretReadFailed"));
        assert!(!error.contains("private"));
        assert_eq!(resolve_secret_read(Ok(None), || Ok(None)).unwrap(), None);
        assert_eq!(
            resolve_secret_read(Err("locked".into()), || Ok(Some("debug token".into())))
                .unwrap()
                .as_deref(),
            Some("debug token")
        );
    }

    struct FakeSecrets {
        failures: Vec<&'static str>,
        remaining: RefCell<Vec<&'static str>>,
        attempts: RefCell<Vec<String>>,
    }

    impl SecretStore for FakeSecrets {
        fn save_secret(&self, _: &str, _: &str) -> Result<(), String> {
            unreachable!("Deletion must not save credentials")
        }
        fn get_secret(&self, _: &str) -> Result<Option<String>, String> {
            unreachable!("Deletion must not read credentials")
        }
        fn delete_secret(&self, key: &str) -> Result<(), String> {
            self.attempts.borrow_mut().push(key.to_owned());
            if self.failures.contains(&key) {
                return Err("sensitive provider diagnostic".to_owned());
            }
            self.remaining.borrow_mut().retain(|entry| *entry != key);
            Ok(())
        }
    }

    #[test]
    fn deletion_reports_partial_failure_attempts_every_store_and_can_be_retried() {
        for failures in [
            vec![GITHUB_TOKEN_KEY],
            vec![GITLAB_TOKEN_KEY],
            vec![GITHUB_TOKEN_KEY, GITLAB_TOKEN_KEY],
        ] {
            let mut store = FakeSecrets {
                failures,
                remaining: RefCell::new(vec![GITHUB_TOKEN_KEY, GITLAB_TOKEN_KEY]),
                attempts: RefCell::new(vec![]),
            };
            let cleared = std::cell::Cell::new(false);
            let result = delete_repository_secrets_using(&store, || {
                cleared.set(true);
                Ok(())
            });
            assert!(
                result.is_err(),
                "A failed keychain deletion must not acknowledge disconnect"
            );
            assert!(cleared.get(), "Fallback cleanup must still be attempted");
            assert_eq!(
                *store.attempts.borrow(),
                [GITHUB_TOKEN_KEY, GITLAB_TOKEN_KEY]
            );
            assert!(!format!("{result:?}").contains("sensitive provider diagnostic"));
            store.failures.clear();
            assert!(delete_repository_secrets_using(&store, || Ok(())).is_ok());
            assert!(store.remaining.borrow().is_empty());
            assert!(delete_repository_secrets_using(&store, || Ok(())).is_ok());
        }
    }

    #[test]
    fn fallback_failure_is_not_success_and_does_not_expose_internal_details() {
        let store = FakeSecrets {
            failures: vec![],
            remaining: RefCell::new(vec![]),
            attempts: RefCell::new(vec![]),
        };
        let result =
            delete_repository_secrets_using(&store, || Err("private local path".to_owned()));
        assert!(result.is_err());
        assert!(!format!("{result:?}").contains("private local path"));
        assert_eq!(store.attempts.borrow().len(), 2);
    }
}
