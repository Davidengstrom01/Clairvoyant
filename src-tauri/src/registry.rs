//! The repos the user registered. This file is the only state Clairvoyant owns;
//! everything about the repos themselves is read from git.

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

#[derive(Debug, Default, PartialEq, Eq, Serialize, Deserialize)]
pub struct Registry {
    pub repos: Vec<RegisteredRepo>,
}

impl Registry {
    pub fn load(file: &Path) -> Result<Self> {
        match fs::read_to_string(file) {
            Ok(json) => serde_json::from_str(&json)
                .map_err(|e| Error::Config(format!("{}: {e}", file.display()))),
            Err(e) if e.kind() == ErrorKind::NotFound => Ok(Self::default()),
            Err(e) => Err(e.into()),
        }
    }

    /// Writes to a temp file and renames it so a crash never leaves a half-written registry.
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
            Registry::load(&dir.path().join("repos.json")).unwrap(),
            Registry::default()
        );
    }

    #[test]
    fn round_trips_through_disk() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("nested/repos.json");
        let mut registry = Registry::default();
        registry.add(RegisteredRepo::new("/code/app".into()));
        registry.add(RegisteredRepo {
            path: "/code/api".into(),
            worktree_root: Some("/wt/api".into()),
        });

        registry.save(&file).unwrap();

        assert_eq!(Registry::load(&file).unwrap(), registry);
    }

    #[test]
    fn add_and_remove_ignore_duplicates_and_unknowns() {
        let mut registry = Registry::default();
        assert!(registry.add(RegisteredRepo::new("/code/app".into())));
        assert!(!registry.add(RegisteredRepo::new("/code/app".into())));
        assert!(!registry.remove(Path::new("/code/other")));
        assert!(registry.remove(Path::new("/code/app")));
        assert!(registry.repos.is_empty());
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
    fn corrupt_file_is_a_config_error() {
        let dir = tempfile::tempdir().unwrap();
        let file = dir.path().join("repos.json");
        fs::write(&file, "{not json").unwrap();
        assert!(matches!(Registry::load(&file), Err(Error::Config(_))));
    }
}
