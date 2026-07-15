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
        return Ok(read_fallback_secrets(app)?
            .remove(key)
            .filter(|secret| !secret.trim().is_empty()));
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
        return write_fallback_secrets(app, &fallback_secrets);
    }

    #[cfg(not(debug_assertions))]
    Err("Cloud Sync could not save the token in the system keychain.".to_owned())
}

pub(crate) fn delete_repository_secrets(app: &tauri::AppHandle) -> Result<(), String> {
    let _ = KeychainSecretStore.delete_secret(GITHUB_TOKEN_KEY);
    let _ = KeychainSecretStore.delete_secret(GITLAB_TOKEN_KEY);
    write_fallback_secrets(app, &BTreeMap::new())
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
