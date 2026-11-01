pub mod commands;
pub mod config;
pub mod error;
pub mod git;
pub mod overview;
pub mod platform;
pub mod scan;
pub mod watch;

use tauri::{Emitter, Manager};

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            // Must happen before the first git call so hooks see the user's PATH.
            let login_path = platform::login_shell_path();
            if let Some(path) = &login_path {
                git::init_env(vec![("PATH".into(), path.clone())]);
            }

            let config_file = app.path().app_config_dir()?.join("repos.json");
            let config = config::Config::load(&config_file)?;

            let handle = app.handle().clone();
            let watcher = watch::Watcher::start(move |changes| {
                let repo_wide = changes.iter().any(|c| c.worktree.is_none());
                let _ = handle.emit("repo-changed", &changes);
                // Repo-wide changes can add or remove worktrees.
                if repo_wide {
                    commands::resync_watches(&handle);
                }
            })?;
            app.manage(commands::AppState::new(
                config_file,
                config,
                watcher,
                login_path,
            ));

            let handle = app.handle().clone();
            std::thread::spawn(move || commands::resync_watches(&handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_repos,
            commands::add_repo,
            commands::remove_repo,
            commands::set_worktree_root,
            commands::scan_folder,
            commands::get_settings,
            commands::set_settings,
            commands::repo_overview,
            commands::worktree_summary,
            commands::fetch,
            commands::file_diff,
            commands::worktree_diffs,
            commands::stage,
            commands::unstage,
            commands::discard,
            commands::apply_hunk,
            commands::list_trash,
            commands::restore_trash,
            commands::stash_list,
            commands::stash_push,
            commands::stash_pop,
            commands::stash_apply,
            commands::head_is_published,
            commands::commit,
            commands::branches,
            commands::create_branch,
            commands::delete_branch,
            commands::switch_branch,
            commands::compare,
            commands::compare_diff,
            commands::compare_diffs,
            commands::suggest_worktree_path,
            commands::add_worktree,
            commands::remove_worktree,
            commands::open_in_editor,
            commands::open_claude,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
