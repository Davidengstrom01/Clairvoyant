//! Tauri command handlers. Keep these thin: real logic lives in modules the
//! integration tests can call without a running app.

use std::path::PathBuf;
use std::sync::Mutex;

use tauri::State;

use crate::error::Result;
use crate::git;
use crate::overview::{self, WorktreeSummary};
use crate::registry::{RegisteredRepo, Registry};

pub struct AppState {
    registry_file: PathBuf,
    registry: Mutex<Registry>,
}

impl AppState {
    pub fn new(registry_file: PathBuf, registry: Registry) -> Self {
        Self {
            registry_file,
            registry: Mutex::new(registry),
        }
    }
}

#[tauri::command]
pub fn list_repos(state: State<'_, AppState>) -> Vec<RegisteredRepo> {
    state.registry.lock().unwrap().repos.clone()
}

/// Accepts any folder inside a repo and registers the repo's main worktree.
#[tauri::command]
pub fn add_repo(state: State<'_, AppState>, path: PathBuf) -> Result<RegisteredRepo> {
    let repo = RegisteredRepo::new(git::main_worktree(&path)?);
    let mut registry = state.registry.lock().unwrap();
    if registry.add(repo.clone()) {
        registry.save(&state.registry_file)?;
    }
    Ok(repo)
}

#[tauri::command]
pub fn remove_repo(state: State<'_, AppState>, path: PathBuf) -> Result<()> {
    let mut registry = state.registry.lock().unwrap();
    if registry.remove(&path) {
        registry.save(&state.registry_file)?;
    }
    Ok(())
}

#[tauri::command]
pub async fn repo_overview(path: PathBuf) -> Result<Vec<WorktreeSummary>> {
    tauri::async_runtime::spawn_blocking(move || overview::repo_overview(&path))
        .await
        .expect("repo_overview task panicked")
}
