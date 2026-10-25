use super::model::RepositoryBindingDto;
use base64::{engine::general_purpose::STANDARD as BASE64, Engine as _};
use sha2::{Digest, Sha256};
use std::{collections::BTreeMap, path::Path};

pub(crate) fn excluded_sync_path(path: &Path) -> bool {
    let excluded = [
        ".git",
        "node_modules",
        ".DS_Store",
        ".idea",
        ".vscode",
        "target",
        "dist",
        "build",
    ];

    path.components().any(|component| {
        component
            .as_os_str()
            .to_str()
            .map(|part| excluded.contains(&part))
            .unwrap_or(false)
    })
}

pub(crate) fn allowed_sync_file(path: &Path) -> bool {
    !excluded_sync_path(path)
        && path
            .extension()
            .and_then(|extension| extension.to_str())
            .map(|extension| {
                matches!(
                    extension.to_ascii_lowercase().as_str(),
                    "md" | "markdown"
                        | "mmd"
                        | "puml"
                        | "plantuml"
                        | "uml"
                        | "png"
                        | "jpg"
                        | "jpeg"
                        | "gif"
                        | "svg"
                        | "webp"
                        | "pdf"
                )
            })
            .unwrap_or(false)
}

pub(crate) fn content_digest(content: &[u8]) -> String {
    format!("sha256:v1:{:x}", Sha256::digest(content))
}

pub(crate) fn stream_digest(mut reader: impl std::io::Read) -> std::io::Result<String> {
    let mut hasher = Sha256::new();
    let mut buffer = [0_u8; 64 * 1024];
    loop {
        let count = reader.read(&mut buffer)?;
        if count == 0 {
            break;
        }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("sha256:v1:{:x}", hasher.finalize()))
}

pub(crate) fn migrate_digest(value: &str) -> Result<String, String> {
    if let Some(hash) = value.strip_prefix("sha256:v1:") {
        if hash.len() == 64
            && hash
                .bytes()
                .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
        {
            return Ok(value.to_owned());
        }
    } else if let Some((length, encoded)) = value.split_once(':') {
        if let (Ok(length), Ok(bytes)) = (length.parse::<usize>(), BASE64.decode(encoded)) {
            if length == bytes.len() {
                return Ok(content_digest(&bytes));
            }
        }
    }
    Err("Cloud Sync baseline digest is invalid; migration was not committed. Keep the database for recovery.".to_owned())
}

pub(crate) fn manifest_change_count(
    current_manifest: &BTreeMap<String, String>,
    baseline_manifest: &BTreeMap<String, String>,
) -> usize {
    let changed_or_added = current_manifest
        .iter()
        .filter(|(path, digest)| baseline_manifest.get(*path) != Some(*digest))
        .count();
    let deleted = baseline_manifest
        .keys()
        .filter(|path| !current_manifest.contains_key(*path))
        .count();
    changed_or_added + deleted
}

pub(crate) fn remote_manifest_changed(
    remote_manifest: &BTreeMap<String, String>,
    baseline_manifest: &BTreeMap<String, String>,
) -> bool {
    manifest_change_count(remote_manifest, baseline_manifest) > 0
}

pub(crate) fn remote_path_for(binding: &RepositoryBindingDto, relative_path: &str) -> String {
    let remote_root = binding.remote_path.trim_matches('/');
    if remote_root.is_empty() {
        relative_path.to_owned()
    } else {
        format!("{remote_root}/{relative_path}")
    }
}

pub(crate) fn relative_sync_path(
    binding: &RepositoryBindingDto,
    repository_path: &str,
) -> Option<String> {
    let remote_root = binding.remote_path.trim_matches('/');
    let relative_path = if remote_root.is_empty() {
        repository_path.to_owned()
    } else {
        repository_path
            .strip_prefix(&format!("{remote_root}/"))?
            .to_owned()
    };

    allowed_sync_file(Path::new(&relative_path)).then_some(relative_path)
}

pub(crate) fn github_content_url(binding: &RepositoryBindingDto, relative_path: &str) -> String {
    let encoded_path = remote_path_for(binding, relative_path)
        .split('/')
        .map(|part| urlencoding::encode(part).to_string())
        .collect::<Vec<_>>()
        .join("/");
    format!(
        "https://api.github.com/repos/{}/{}/contents/{}",
        binding.owner, binding.repo, encoded_path
    )
}
