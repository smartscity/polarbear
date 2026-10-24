use std::io;
use std::path::Path;
use std::sync::{RwLock, RwLockReadGuard, RwLockWriteGuard};

// Directory mutations exclude document saves across all windows, including descendants.
static PATH_LIFECYCLE: RwLock<()> = RwLock::new(());

pub(crate) fn document_access() -> io::Result<RwLockReadGuard<'static, ()>> {
    PATH_LIFECYCLE
        .read()
        .map_err(|_| io::Error::other("Workspace IO lock is unavailable."))
}

pub(crate) fn path_mutation() -> io::Result<RwLockWriteGuard<'static, ()>> {
    PATH_LIFECYCLE
        .write()
        .map_err(|_| io::Error::other("Workspace IO lock is unavailable."))
}

pub(crate) fn rename_exclusive(source: &Path, destination: &Path) -> io::Result<()> {
    #[cfg(any(target_os = "macos", target_os = "linux"))]
    {
        use std::ffi::CString;
        use std::os::unix::ffi::OsStrExt;
        let source = CString::new(source.as_os_str().as_bytes())?;
        let destination = CString::new(destination.as_os_str().as_bytes())?;
        // Both paths are live NUL-terminated strings; the OS atomically refuses replacement.
        #[cfg(target_os = "macos")]
        let result =
            unsafe { libc::renamex_np(source.as_ptr(), destination.as_ptr(), libc::RENAME_EXCL) };
        #[cfg(target_os = "linux")]
        let result = unsafe {
            libc::syscall(
                libc::SYS_renameat2,
                libc::AT_FDCWD,
                source.as_ptr(),
                libc::AT_FDCWD,
                destination.as_ptr(),
                libc::RENAME_NOREPLACE,
            )
        };
        if result == 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::ffi::OsStrExt;
        #[link(name = "kernel32")]
        unsafe extern "system" {
            fn MoveFileExW(source: *const u16, destination: *const u16, flags: u32) -> i32;
        }
        let source: Vec<u16> = source.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = destination
            .as_os_str()
            .encode_wide()
            .chain(Some(0))
            .collect();
        if source[..source.len() - 1].contains(&0)
            || destination[..destination.len() - 1].contains(&0)
        {
            return Err(io::Error::new(
                io::ErrorKind::InvalidInput,
                "Path contains NUL.",
            ));
        }
        // Unlike std::fs::rename, flags=0 does not enable MOVEFILE_REPLACE_EXISTING.
        if unsafe { MoveFileExW(source.as_ptr(), destination.as_ptr(), 0) } != 0 {
            Ok(())
        } else {
            Err(io::Error::last_os_error())
        }
    }
    #[cfg(not(any(target_os = "macos", target_os = "linux", target_os = "windows")))]
    {
        let _ = (source, destination);
        Err(io::Error::new(
            io::ErrorKind::Unsupported,
            "Exclusive rename is unavailable on this platform.",
        ))
    }
}

#[cfg(test)]
#[allow(clippy::unwrap_used, clippy::expect_used)]
mod tests {
    use super::*;
    use std::fs;
    use std::sync::{Arc, Barrier};

    struct TestDirectory(std::path::PathBuf);
    impl TestDirectory {
        fn new() -> Self {
            let path =
                std::env::temp_dir().join(format!("polarbear-move-{}", uuid::Uuid::new_v4()));
            fs::create_dir(&path).unwrap();
            Self(path)
        }
        fn path(&self) -> &Path {
            &self.0
        }
    }
    impl Drop for TestDirectory {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    #[test]
    fn concurrent_moves_never_replace_the_winner() {
        let dir = TestDirectory::new();
        let a = dir.path().join("a.md");
        let b = dir.path().join("b.md");
        let target = dir.path().join("target.md");
        fs::write(&a, "A").unwrap();
        fs::write(&b, "B").unwrap();
        let barrier = Arc::new(Barrier::new(3));
        let threads: Vec<_> = [a.clone(), b.clone()]
            .into_iter()
            .map(|source| {
                let target = target.clone();
                let barrier = barrier.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    rename_exclusive(&source, &target)
                })
            })
            .collect();
        barrier.wait();
        let results: Vec<_> = threads
            .into_iter()
            .map(|thread| thread.join().unwrap())
            .collect();
        assert_eq!(results.iter().filter(|result| result.is_ok()).count(), 1);
        let contents = fs::read_to_string(&target).unwrap();
        if contents == "A" {
            assert_eq!(fs::read_to_string(&b).unwrap(), "B");
        } else {
            assert_eq!(contents, "B");
            assert_eq!(fs::read_to_string(&a).unwrap(), "A");
        }
    }

    #[test]
    fn existing_directories_and_dangling_symlinks_are_not_replaced() {
        let dir = TestDirectory::new();
        let source = dir.path().join("source");
        let target = dir.path().join("target");
        fs::create_dir(&source).unwrap();
        fs::create_dir(&target).unwrap();
        assert!(rename_exclusive(&source, &target).is_err());
        assert!(source.is_dir() && target.is_dir());
        #[cfg(unix)]
        {
            fs::remove_dir(&target).unwrap();
            std::os::unix::fs::symlink(dir.path().join("missing"), &target).unwrap();
            assert!(rename_exclusive(&source, &target).is_err());
            assert!(fs::symlink_metadata(&target)
                .unwrap()
                .file_type()
                .is_symlink());
        }
    }

    #[test]
    fn path_mutation_waits_for_existing_document_access() {
        let reader = document_access().unwrap();
        let (send, receive) = std::sync::mpsc::channel();
        let writer = std::thread::spawn(move || {
            let _guard = path_mutation().unwrap();
            send.send(()).unwrap();
        });
        assert!(receive
            .recv_timeout(std::time::Duration::from_millis(50))
            .is_err());
        drop(reader);
        receive
            .recv_timeout(std::time::Duration::from_secs(2))
            .unwrap();
        writer.join().unwrap();
    }
}
