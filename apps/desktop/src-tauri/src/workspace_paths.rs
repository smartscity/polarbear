use std::fs;
use std::path::{Component, Path, PathBuf};

pub(crate) fn normalize_relative_path(relative_path: &str) -> Result<PathBuf, String> {
    let path = Path::new(relative_path);

    if path.is_absolute() {
        return Err("Absolute paths are not allowed inside a workspace.".to_owned());
    }

    let mut normalized_path = PathBuf::new();

    for component in path.components() {
        match component {
            Component::Normal(value) => normalized_path.push(value),
            Component::CurDir => {}
            Component::ParentDir => {
                return Err("Parent directory traversal is not allowed.".to_owned());
            }
            Component::RootDir | Component::Prefix(_) => {
                return Err("Unsupported path component.".to_owned());
            }
        }
    }

    Ok(normalized_path)
}

pub(crate) fn workspace_path(workspace_root: &str, relative_path: &str) -> Result<PathBuf, String> {
    let root = PathBuf::from(workspace_root);
    let canonical_root = root
        .canonicalize()
        .map_err(|_| "Workspace root is not a directory.".to_owned())?;
    if !canonical_root.is_dir() {
        return Err("Workspace root is not a directory.".to_owned());
    }

    let path = root.join(normalize_relative_path(relative_path)?);
    let mut existing_ancestor = path.as_path();
    loop {
        match fs::symlink_metadata(existing_ancestor) {
            Ok(_) => {
                let canonical_ancestor = existing_ancestor
                    .canonicalize()
                    .map_err(|error| error.to_string())?;
                if !canonical_ancestor.starts_with(&canonical_root) {
                    return Err("Path must stay inside the workspace.".to_owned());
                }
                break;
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                existing_ancestor = existing_ancestor
                    .parent()
                    .ok_or_else(|| "Path must stay inside the workspace.".to_owned())?;
            }
            Err(error) => return Err(error.to_string()),
        }
    }

    Ok(path)
}

pub(crate) fn validate_entry_name(name: &str) -> Result<(), String> {
    let trimmed_name = name.trim();

    if trimmed_name.is_empty() {
        return Err("Name cannot be empty.".to_owned());
    }

    if trimmed_name == "."
        || trimmed_name == ".."
        || trimmed_name.contains('/')
        || trimmed_name.contains('\\')
    {
        return Err(
            "Name cannot contain path separators or parent directory traversal.".to_owned(),
        );
    }

    Ok(())
}
