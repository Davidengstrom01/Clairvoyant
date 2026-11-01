//! Everything macOS-specific lives here, so a later port only touches this file.

use std::io::Read;
use std::path::Path;
use std::process::{Command, Stdio};
use std::thread;
use std::time::{Duration, Instant};

use crate::error::{Error, Result};

/// PATH as the user's login shell sets it. Apps launched from Finder or the Dock
/// get a bare `/usr/bin:/bin:...`, which breaks hooks that need node, npx or dotnet.
pub fn login_shell_path() -> Option<String> {
    let shell = std::env::var("SHELL").unwrap_or_else(|_| "/bin/zsh".into());
    let output = Command::new(shell)
        .args(["-lc", "printf %s \"$PATH\""])
        .stdin(Stdio::null())
        .output()
        .ok()?;
    let path = String::from_utf8(output.stdout).ok()?;
    (output.status.success() && !path.is_empty()).then_some(path)
}

/// Runs a user-configured command template like `code {path}` through `sh`.
/// `{path}` is replaced with the shell-quoted path, or appended when absent.
pub fn run_template(template: &str, path: &Path, env_path: Option<&str>) -> Result<()> {
    let quoted = shell_quote(&path.to_string_lossy());
    let script = if template.contains("{path}") {
        template.replace("{path}", &quoted)
    } else {
        format!("{template} {quoted}")
    };
    let mut cmd = Command::new("/bin/sh");
    cmd.args(["-c", &script])
        .current_dir(path)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::piped());
    if let Some(env_path) = env_path {
        cmd.env("PATH", env_path);
    }
    let mut child = cmd.spawn()?;

    // Most templates (`open -a`, `code`) return at once. One that keeps running,
    // like a terminal launched directly, is left alone after a grace period.
    let deadline = Instant::now() + Duration::from_secs(3);
    while Instant::now() < deadline {
        if let Some(status) = child.try_wait()? {
            if status.success() {
                return Ok(());
            }
            let mut stderr = String::new();
            if let Some(mut pipe) = child.stderr.take() {
                let _ = pipe.read_to_string(&mut stderr);
            }
            return Err(Error::Refused(format!(
                "`{script}` failed: {}",
                stderr.trim()
            )));
        }
        thread::sleep(Duration::from_millis(50));
    }
    Ok(())
}

pub fn shell_quote(s: &str) -> String {
    format!("'{}'", s.replace('\'', r"'\''"))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn quotes_spaces_and_single_quotes() {
        assert_eq!(shell_quote("/a b/it's"), r"'/a b/it'\''s'");
    }

    #[test]
    fn template_substitutes_or_appends_the_path() {
        let dir = tempfile::tempdir().unwrap();
        let marker = dir.path().join("out");
        let template = format!(
            "printf %s {{path}} > {}",
            shell_quote(&marker.to_string_lossy())
        );
        run_template(&template, dir.path(), None).unwrap();
        assert_eq!(
            std::fs::read_to_string(&marker).unwrap(),
            dir.path().to_string_lossy()
        );

        assert!(run_template("false", dir.path(), None).is_err());
    }
}
