use std::fs;
use std::io;
use std::path::Path;

pub(super) fn clear(path: &Path) -> Result<(), String> {
    let mut result = remove_if_present(path);
    let Some(parent) = path.parent() else {
        return result.map_err(|error| error.to_string());
    };
    match fs::read_dir(parent) {
        Ok(entries) => {
            for entry in entries {
                let entry = match entry {
                    Ok(entry) => entry,
                    Err(error) => {
                        result = result.and(Err(error));
                        continue;
                    }
                };
                let name = entry.file_name();
                let is_staged_credential = name
                    .to_str()
                    .and_then(|name| name.strip_prefix(".repository-secrets-"))
                    .and_then(|name| name.strip_suffix(".tmp"))
                    .is_some_and(|id| uuid::Uuid::parse_str(id).is_ok());
                if is_staged_credential {
                    // Unlink the entry itself; never follow a link left in staging.
                    result = result.and(remove_if_present(&entry.path()));
                }
            }
            #[cfg(unix)]
            {
                result =
                    result.and(fs::File::open(parent).and_then(|directory| directory.sync_all()));
            }
        }
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => result = result.and(Err(error)),
    }
    result.map_err(|error| error.to_string())
}

fn remove_if_present(path: &Path) -> io::Result<()> {
    match fs::remove_file(path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(error),
    }
}

#[cfg(all(debug_assertions, unix))]
pub(super) fn read(path: &Path) -> Result<Option<String>, String> {
    use std::io::Read;
    use std::os::unix::fs::OpenOptionsExt;
    let mut options = fs::OpenOptions::new();
    options.read(true);
    options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    let mut file = match options.open(path) {
        Ok(file) => file,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(error.to_string()),
    };
    if !file
        .metadata()
        .map_err(|error| error.to_string())?
        .is_file()
    {
        return Err("Credential fallback must be a regular file.".to_owned());
    }
    let mut content = String::new();
    file.read_to_string(&mut content)
        .map_err(|error| error.to_string())?;
    Ok(Some(content))
}

#[cfg(all(debug_assertions, not(unix)))]
pub(super) fn read(_: &Path) -> Result<Option<String>, String> {
    Err("Plaintext credential fallback is unavailable on this platform.".to_owned())
}

#[cfg(unix)]
pub(super) fn write(path: &Path, content: &[u8]) -> Result<(), String> {
    write_with(path, |file| {
        use std::io::Write;
        file.write_all(content)
    })
    .map_err(|error| error.to_string())
}

#[cfg(not(unix))]
pub(super) fn write(_: &Path, _: &[u8]) -> Result<(), String> {
    // A POSIX mode cannot guarantee a private Windows ACL. Require the keychain.
    Err("Plaintext credential fallback is unavailable on this platform.".to_owned())
}

#[cfg(unix)]
fn write_with(
    path: &Path,
    write_content: impl FnOnce(&mut fs::File) -> io::Result<()>,
) -> io::Result<()> {
    use std::os::unix::fs::OpenOptionsExt;
    let parent = path
        .parent()
        .ok_or_else(|| io::Error::other("Missing credential directory"))?;
    match fs::symlink_metadata(path) {
        Ok(metadata) if !metadata.is_file() => {
            return Err(io::Error::other(
                "Credential fallback must be a regular file",
            ))
        }
        Ok(_) => {}
        Err(error) if error.kind() == io::ErrorKind::NotFound => {}
        Err(error) => return Err(error),
    }
    let temporary = parent.join(format!(".repository-secrets-{}.tmp", uuid::Uuid::new_v4()));
    let mut file = fs::OpenOptions::new()
        .write(true)
        .create_new(true)
        .mode(0o600)
        .open(&temporary)?;
    struct StagedFile(std::path::PathBuf);
    impl Drop for StagedFile {
        fn drop(&mut self) {
            let _ = fs::remove_file(&self.0);
        }
    }
    let _staged = StagedFile(temporary.clone());
    // macOS ACL grants are independent of mode bits. Remove inherited grants
    // before writing any secret; never copy metadata from the old credential.
    #[cfg(target_os = "macos")]
    remove_inherited_acl(&file)?;
    write_content(&mut file)?;
    file.sync_all()?;
    fs::rename(&temporary, path)?;
    fs::File::open(parent)?.sync_all()
}

#[cfg(target_os = "macos")]
fn remove_inherited_acl(file: &fs::File) -> io::Result<()> {
    use std::ffi::c_void;
    use std::os::fd::AsRawFd;
    unsafe extern "C" {
        fn acl_init(count: libc::c_int) -> *mut c_void;
        fn acl_set_fd_np(fd: libc::c_int, acl: *mut c_void, kind: libc::c_int) -> libc::c_int;
        fn acl_free(acl: *mut c_void) -> libc::c_int;
    }
    const ACL_TYPE_EXTENDED: libc::c_int = 0x100;
    // The empty ACL belongs to this scope and the descriptor stays open.
    unsafe {
        let acl = acl_init(0);
        if acl.is_null() {
            return Err(io::Error::last_os_error());
        }
        let result = acl_set_fd_np(file.as_raw_fd(), acl, ACL_TYPE_EXTENDED);
        let error = io::Error::last_os_error();
        acl_free(acl);
        if result == 0 {
            Ok(())
        } else {
            Err(error)
        }
    }
}

#[cfg(all(test, unix))]
#[allow(clippy::unwrap_used)]
mod tests {
    use super::*;
    use std::io::Write;
    use std::os::unix::fs::PermissionsExt;

    #[test]
    fn disconnect_removes_crash_leftovers_without_removing_unrelated_files() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("repository-secrets.json");
        let staged = directory.join(format!(".repository-secrets-{}.tmp", uuid::Uuid::new_v4()));
        let unrelated = directory.join(".repository-secrets-user-notes.tmp");
        fs::write(&path, b"old secret").unwrap();
        fs::write(&staged, b"interrupted new secret").unwrap();
        fs::write(&unrelated, b"user notes").unwrap();
        clear(&path).unwrap();
        assert!(!path.exists());
        let removed = !staged.exists();
        assert!(unrelated.exists());
        clear(&path).unwrap();
        fs::remove_dir_all(directory).unwrap();
        assert!(
            removed,
            "Disconnect must remove unpublished credential copies too"
        );
    }

    #[test]
    fn failed_staging_cleanup_is_reported_and_retry_is_idempotent() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("repository-secrets.json");
        let invalid = directory.join(format!(".repository-secrets-{}.tmp", uuid::Uuid::new_v4()));
        let valid = directory.join(format!(".repository-secrets-{}.tmp", uuid::Uuid::new_v4()));
        fs::create_dir(&invalid).unwrap();
        fs::write(&valid, b"interrupted secret").unwrap();
        fs::write(&path, b"current secret").unwrap();
        assert!(clear(&path).is_err());
        assert!(!path.exists());
        assert!(
            !valid.exists(),
            "Cleanup must attempt every staging file after a failure"
        );
        fs::remove_dir(invalid).unwrap();
        clear(&path).unwrap();
        clear(&path).unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[test]
    fn permissive_umask_cannot_expose_the_first_write() {
        let status = std::process::Command::new("/bin/sh")
            .args(["-c", "umask 000; exec \"$1\" --exact secret_store::credential_file::tests::private_before_first_byte_and_failed_write_preserves_old_file --nocapture", "credential-permission-fixture"])
            .arg(std::env::current_exe().unwrap()).status().unwrap();
        assert!(status.success());
    }

    #[test]
    fn private_before_first_byte_and_failed_write_preserves_old_file() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("repository-secrets.json");
        fs::write(&path, b"old credential").unwrap();
        let result = write_with(&path, |file| {
            assert_eq!(file.metadata()?.len(), 0);
            assert_eq!(file.metadata()?.permissions().mode() & 0o777, 0o600);
            file.write_all(b"partial secret")?;
            Err(io::Error::other("injected disk failure"))
        });
        assert!(result.is_err());
        assert_eq!(fs::read(&path).unwrap(), b"old credential");
        assert_eq!(fs::read_dir(&directory).unwrap().count(), 1);
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn inherited_acl_is_removed_before_the_secret_is_written() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let result = std::process::Command::new("/bin/chmod")
            .args(["+a", "everyone allow read,file_inherit,directory_inherit"])
            .arg(&directory)
            .status()
            .unwrap();
        assert!(result.success());
        let probe = directory.join("acl-probe");
        fs::write(&probe, b"not a secret").unwrap();
        let inherited = std::process::Command::new("/bin/ls")
            .arg("-le")
            .arg(&probe)
            .output()
            .unwrap();
        assert!(inherited.status.success());
        assert!(String::from_utf8_lossy(&inherited.stdout).contains("inherited allow read"));
        fs::remove_file(probe).unwrap();
        let path = directory.join("repository-secrets.json");
        write_with(&path, |file| {
            let staged = fs::read_dir(&directory)?.next().unwrap()?.path();
            let output = std::process::Command::new("/bin/ls")
                .arg("-le")
                .arg(staged)
                .output()?;
            assert!(output.status.success());
            assert_eq!(
                String::from_utf8_lossy(&output.stdout).lines().count(),
                1,
                "No extended ACL entry may remain"
            );
            assert_eq!(file.metadata()?.len(), 0);
            file.write_all(b"secret")
        })
        .unwrap();
        fs::remove_dir_all(directory).unwrap();
    }

    #[cfg(debug_assertions)]
    #[test]
    fn absent_fallback_differs_from_a_symlink_or_corrupt_file() {
        let directory =
            std::env::temp_dir().join(format!("polarbear-secret-{}", uuid::Uuid::new_v4()));
        fs::create_dir(&directory).unwrap();
        let path = directory.join("repository-secrets.json");
        assert_eq!(read(&path).unwrap(), None);
        std::os::unix::fs::symlink(directory.join("absent"), &path).unwrap();
        assert!(read(&path).is_err());
        fs::remove_file(&path).unwrap();
        fs::write(&path, [0xff]).unwrap();
        assert!(read(&path).is_err());
        fs::remove_dir_all(directory).unwrap();
    }
}
