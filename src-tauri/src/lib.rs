pub mod commands;
pub mod error;
pub mod git;
pub mod overview;
pub mod registry;

use tauri::Manager;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .setup(|app| {
            let registry_file = app.path().app_config_dir()?.join("repos.json");
            let registry = registry::Registry::load(&registry_file)?;
            app.manage(commands::AppState::new(registry_file, registry));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_repos,
            commands::add_repo,
            commands::remove_repo,
            commands::repo_overview,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
