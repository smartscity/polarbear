pub(crate) fn atomic_write(path: &Path, content: &[u8]) -> Result<(), String> {
    save(path, content, None, SaveTarget::ReplaceOrCreate)
        .map(|_| ())
        .map_err(|error| error.message)
}

use crate::{content_revision, MarkdownSaveResponseDto, WorkspaceSaveError};
use std::collections::hash_map::DefaultHasher;
use std::fs::{self, File, OpenOptions};
use std::hash::{Hash, Hasher};
use std::io::{self, Read, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};

// Bounded locks cover both native save entry points; macOS also coordinates other processes.
const LOCK_STRIPES: usize = 64;
static SAVE_LOCKS: OnceLock<[Mutex<()>; LOCK_STRIPES]> = OnceLock::new();

#[derive(Clone, Copy)]
pub(crate) enum SaveTarget {
    Existing,
    ReplaceOrCreate,
    CreateNew,
}

pub(crate) fn save(
    path: &Path,
    content: &[u8],
    expected_revision: Option<&str>,
    target: SaveTarget,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    let _access = crate::workspace_io::document_access().map_err(save_error)?;
    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceSaveError::unexpected("Missing parent directory."))?;
    let name = path
        .file_name()
        .ok_or_else(|| WorkspaceSaveError::unexpected("Invalid file name."))?;
    let path = parent.canonicalize().map_err(save_error)?.join(name);
    let mut hash = DefaultHasher::new();
    path.hash(&mut hash);
    let locks = SAVE_LOCKS.get_or_init(|| std::array::from_fn(|_| Mutex::new(())));
    let _guard = locks[hash.finish() as usize % LOCK_STRIPES]
        .lock()
        .map_err(|_| WorkspaceSaveError::unexpected("Document save lock is unavailable."))?;
    coordinate(&path, |resolved| {
        save_coordinated(resolved, content, expected_revision, target)
    })
}

pub(crate) fn save_error(error: io::Error) -> WorkspaceSaveError {
    match error.kind() {
        io::ErrorKind::PermissionDenied => WorkspaceSaveError {
            code: "workspace.permissionDenied",
            message: "The file or its folder is not writable. Your edits have not been discarded."
                .to_owned(),
        },
        io::ErrorKind::NotFound => WorkspaceSaveError::document_missing(),
        _ => WorkspaceSaveError::unexpected(error.to_string()),
    }
}

struct Snapshot {
    #[cfg(target_os = "macos")]
    file: File,
    metadata: fs::Metadata,
    content: Vec<u8>,
}

fn snapshot(path: &Path) -> Result<Option<Snapshot>, WorkspaceSaveError> {
    let metadata = match fs::symlink_metadata(path) {
        Ok(metadata) => metadata,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(save_error(error)),
    };
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err(WorkspaceSaveError::unexpected(
            "Saving requires a regular file, not a symbolic link.",
        ));
    }
    if metadata.permissions().readonly() {
        return Err(save_error(io::Error::from(io::ErrorKind::PermissionDenied)));
    }
    let mut options = OpenOptions::new();
    // Opening without truncation enforces target ACLs, not only parent rename permission.
    options.read(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW);
    }
    let mut file = options.open(path).map_err(save_error)?;
    let metadata = file.metadata().map_err(save_error)?;
    let mut content = Vec::new();
    file.read_to_end(&mut content).map_err(save_error)?;
    Ok(Some(Snapshot {
        #[cfg(target_os = "macos")]
        file,
        metadata,
        content,
    }))
}

fn unchanged(before: &Snapshot, after: &Snapshot) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let a = &before.metadata;
        let b = &after.metadata;
        if (
            a.dev(),
            a.ino(),
            a.mode(),
            a.uid(),
            a.gid(),
            a.ctime(),
            a.ctime_nsec(),
        ) != (
            b.dev(),
            b.ino(),
            b.mode(),
            b.uid(),
            b.gid(),
            b.ctime(),
            b.ctime_nsec(),
        ) {
            return false;
        }
    }
    before.content == after.content
        && before.metadata.permissions() == after.metadata.permissions()
        && before.metadata.modified().ok() == after.metadata.modified().ok()
}

struct StagedFile(PathBuf);
impl Drop for StagedFile {
    fn drop(&mut self) {
        let _ = fs::remove_file(&self.0);
    }
}

fn save_coordinated(
    path: &Path,
    content: &[u8],
    expected_revision: Option<&str>,
    target: SaveTarget,
) -> Result<MarkdownSaveResponseDto, WorkspaceSaveError> {
    let original = snapshot(path)?;
    if matches!(target, SaveTarget::CreateNew) && original.is_some() {
        return Err(WorkspaceSaveError::document_changed());
    }
    if (matches!(target, SaveTarget::Existing) || expected_revision.is_some()) && original.is_none()
    {
        return Err(WorkspaceSaveError::document_missing());
    }
    if let (Some(expected), Some(original)) = (expected_revision, &original) {
        if content_revision(&original.content) != expected {
            return Err(WorkspaceSaveError::document_changed());
        }
    }
    let parent = path
        .parent()
        .ok_or_else(|| WorkspaceSaveError::unexpected("Missing parent directory."))?;
    let temporary_path = parent.join(format!(".polarbear-{}.tmp", uuid::Uuid::new_v4()));
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(&temporary_path).map_err(save_error)?;
    let staged = StagedFile(temporary_path);
    file.write_all(content).map_err(save_error)?;
    if let Some(original) = &original {
        preserve_metadata(original, &file).map_err(save_error)?;
    }
    file.sync_all().map_err(save_error)?;
    #[cfg(test)]
    crate::save_regression_tests::before_replace();
    // Detect non-coordinating writes/deletions observed while preparing the replacement.
    match (&original, snapshot(path)?) {
        (Some(before), Some(after)) if unchanged(before, &after) => (),
        (None, None) => (),
        (Some(_), None) => return Err(WorkspaceSaveError::document_missing()),
        _ => return Err(WorkspaceSaveError::document_changed()),
    }
    if original.is_none() {
        // Publish a new file without overwriting a concurrently created destination.
        fs::hard_link(&staged.0, path).map_err(|error| {
            if error.kind() == io::ErrorKind::AlreadyExists {
                WorkspaceSaveError::document_changed()
            } else {
                save_error(error)
            }
        })?;
    } else {
        fs::rename(&staged.0, path).map_err(save_error)?;
    }
    drop(staged);
    #[cfg(unix)]
    File::open(parent).and_then(|directory| directory.sync_all()).map_err(|error| WorkspaceSaveError {
        code: "workspace.saveDurabilityUncertain",
        message: format!("The file was replaced, but directory synchronization failed: {error}. Reload and verify before retrying."),
    })?;
    Ok(MarkdownSaveResponseDto {
        revision: content_revision(content),
        warning: None,
    })
}

fn preserve_metadata(original: &Snapshot, destination: &File) -> io::Result<()> {
    #[cfg(target_os = "macos")]
    {
        use std::os::fd::AsRawFd;
        // Copy security and extended attributes using open descriptors, never a second path lookup.
        if unsafe {
            libc::fcopyfile(
                original.file.as_raw_fd(),
                destination.as_raw_fd(),
                std::ptr::null_mut(),
                libc::COPYFILE_METADATA,
            )
        } != 0
        {
            return Err(io::Error::last_os_error());
        }
        destination.set_times(fs::FileTimes::new().set_modified(std::time::SystemTime::now()))?;
    }
    #[cfg(not(target_os = "macos"))]
    destination.set_permissions(original.metadata.permissions())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        let copied = destination.metadata()?;
        let before = &original.metadata;
        if (copied.uid(), copied.gid(), copied.mode())
            != (before.uid(), before.gid(), before.mode())
        {
            return Err(io::Error::new(
                io::ErrorKind::PermissionDenied,
                "Cannot preserve the file owner and permissions.",
            ));
        }
    }
    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn coordinate<T>(
    path: &Path,
    action: impl FnOnce(&Path) -> Result<T, WorkspaceSaveError>,
) -> Result<T, WorkspaceSaveError> {
    action(path)
}

#[cfg(target_os = "macos")]
fn coordinate<T, F>(path: &Path, action: F) -> Result<T, WorkspaceSaveError>
where
    F: FnOnce(&Path) -> Result<T, WorkspaceSaveError>,
{
    use std::ffi::{c_char, c_void, CStr, CString};
    use std::os::unix::ffi::OsStrExt;
    struct Call<F, T> {
        action: Option<F>,
        result: Option<Result<T, WorkspaceSaveError>>,
    }
    extern "C" fn access<F, T>(path: *const c_char, context: *mut c_void)
    where
        F: FnOnce(&Path) -> Result<T, WorkspaceSaveError>,
    {
        // Swift invokes this callback synchronously; neither pointer escapes this call.
        let call = unsafe { &mut *context.cast::<Call<F, T>>() };
        if let Some(action) = call.action.take() {
            let path = Path::new(std::ffi::OsStr::from_bytes(
                unsafe { CStr::from_ptr(path) }.to_bytes(),
            ));
            call.result = Some(
                std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| action(path)))
                    .unwrap_or_else(|_| {
                        Err(WorkspaceSaveError::unexpected(
                            "Document save was interrupted.",
                        ))
                    }),
            );
        }
    }
    unsafe extern "C" {
        fn polarbear_coordinate_document_write(
            path: *const c_char,
            context: *mut c_void,
            accessor: extern "C" fn(*const c_char, *mut c_void),
        ) -> i32;
    }
    let path = CString::new(path.as_os_str().as_bytes())
        .map_err(|_| WorkspaceSaveError::unexpected("Invalid file path."))?;
    let mut call = Call {
        action: Some(action),
        result: None,
    };
    let status = unsafe {
        polarbear_coordinate_document_write(
            path.as_ptr(),
            (&mut call as *mut Call<F, T>).cast(),
            access::<F, T>,
        )
    };
    if status != 0 {
        return Err(WorkspaceSaveError::unexpected(
            "System file coordination failed; no save was confirmed.",
        ));
    }
    call.result.ok_or_else(|| {
        WorkspaceSaveError::unexpected("System file coordination did not run the save.")
    })?
}
