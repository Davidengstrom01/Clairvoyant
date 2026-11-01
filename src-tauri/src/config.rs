//! The registered repos and app settings. This file is the only state Clairvoyant
//! owns; everything about the repos themselves is read from git.

use std::fs;
use std::io::ErrorKind;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};

use crate::error::{Error, Result};

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RegisteredRepo {
    /// The main worktree; linked worktrees are discovered from it.
    pub path: PathBuf,
    /// Where new worktrees are created. `None` means `<repo-parent>/<repo>.worktrees`.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub worktree_root: Option<PathBuf>,
}

impl RegisteredRepo {
    pub fn new(path: PathBuf) -> Self {
        Self {
            path,
            worktree_root: None,
        }
    }

    pub fn effective_worktree_root(&self) -> PathBuf {
        if let Some(root) = &self.worktree_root {
            return root.clone();
        }
        let name = self.path.file_name().unwrap_or_default().to_string_lossy();
        self.path
            .parent()
            .unwrap_or(&self.path)
            .join(format!("{name}.worktrees"))
    }
}

/// Commands for the jump-out buttons. `{path}` becomes the shell-quoted worktree path.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct Settings {
    pub editor_command: String,
    pub claude_command: String,
}

impl Default for Settings {
    fn default() -> Self {
        Self {
            editor_command: "code {path}".into(),
            claude_command: "open -na Ghostty --args --working-directory={path} -e claude".into(),
        }
    }
}

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Config {
    pub repos: Vec<RegisteredRepo>,
    #[serde(default)]
    pub settings: Settings,
}

impl Config {
    pub fn load(file: &Path) -> Result<Self> {
        match fs::read_to_string(file) {
            Ok(json) => serde_json::from_str(&json)
                .map_err(|e| Error::Config(format!("{}: {e}", file.display()))),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// Writes to a temp file and renames it so a crash never leaves a half-written config.
    pub fn save(&self, file: &Path) -> Result<()> {
        if let Some(dir) = file.parent() {
            fs::create_dir_all(dir)?;
        }
        let json = serde_json::to_string_pretty(self).map_err(|e| Error::Config(e.to_string()))?;
        let tmp = file.with_extension("json.tmp");
        fs::write(&tmp, json)?;
        fs::rename(&tmp, file)?;
        Ok(())
    }

    /// Returns false when the repo is already registered.
    pub fn add(&mut self, repo: RegisteredRepo) -> bool {
        if self.repos.iter().any(|r| r.path == repo.path) {
            return false;
        }
        self.repos.push(repo);
        true
    }

    /// Returns false when the repo was not registered.
    pub fn remove(&mut self, path: &Path) -> bool {
        let before = self.repos.len();
        self.repos.retain(|r| r.path != path);
        self.repos.len() != before
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn missing_file_loads_as_empty() {
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(
            Config::load(&dir.path().join("repos.json")).unwrap(),
            Config::default()
        );
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested/repos.json");
        let mut config = Config::default();
        config.add(RegisteredRepo::new("/code/app".into()));
        config.add(RegisteredRepo {
            path: "/code/api".into(),
            worktree_root: Some("/wt/api".into()),
        });

        config.save(&file).unwrap();

        assert_eq!(Config::load(&file).unwrap(), config);
    }

    #[test]
    fn add_and_remove_ignore_duplicates_and_unknowns() {
        let mut config = Config::default();
        assert!(config.add(RegisteredRepo::new("/code/app".into())));
        assert!(!config.add(RegisteredRepo::new("/code/app".into())));
        assert!(!config.remove(Path::new("/code/other")));
        assert!(config.remove(Path::new("/code/app")));
        assert!(config.repos.is_empty());
    }

    #[test]
    fn worktree_root_defaults_next_to_the_repo() {
        let repo = RegisteredRepo::new("/code/app".into());
        assert_eq!(
            repo.effective_worktree_root(),
            PathBuf::from("/code/app.worktrees")
        );

        let custom = RegisteredRepo {
            worktree_root: Some("/wt".into()),
            ..repo
        };
        assert_eq!(custom.effective_worktree_root(), PathBuf::from("/wt"));
    }

    #[test]
    fn config_without_settings_gets_defaults() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("repos.json");
        fs::write(&file, r#"{"repos":[{"path":"/code/app"}]}"#).unwrap();

        let config = Config::load(&file).unwrap();

        assert_eq!(config.repos.len(), 1);
        assert_eq!(config.settings, Settings::default());
    }

    #[test]
    fn corrupt_file_is_a_config_error() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("repos.json");
        fs::write(&file, "{not json").unwrap();
        assert!(matches!(Config::load(&file), Err(Error::Config(_))));
    }
}
