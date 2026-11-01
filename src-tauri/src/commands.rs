//! Tauri command handlers. Keep these thin: real logic lives in modules the
//! integration tests can call without a running app.
//!
//! Anything that runs git is `async` and moved to a blocking thread; Tauri runs
//! sync commands on the main thread, which would freeze the window.

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, Emitter, Manager, State};

use crate::config::{Config, RegisteredRepo, Settings};
use crate::error::{Error, Result};
use crate::git::{self, Branch, Comparison, DiffSource, FileDiff, HunkAction, Stash, TrashEntry};
use crate::overview::{self, RepoOverview, WorktreeSummary};
use crate::platform;
use crate::scan;
use crate::watch::{WatchedRepo, Watcher};

pub struct AppState {
    config_file: PathBuf,
    config: Mutex<Config>,
    watcher: Watcher,
    login_path: Option<String>,
}

impl AppState {
    pub fn new(
        config_file: PathBuf,
        config: Config,
        watcher: Watcher,
        login_path: Option<String>,
    ) -> Self {
        Self {
            config_file,
            config: Mutex::new(config),
            watcher,
            login_path,
        }
    }

    fn update_config(&self, change: impl FnOnce(&mut Config) -> bool) -> Result<()> {
        let mut config = self.config.lock().unwrap();
        if change(&mut config) {
            config.save(&self.config_file)?;
        }
        Ok(())
    }

    fn repo_paths(&self) -> Vec<PathBuf> {
        self.config
            .lock()
            .unwrap()
            .repos
            .iter()
            .map(|r| r.path.clone())
            .collect()
    }
}

async fn blocking<T: Send + 'static>(f: impl FnOnce() -> Result<T> + Send + 'static) -> Result<T> {
    tauri::async_runtime::spawn_blocking(f)
        .await
        .map_err(|e| Error::Io(std::io::Error::other(e.to_string())))?
}

/// Points the watcher at every worktree of every registered repo. Cheap to call
/// again: unchanged folders are left alone.
pub fn resync_watches(app: &AppHandle) {
    let state = app.state::<AppState>();
    let repos = state
        .repo_paths()
        .into_iter()
        .filter_map(|repo| {
            let worktrees = git::list_worktrees(&repo).ok()?;
            let (_, common_dir) = git::git_dirs(&repo).ok()?;
            Some(WatchedRepo {
                worktrees: worktrees
                    .into_iter()
                    .filter(|wt| wt.prunable.is_none())
                    .map(|wt| wt.path)
                    .collect(),
                repo,
                common_dir,
            })
        })
        .collect();
    state.watcher.set_repos(repos);
}

fn resync_in_background(app: &AppHandle) {
    let app = app.clone();
    std::thread::spawn(move || resync_watches(&app));
}

// --- repos and settings ---

#[tauri::command]
pub fn list_repos(state: State<'_, AppState>) -> Vec<RegisteredRepo> {
    state.config.lock().unwrap().repos.clone()
}

/// Accepts any folder inside a repo and registers the repo's main worktree.
#[tauri::command]
pub async fn add_repo(app: AppHandle, path: PathBuf) -> Result<RegisteredRepo> {
    let repo = RegisteredRepo::new(blocking(move || git::main_worktree(&path)).await?);
    app.state::<AppState>()
        .update_config(|config| config.add(repo.clone()))?;
    resync_in_background(&app);
    Ok(repo)
}

#[tauri::command]
pub fn remove_repo(app: AppHandle, path: PathBuf) -> Result<()> {
    app.state::<AppState>()
        .update_config(|config| config.remove(&path))?;
    resync_in_background(&app);
    Ok(())
}

/// `None` resets to the default `<repo-parent>/<repo>.worktrees`.
#[tauri::command]
pub fn set_worktree_root(
    state: State<'_, AppState>,
    repo: PathBuf,
    root: Option<PathBuf>,
) -> Result<()> {
    state.update_config(
        |config| match config.repos.iter_mut().find(|r| r.path == repo) {
            Some(entry) => {
                entry.worktree_root = root;
                true
            }
            None => false,
        },
    )
}

/// Repos found under `root` that aren't registered yet.
#[tauri::command]
pub async fn scan_folder(state: State<'_, AppState>, root: PathBuf) -> Result<Vec<PathBuf>> {
    let registered = state.repo_paths();
    blocking(move || {
        Ok(scan::scan(&root, 4)
            .into_iter()
            .filter(|p| !registered.contains(p))
            .collect())
    })
    .await
}

#[tauri::command]
pub fn get_settings(state: State<'_, AppState>) -> Settings {
    state.config.lock().unwrap().settings.clone()
}

#[tauri::command]
pub fn set_settings(state: State<'_, AppState>, settings: Settings) -> Result<()> {
    state.update_config(|config| {
        config.settings = settings;
        true
    })
}

// --- dashboard ---

#[tauri::command]
pub async fn repo_overview(path: PathBuf) -> Result<RepoOverview> {
    blocking(move || overview::repo_overview(&path)).await
}

#[tauri::command]
pub async fn worktree_summary(repo: PathBuf, path: PathBuf) -> Result<WorktreeSummary> {
    blocking(move || overview::worktree_summary(&repo, &path)).await
}

#[tauri::command]
pub async fn fetch(repo: PathBuf) -> Result<()> {
    blocking(move || git::fetch(&repo)).await
}

// --- pending changes ---

#[tauri::command]
pub async fn file_diff(
    worktree: PathBuf,
    path: String,
    orig_path: Option<String>,
    source: DiffSource,
) -> Result<FileDiff> {
    blocking(move || git::file_diff(&worktree, &path, orig_path.as_deref(), source)).await
}

fn strs(paths: &[String]) -> Vec<&str> {
    paths.iter().map(String::as_str).collect()
}

#[tauri::command]
pub async fn stage(worktree: PathBuf, paths: Vec<String>) -> Result<()> {
    blocking(move || git::stage(&worktree, &strs(&paths))).await
}

#[tauri::command]
pub async fn unstage(worktree: PathBuf, paths: Vec<String>) -> Result<()> {
    blocking(move || git::unstage(&worktree, &strs(&paths))).await
}

/// Returns the trash id that undoes the discard.
#[tauri::command]
pub async fn discard(
    worktree: PathBuf,
    tracked: Vec<String>,
    untracked: Vec<String>,
) -> Result<String> {
    blocking(move || git::discard(&worktree, &strs(&tracked), &strs(&untracked))).await
}

#[tauri::command]
pub async fn apply_hunk(
    worktree: PathBuf,
    path: String,
    hunk_header: String,
    action: HunkAction,
) -> Result<Option<String>> {
    blocking(move || git::apply_hunk(&worktree, &path, &hunk_header, action)).await
}

/// Trash entries for one worktree; old entries are pruned on the way.
#[tauri::command]
pub async fn list_trash(repo: PathBuf, worktree: PathBuf) -> Result<Vec<TrashEntry>> {
    blocking(move || {
        git::prune_trash(&repo)?;
        Ok(git::list_trash(&repo)?
            .into_iter()
            .filter(|e| e.worktree == worktree)
            .collect())
    })
    .await
}

#[tauri::command]
pub async fn restore_trash(worktree: PathBuf, id: String) -> Result<()> {
    blocking(move || git::restore_trash(&worktree, &id)).await
}

// --- stash and commit ---

#[tauri::command]
pub async fn stash_list(repo: PathBuf) -> Result<Vec<Stash>> {
    blocking(move || git::stash_list(&repo)).await
}

#[tauri::command]
pub async fn stash_push(
    worktree: PathBuf,
    message: Option<String>,
    include_untracked: bool,
) -> Result<()> {
    blocking(move || git::stash_push(&worktree, message.as_deref(), include_untracked)).await
}

#[tauri::command]
pub async fn stash_pop(worktree: PathBuf, index: u32) -> Result<()> {
    blocking(move || git::stash_pop(&worktree, index)).await
}

#[tauri::command]
pub async fn stash_apply(worktree: PathBuf, index: u32) -> Result<()> {
    blocking(move || git::stash_apply(&worktree, index)).await
}

#[tauri::command]
pub async fn head_is_published(worktree: PathBuf) -> Result<bool> {
    blocking(move || git::head_is_published(&worktree)).await
}

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct CommitOutput {
    worktree: PathBuf,
    line: String,
}

/// Streams hook and git output as `commit-output` events while it runs.
#[tauri::command]
pub async fn commit(
    app: AppHandle,
    worktree: PathBuf,
    message: String,
    amend: bool,
) -> Result<String> {
    blocking(move || {
        let emit = |line: &str| {
            let _ = app.emit(
                "commit-output",
                CommitOutput {
                    worktree: worktree.clone(),
                    line: line.to_owned(),
                },
            );
        };
        git::commit(&worktree, &message, amend, &emit)
    })
    .await
}

// --- branches ---

#[tauri::command]
pub async fn branches(repo: PathBuf) -> Result<Vec<Branch>> {
    blocking(move || git::branches(&repo)).await
}

#[tauri::command]
pub async fn create_branch(repo: PathBuf, name: String, start: Option<String>) -> Result<()> {
    blocking(move || git::create_branch(&repo, &name, start.as_deref())).await
}

#[tauri::command]
pub async fn delete_branch(repo: PathBuf, name: String, force: bool) -> Result<()> {
    blocking(move || git::delete_branch(&repo, &name, force)).await
}

#[tauri::command]
pub async fn switch_branch(worktree: PathBuf, name: String, remote: bool) -> Result<()> {
    blocking(move || git::switch_branch(&worktree, &name, remote)).await
}

#[tauri::command]
pub async fn compare(repo: PathBuf, base: String, head: String) -> Result<Comparison> {
    blocking(move || git::compare(&repo, &base, &head)).await
}

#[tauri::command]
pub async fn compare_diff(
    repo: PathBuf,
    base: String,
    head: String,
    path: String,
) -> Result<FileDiff> {
    blocking(move || git::compare_diff(&repo, &base, &head, &path)).await
}

// --- worktrees ---

/// `<worktree root>/<branch with / replaced by ->`.
#[tauri::command]
pub fn suggest_worktree_path(
    state: State<'_, AppState>,
    repo: PathBuf,
    branch: String,
) -> Result<PathBuf> {
    let config = state.config.lock().unwrap();
    let entry = config
        .repos
        .iter()
        .find(|r| r.path == repo)
        .ok_or_else(|| Error::Refused(format!("{} is not registered", repo.display())))?;
    Ok(entry
        .effective_worktree_root()
        .join(branch.replace('/', "-")))
}

#[tauri::command]
pub async fn add_worktree(
    app: AppHandle,
    repo: PathBuf,
    path: PathBuf,
    branch: String,
    new_branch: bool,
    start: Option<String>,
) -> Result<()> {
    blocking(move || git::add_worktree(&repo, &path, &branch, new_branch, start.as_deref()))
        .await?;
    resync_in_background(&app);
    Ok(())
}

#[tauri::command]
pub async fn remove_worktree(
    app: AppHandle,
    repo: PathBuf,
    path: PathBuf,
    force: bool,
) -> Result<()> {
    blocking(move || git::remove_worktree(&repo, &path, force)).await?;
    resync_in_background(&app);
    Ok(())
}

// --- jump-outs ---

fn run_setting(state: &AppState, path: &Path, pick: impl Fn(&Settings) -> String) -> Result<()> {
    let template = pick(&state.config.lock().unwrap().settings);
    platform::run_template(&template, path, state.login_path.as_deref())
}

#[tauri::command]
pub async fn open_in_editor(app: AppHandle, path: PathBuf) -> Result<()> {
    blocking(move || {
        run_setting(&app.state::<AppState>(), &path, |s| {
            s.editor_command.clone()
        })
    })
    .await
}

#[tauri::command]
pub async fn open_claude(app: AppHandle, path: PathBuf) -> Result<()> {
    blocking(move || {
        run_setting(&app.state::<AppState>(), &path, |s| {
            s.claude_command.clone()
        })
    })
    .await
}
