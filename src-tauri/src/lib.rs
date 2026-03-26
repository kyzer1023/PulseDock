mod external_url;
mod models;
mod orchestrator;
mod usage_range;

use std::fs;
use std::path::Path;

use models::{DashboardSnapshot, LoadingState, UsageRangePresetId};
use orchestrator::{DASHBOARD_CHANGED_EVENT, ProviderOrchestrator};
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{AppHandle, Emitter, Manager, State, WebviewWindow, WindowEvent};
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_positioner::{Position, WindowExt};
use tokio::sync::Mutex;

struct AppState {
  smoke_mode: bool,
  runtime: Mutex<AppRuntime>,
}

impl AppState {
  fn new() -> Self {
    let smoke_output_path = std::env::var("PULSEDOCK_SMOKE_TEST_OUTPUT")
      .ok()
      .map(|value| value.trim().to_string())
      .filter(|value| !value.is_empty());

    let smoke_mode = smoke_output_path.is_some();
    let runtime = if let Some(output_path) = smoke_output_path {
      AppRuntime::Smoke(SmokeRuntime {
        output_path,
        snapshot: create_smoke_snapshot(),
      })
    } else {
      AppRuntime::Normal(ProviderOrchestrator::new())
    };

    Self {
      smoke_mode,
      runtime: Mutex::new(runtime),
    }
  }
}

enum AppRuntime {
  Normal(ProviderOrchestrator),
  Smoke(SmokeRuntime),
}

impl AppRuntime {
  fn get_snapshot(&self) -> DashboardSnapshot {
    match self {
      Self::Normal(runtime) => runtime.get_snapshot(),
      Self::Smoke(runtime) => runtime.snapshot.clone(),
    }
  }

  async fn refresh(&mut self, app: &AppHandle) -> Result<DashboardSnapshot, String> {
    match self {
      Self::Normal(runtime) => runtime.refresh(app).await,
      Self::Smoke(runtime) => {
        let snapshot = runtime.snapshot.clone();
        let _ = app.emit_to("main", DASHBOARD_CHANGED_EVENT, snapshot.clone());
        Ok(snapshot)
      }
    }
  }

  async fn set_usage_range(
    &mut self,
    app: &AppHandle,
    range: UsageRangePresetId,
  ) -> Result<DashboardSnapshot, String> {
    match self {
      Self::Normal(runtime) => runtime.set_usage_range(app, range).await,
      Self::Smoke(runtime) => {
        runtime.snapshot.selected_usage_range = range;
        let snapshot = runtime.snapshot.clone();
        let _ = app.emit_to("main", DASHBOARD_CHANGED_EVENT, snapshot.clone());
        Ok(snapshot)
      }
    }
  }

  fn smoke_output_path(&self) -> Option<&str> {
    match self {
      Self::Smoke(runtime) => Some(runtime.output_path.as_str()),
      Self::Normal(_) => None,
    }
  }
}

struct SmokeRuntime {
  output_path: String,
  snapshot: DashboardSnapshot,
}

fn create_smoke_snapshot() -> DashboardSnapshot {
  DashboardSnapshot {
    summary: models::DashboardSummary {
      estimated_cost: 0.0,
      total_tokens: 0,
      provider_count: 0,
      loaded_provider_count: 0,
      usage_window: models::UsageWindow {
        label: "Last 7 days".to_string(),
        since: "2026-03-19T00:00:00.000Z".to_string(),
        until: "2026-03-25T00:00:00.000Z".to_string(),
      },
    },
    providers: Vec::new(),
    notices: Vec::new(),
    last_refreshed_at: Some("2026-03-25T00:00:00.000Z".to_string()),
    provenance: vec!["Packaged smoke test".to_string()],
    loading_state: LoadingState::Idle,
    selected_usage_range: usage_range::DEFAULT_USAGE_RANGE_PRESET_ID,
  }
}

fn configure_main_window(window: &WebviewWindow) {
  let app = window.app_handle().clone();
  window.on_window_event(move |event| match event {
    WindowEvent::Focused(false) => {
      let _ = hide_main_window_inner(&app);
    }
    WindowEvent::CloseRequested { api, .. } => {
      api.prevent_close();
      let _ = hide_main_window_inner(&app);
    }
    _ => {}
  });
}

fn show_main_window(app: &AppHandle) -> Result<(), String> {
  let Some(window) = app.get_webview_window("main") else {
    return Err("PulseDock main window was not found.".to_string());
  };

  let _ = window.as_ref().window().move_window(Position::BottomRight);
  let _ = window.unminimize();
  window.show().map_err(|error| error.to_string())?;
  window.set_focus().map_err(|error| error.to_string())?;
  Ok(())
}

fn hide_main_window_inner(app: &AppHandle) -> Result<(), String> {
  let Some(window) = app.get_webview_window("main") else {
    return Ok(());
  };

  if window.is_visible().map_err(|error| error.to_string())? {
    window.hide().map_err(|error| error.to_string())?;
  }

  Ok(())
}

fn toggle_main_window(app: &AppHandle) -> Result<(), String> {
  let Some(window) = app.get_webview_window("main") else {
    return Err("PulseDock main window was not found.".to_string());
  };

  if window.is_visible().map_err(|error| error.to_string())? {
    window.hide().map_err(|error| error.to_string())?;
    return Ok(());
  }

  show_main_window(app)
}

fn spawn_refresh(app: AppHandle) {
  tauri::async_runtime::spawn(async move {
    let Some(state) = app.try_state::<AppState>() else {
      return;
    };

    let mut runtime = state.runtime.lock().await;
    if let Err(error) = runtime.refresh(&app).await {
      eprintln!("refresh failed: {error}");
    }
  });
}

fn write_json_file(path: &str, payload: &serde_json::Value) -> Result<(), String> {
  if let Some(parent) = Path::new(path).parent() {
    fs::create_dir_all(parent).map_err(|error| error.to_string())?;
  }

  let bytes = serde_json::to_vec_pretty(payload).map_err(|error| error.to_string())?;
  fs::write(path, bytes).map_err(|error| error.to_string())
}

fn build_tray(app: &AppHandle) -> tauri::Result<()> {
  let refresh = MenuItem::with_id(app, "refresh", "Refresh", true, None::<&str>)?;
  let separator = PredefinedMenuItem::separator(app)?;
  let quit = MenuItem::with_id(app, "quit", "Quit PulseDock", true, None::<&str>)?;
  let menu = Menu::with_items(app, &[&refresh, &separator, &quit])?;

  let mut builder = TrayIconBuilder::new()
    .menu(&menu)
    .show_menu_on_left_click(false)
    .tooltip("PulseDock")
    .on_menu_event(|app, event| match event.id.as_ref() {
      "refresh" => spawn_refresh(app.clone()),
      "quit" => app.exit(0),
      _ => {}
    })
    .on_tray_icon_event(|tray, event| {
      tauri_plugin_positioner::on_tray_event(tray.app_handle(), &event);

      if let TrayIconEvent::Click {
        button: MouseButton::Left,
        button_state: MouseButtonState::Up,
        ..
      } = event
      {
        let _ = toggle_main_window(tray.app_handle());
      }
    });

  if let Some(icon) = app.default_window_icon() {
    builder = builder.icon(icon.clone());
  }

  builder.build(app)?;
  Ok(())
}

#[tauri::command]
async fn get_dashboard(state: State<'_, AppState>) -> Result<DashboardSnapshot, String> {
  Ok(state.runtime.lock().await.get_snapshot())
}

#[tauri::command]
async fn refresh_dashboard(
  app: AppHandle,
  state: State<'_, AppState>,
) -> Result<DashboardSnapshot, String> {
  state.runtime.lock().await.refresh(&app).await
}

#[tauri::command]
async fn set_dashboard_usage_range(
  app: AppHandle,
  state: State<'_, AppState>,
  range: String,
) -> Result<DashboardSnapshot, String> {
  let parsed_range = UsageRangePresetId::parse(&range)?;
  state
    .runtime
    .lock()
    .await
    .set_usage_range(&app, parsed_range)
    .await
}

#[tauri::command]
async fn open_external(app: AppHandle, url: String) -> Result<(), String> {
  let allowed = external_url::assert_allowed_external_url(&url)?;
  app
    .opener()
    .open_url(allowed, None::<&str>)
    .map_err(|error| error.to_string())
}

#[tauri::command]
fn quit_app(app: AppHandle) {
  app.exit(0);
}

#[tauri::command]
fn hide_main_window(app: AppHandle) -> Result<(), String> {
  hide_main_window_inner(&app)
}

#[tauri::command]
fn is_smoke_mode(state: State<'_, AppState>) -> bool {
  state.smoke_mode
}

#[tauri::command]
async fn write_smoke_result(
  app: AppHandle,
  state: State<'_, AppState>,
  payload: serde_json::Value,
) -> Result<(), String> {
  let runtime = state.runtime.lock().await;
  let Some(path) = runtime.smoke_output_path() else {
    return Err("Smoke mode is not active.".to_string());
  };

  write_json_file(path, &payload)?;
  app.exit(0);
  Ok(())
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
  tauri::Builder::default()
    .plugin(tauri_plugin_opener::init())
    .plugin(tauri_plugin_shell::init())
    .setup(|app| {
      app.manage(AppState::new());
      app.handle().plugin(tauri_plugin_positioner::init())?;

      if let Some(window) = app.get_webview_window("main") {
        configure_main_window(&window);
      }
      let smoke_mode = app.state::<AppState>().smoke_mode;

      if !smoke_mode {
        build_tray(app.handle())?;
        spawn_refresh(app.handle().clone());
      }

      Ok(())
    })
    .invoke_handler(tauri::generate_handler![
      get_dashboard,
      refresh_dashboard,
      set_dashboard_usage_range,
      open_external,
      quit_app,
      hide_main_window,
      is_smoke_mode,
      write_smoke_result
    ])
    .run(tauri::generate_context!())
    .expect("error while running PulseDock");
}
