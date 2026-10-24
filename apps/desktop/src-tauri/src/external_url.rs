pub(crate) fn validate_url(input: &str) -> Result<String, String> {
    const INVALID: &str =
        "Only valid http and https URLs without embedded credentials can be opened externally.";
    if !input.split_once("://").is_some_and(|(scheme, _)| {
        scheme.eq_ignore_ascii_case("http") || scheme.eq_ignore_ascii_case("https")
    }) || input
        .chars()
        .any(|character| character.is_ascii_control() || character == '\\')
    {
        return Err(INVALID.to_owned());
    }
    let url = tauri::Url::parse(input).map_err(|_| INVALID.to_owned())?;
    if !matches!(url.scheme(), "http" | "https")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
    {
        return Err(INVALID.to_owned());
    }
    Ok(url.to_string())
}

const OPEN_FAILED: &str = "The system could not open the external link.";

pub(crate) fn open(input: &str) -> Result<(), String> {
    let url = validate_url(input)?;
    #[cfg(target_os = "macos")]
    return run_launcher(std::process::Command::new("/usr/bin/open").arg(&url));
    #[cfg(all(unix, not(target_os = "macos")))]
    return run_launcher(std::process::Command::new("xdg-open").arg(&url));
    #[cfg(target_os = "windows")]
    return open_windows(&url);
    #[cfg(not(any(unix, target_os = "windows")))]
    {
        let _ = url;
        Err("Opening external links is unsupported on this platform.".to_owned())
    }
}

#[cfg(unix)]
fn run_launcher(command: &mut std::process::Command) -> Result<(), String> {
    let status = command
        .stdin(std::process::Stdio::null())
        .stdout(std::process::Stdio::null())
        .stderr(std::process::Stdio::null())
        .status()
        .map_err(|_| OPEN_FAILED.to_owned())?;
    if status.success() {
        Ok(())
    } else {
        Err(OPEN_FAILED.to_owned())
    }
}

#[cfg(any(target_os = "windows", test))]
fn shell_open_result(result: isize) -> Result<(), String> {
    if result > 32 {
        Ok(())
    } else {
        Err(OPEN_FAILED.to_owned())
    }
}

#[cfg(target_os = "windows")]
fn open_windows(url: &str) -> Result<(), String> {
    use std::ffi::c_void;
    #[link(name = "shell32")]
    extern "system" {
        fn ShellExecuteW(
            window: *mut c_void,
            operation: *const u16,
            file: *const u16,
            parameters: *const u16,
            directory: *const u16,
            show: i32,
        ) -> *mut c_void;
    }
    let operation: Vec<u16> = "open\0".encode_utf16().collect();
    let target: Vec<u16> = url.encode_utf16().chain([0]).collect();
    // Pass a validated URL as data, never as a cmd.exe command line. Buffers live through the call.
    let result = unsafe {
        ShellExecuteW(
            std::ptr::null_mut(),
            operation.as_ptr(),
            target.as_ptr(),
            std::ptr::null(),
            std::ptr::null(),
            1,
        )
    };
    shell_open_result(result as isize)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_invalid_or_sensitive_urls_without_launching_anything() {
        for input in [
            "https://",
            "https://user:secret@example.com",
            "https://example.com/\nnext",
            "https://example.com/\\next",
            "file:///tmp/example",
            "javascript:alert(1)",
            "https:example.com",
            "https:example.com://path",
            "/relative",
        ] {
            assert!(validate_url(input).is_err(), "Unsafe URL was accepted");
        }
    }

    #[test]
    fn accepts_web_urls_and_preserves_query_and_fragment() {
        let input = "https://example.com/docs?q=one&two=2#section";
        assert_eq!(validate_url(input).as_deref(), Ok(input));
        assert_eq!(
            validate_url("HTTPS://EXAMPLE.COM").as_deref(),
            Ok("https://example.com/")
        );
    }

    #[cfg(unix)]
    #[test]
    fn launcher_exit_failure_and_spawn_failure_are_not_success() {
        use std::process::Command;
        assert!(run_launcher(Command::new("/bin/sh").args(["-c", "exit 7"])).is_err());
        assert!(run_launcher(&mut Command::new("/nonexistent/polarbear-browser-test")).is_err());
        assert!(run_launcher(Command::new("/bin/sh").args(["-c", "exit 0"])).is_ok());
    }

    #[test]
    fn windows_shell_result_distinguishes_all_failure_codes_from_success() {
        for result in 0..=32 {
            assert!(shell_open_result(result).is_err());
        }
        assert!(shell_open_result(33).is_ok());
    }
}
