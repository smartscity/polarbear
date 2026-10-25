use crate::repository::{policy::allowed_sync_file, store::scan_sync_files};
use crate::workspace_paths::{normalize_relative_path, relative_path_for_wire, workspace_path};
use crate::{DeleteEntryResponseDto, DuplicateEntryResponseDto, SaveWarning};
use std::collections::BTreeSet;
use std::fs;
use std::path::{Path, PathBuf};

fn entry_path(root: &str, relative: &str) -> Result<(String, PathBuf), String> {
    let relative = relative_path_for_wire(&normalize_relative_path(relative)?);
    if relative.is_empty() {
        return Err("Workspace root cannot be deleted or duplicated.".to_owned());
    }
    let path = workspace_path(root, &relative)?;
    if !path.exists() {
        return Err("The selected file or folder no longer exists.".to_owned());
    }
    Ok((relative, path))
}

/// The native acknowledgement is the disk commit, not the subsequent sync enqueue.
pub(crate) fn delete(
    root: &str,
    relative: &str,
    tracked_paths: &BTreeSet<String>,
    enqueue: impl FnOnce(&BTreeSet<String>) -> Result<(), String>,
) -> Result<DeleteEntryResponseDto, String> {
    let _mutation = crate::workspace_io::path_mutation().map_err(|error| error.to_string())?;
    let (relative, path) = entry_path(root, relative)?;
    let prefix = format!("{relative}/");
    let mut deleted: BTreeSet<String> = tracked_paths
        .iter()
        .filter(|key| **key == relative || key.starts_with(&prefix))
        .cloned()
        .collect();
    if path.is_dir() {
        deleted.extend(scan_sync_files(Path::new(root), &path)?.into_keys());
        fs::remove_dir_all(&path).map_err(|error| error.to_string())?;
    } else {
        if allowed_sync_file(&path) {
            deleted.insert(relative);
        }
        fs::remove_file(&path).map_err(|error| error.to_string())?;
    }
    let warning = enqueue(&deleted)
        .err()
        .map(|_| SaveWarning::SyncQueueUnavailable);
    Ok(DeleteEntryResponseDto {
        deleted_relative_paths: deleted.into_iter().collect(),
        warning,
    })
}

pub(crate) fn duplicate(
    root: &str,
    relative: &str,
    enqueue: impl FnOnce(&BTreeSet<String>) -> Result<(), String>,
) -> Result<DuplicateEntryResponseDto, String> {
    let _mutation = crate::workspace_io::path_mutation().map_err(|error| error.to_string())?;
    let (_, source) = entry_path(root, relative)?;
    let parent = source
        .parent()
        .ok_or("Workspace root cannot be duplicated.")?;
    let destination = next_duplicate_path(&source, parent);
    copy_entry(&source, &destination)?;
    let new_relative_path = relative_path_for_wire(
        destination
            .strip_prefix(root)
            .map_err(|error| error.to_string())?,
    );
    let files = if destination.is_dir() {
        scan_sync_files(Path::new(root), &destination).map(|files| files.into_keys().collect())
    } else {
        Ok(if allowed_sync_file(&destination) {
            BTreeSet::from([new_relative_path.clone()])
        } else {
            BTreeSet::new()
        })
    };
    let warning = files
        .and_then(|files| enqueue(&files))
        .err()
        .map(|_| SaveWarning::SyncQueueUnavailable);
    Ok(DuplicateEntryResponseDto {
        new_relative_path,
        warning,
    })
}

fn next_duplicate_path(source: &Path, parent: &Path) -> PathBuf {
    let file_name = source
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Copy");
    let (stem, extension) = if source.is_file() {
        (
            source
                .file_stem()
                .and_then(|name| name.to_str())
                .unwrap_or(file_name),
            source.extension().and_then(|value| value.to_str()),
        )
    } else {
        (file_name, None)
    };
    for index in 1.. {
        let suffix = if index == 1 {
            " copy".to_owned()
        } else {
            format!(" copy {index}")
        };
        let name = match extension {
            Some(extension) => format!("{stem}{suffix}.{extension}"),
            None => format!("{stem}{suffix}"),
        };
        let candidate = parent.join(name);
        if !candidate.exists() {
            return candidate;
        }
    }
    unreachable!("duplicate name loop is unbounded")
}

fn copy_entry(source: &Path, destination: &Path) -> Result<(), String> {
    let metadata = fs::symlink_metadata(source).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Symbolic links cannot be duplicated.".to_owned());
    }
    if metadata.is_dir() {
        fs::create_dir(destination).map_err(|error| error.to_string())?;
        for entry in fs::read_dir(source).map_err(|error| error.to_string())? {
            let entry = entry.map_err(|error| error.to_string())?;
            copy_entry(&entry.path(), &destination.join(entry.file_name()))?;
        }
        return Ok(());
    }
    if !metadata.is_file() {
        return Err("Only regular files and directories can be duplicated.".to_owned());
    }
    // A destination created after the name check must never be overwritten.
    let mut input = fs::File::open(source).map_err(|error| error.to_string())?;
    let mut options = fs::OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut output = options
        .open(destination)
        .map_err(|error| error.to_string())?;
    output
        .set_permissions(
            input
                .metadata()
                .map_err(|error| error.to_string())?
                .permissions(),
        )
        .map_err(|error| error.to_string())?;
    std::io::copy(&mut input, &mut output)
        .map(|_| ())
        .map_err(|error| error.to_string())
}
