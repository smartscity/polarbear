use super::{
    model::RepositoryBindingDto,
    policy::{allowed_sync_file, excluded_sync_path, stream_digest},
};
use crate::{app_paths::app_config_dir, cloud_sync_store};
use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

type LocalSnapshot = (BTreeMap<String, PathBuf>, BTreeMap<String, String>);

pub(crate) fn bindings_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("repository-bindings.json"))
}

pub(crate) fn cloud_sync_database_path(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    Ok(app_config_dir(app)?.join("cloud-sync.sqlite3"))
}

pub(crate) fn read_bindings(
    app: &tauri::AppHandle,
) -> Result<BTreeMap<String, RepositoryBindingDto>, String> {
    cloud_sync_store::load_bindings(&cloud_sync_database_path(app)?, &bindings_path(app)?)
}

pub(crate) fn write_bindings(
    app: &tauri::AppHandle,
    bindings: &BTreeMap<String, RepositoryBindingDto>,
) -> Result<(), String> {
    cloud_sync_store::replace_bindings(&cloud_sync_database_path(app)?, bindings)
}

pub(crate) fn read_binding(
    app: &tauri::AppHandle,
    workspace_ref: &str,
) -> Result<Option<RepositoryBindingDto>, String> {
    Ok(read_bindings(app)?.get(workspace_ref).cloned())
}

pub(crate) fn scan_sync_files(
    root: &Path,
    current: &Path,
) -> Result<BTreeMap<String, PathBuf>, String> {
    let mut files = BTreeMap::new();

    for entry_result in fs::read_dir(current).map_err(|error| error.to_string())? {
        let entry = entry_result.map_err(|error| error.to_string())?;
        let path = entry.path();
        let relative = path.strip_prefix(root).map_err(|error| error.to_string())?;
        if excluded_sync_path(relative) {
            continue;
        }
        if entry
            .file_type()
            .map_err(|error| error.to_string())?
            .is_symlink()
        {
            continue;
        }

        if path.is_dir() {
            files.extend(scan_sync_files(root, &path)?);
        } else if allowed_sync_file(relative) {
            let relative_path = path
                .strip_prefix(root)
                .map_err(|error| error.to_string())?
                .to_string_lossy()
                .replace('\\', "/");
            files.insert(relative_path, path);
        }
    }

    Ok(files)
}

pub(crate) fn file_digest(path: &Path) -> Result<String, String> {
    stream_digest(fs::File::open(path).map_err(|error| error.to_string())?)
        .map_err(|error| error.to_string())
}

pub(crate) fn local_manifest(
    app: &tauri::AppHandle,
    workspace_root: &str,
) -> Result<BTreeMap<String, String>, String> {
    Ok(local_snapshot(app, workspace_root)?.1)
}

pub(crate) fn local_snapshot(
    _app: &tauri::AppHandle,
    workspace_root: &str,
) -> Result<LocalSnapshot, String> {
    let root = PathBuf::from(workspace_root);
    let files = scan_sync_files(&root, &root)?;
    // Size and mtime are not content versions: external writers can preserve both.
    let manifest = files
        .iter()
        .map(|(path, file)| Ok((path.clone(), file_digest(file)?)))
        .collect::<Result<BTreeMap<_, _>, String>>()?;
    Ok((files, manifest))
}

pub(crate) fn update_sync_outbox(
    app: &tauri::AppHandle,
    binding: &RepositoryBindingDto,
    local_manifest: &BTreeMap<String, String>,
) -> Result<(), String> {
    let operations = local_manifest
        .iter()
        .filter(|(path, digest)| binding.manifest.get(*path) != Some(*digest))
        .map(|(path, _)| (path.clone(), "upload".to_owned()))
        .chain(
            binding
                .manifest
                .keys()
                .filter(|path| !local_manifest.contains_key(*path))
                .map(|path| (path.clone(), "delete".to_owned())),
        )
        .collect::<Vec<_>>();
    cloud_sync_store::replace_outbox(
        &cloud_sync_database_path(app)?,
        &binding.workspace_ref,
        &operations,
    )
}
