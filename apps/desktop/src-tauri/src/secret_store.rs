use std::collections::BTreeMap;
use std::fs;
#[cfg(unix)]
use std::os::unix::fs::PermissionsExt;
use std::path::PathBuf;
use tauri::Manager;

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
    match KeychainSecretStore.get_secret(key) {
        Ok(Some(secret)) if !secret.trim().is_empty() => {
            let _ = write_fallback_secrets(app, &BTreeMap::new());
            return Ok(Some(secret));
        }
        Ok(_) | Err(_) => {}
    }

    #[cfg(debug_assertions)]
    {
        Ok(read_fallback_secrets(app)?
            .remove(key)
            .filter(|secret| !secret.trim().is_empty()))
    }

    #[cfg(not(debug_assertions))]
    Ok(None)
}

pub(crate) fn save_repository_secret(
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
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let content = fs::read_to_string(path).map_err(|error| error.to_string())?;
    serde_json::from_str(&content).map_err(|error| error.to_string())
}

fn write_fallback_secrets(
    app: &tauri::AppHandle,
    secrets: &BTreeMap<String, String>,
) -> Result<(), String> {
    let path = fallback_secrets_path(app)?;
    if secrets.is_empty() {
        if path.exists() {
            fs::remove_file(path).map_err(|error| error.to_string())?;
        }
        return Ok(());
    }

    let content = serde_json::to_string(secrets).map_err(|error| error.to_string())?;
    fs::write(&path, content).map_err(|error| error.to_string())?;
    #[cfg(unix)]
    fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
        .map_err(|error| error.to_string())?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::cell::RefCell;

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
