use std::collections::HashMap;

use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Utc};
use tauri::{AppHandle, Emitter};
use tauri_plugin_shell::ShellExt;

use crate::models::{
  CollectRequest,
  CollectResponse,
  DashboardNotice,
  DashboardSnapshot,
  DashboardSummary,
  LoadingState,
  ProviderCollectResult,
  ProviderId,
  ProviderSnapshot,
  ProviderStatus,
  SectionAvailability,
  TopLabelType,
  UsageRangePresetId,
  UsageWindow,
};
use crate::usage_range::{DEFAULT_USAGE_RANGE_PRESET_ID, create_usage_date_window};

pub const DASHBOARD_CHANGED_EVENT: &str = "pulsedock:dashboard-changed";

struct ProviderDefinition {
  id: ProviderId,
  display_name: &'static str,
}

const PROVIDERS: [ProviderDefinition; 2] = [
  ProviderDefinition {
    id: ProviderId::Codex,
    display_name: "Codex",
  },
  ProviderDefinition {
    id: ProviderId::Cursor,
    display_name: "Cursor",
  },
];

pub struct ProviderOrchestrator {
  next_request_id: u64,
  selected_usage_range: UsageRangePresetId,
  snapshot: DashboardSnapshot,
  snapshot_cache: HashMap<UsageRangePresetId, DashboardSnapshot>,
}

impl ProviderOrchestrator {
  pub fn new() -> Self {
    Self {
      next_request_id: 1,
      selected_usage_range: DEFAULT_USAGE_RANGE_PRESET_ID,
      snapshot: create_initial_snapshot(PROVIDERS.len(), DEFAULT_USAGE_RANGE_PRESET_ID),
      snapshot_cache: HashMap::new(),
    }
  }

  pub fn get_snapshot(&self) -> DashboardSnapshot {
    self.snapshot.clone()
  }

  pub async fn refresh(&mut self, app: &AppHandle) -> Result<DashboardSnapshot, String> {
    self.snapshot_cache.clear();
    self
      .collect_and_publish(app, self.selected_usage_range, true)
      .await
  }

  pub async fn set_usage_range(
    &mut self,
    app: &AppHandle,
    range: UsageRangePresetId,
  ) -> Result<DashboardSnapshot, String> {
    if range == self.selected_usage_range && self.snapshot.last_refreshed_at.is_some() {
      return Ok(self.snapshot.clone());
    }

    if let Some(snapshot) = self.snapshot_cache.get(&range) {
      self.selected_usage_range = range;
      self.snapshot = DashboardSnapshot {
        loading_state: LoadingState::Idle,
        selected_usage_range: range,
        ..snapshot.clone()
      };
      emit_snapshot(app, &self.snapshot);
      return Ok(self.snapshot.clone());
    }

    self.collect_and_publish(app, range, false).await
  }

  async fn collect_and_publish(
    &mut self,
    app: &AppHandle,
    selected_usage_range: UsageRangePresetId,
    force_refresh: bool,
  ) -> Result<DashboardSnapshot, String> {
    let current = self.snapshot.clone();
    let loading_state = if current.last_refreshed_at.is_none() {
      LoadingState::Loading
    } else if force_refresh {
      LoadingState::Refreshing
    } else {
      LoadingState::Switching
    };

    self.snapshot = DashboardSnapshot {
      loading_state,
      selected_usage_range,
      ..current.clone()
    };
    emit_snapshot(app, &self.snapshot);

    let now = Utc::now();
    let usage_window = create_usage_window(now, selected_usage_range, &current.providers);
    let previous_by_id = current
      .providers
      .iter()
      .cloned()
      .map(|provider| (provider.id, provider))
      .collect::<HashMap<_, _>>();

    let results = self
      .collect_provider_results(
        app,
        now,
        current.providers.clone(),
        selected_usage_range,
        force_refresh,
      )
      .await?;
    let result_by_id = results
      .into_iter()
      .map(|result| (result.id, result))
      .collect::<HashMap<_, _>>();

    let providers = PROVIDERS
      .iter()
      .map(|provider| match result_by_id.get(&provider.id) {
        Some(result) if result.ok => result.snapshot.clone().unwrap_or_else(|| {
          build_provider_error_snapshot(
            provider.id,
            provider.display_name,
            previous_by_id.get(&provider.id),
            &usage_window,
            "Collector returned an empty snapshot.".to_string(),
          )
        }),
        Some(result) => build_provider_error_snapshot(
          provider.id,
          provider.display_name,
          previous_by_id.get(&provider.id),
          &usage_window,
          result
            .error_message
            .clone()
            .unwrap_or_else(|| format!("{} data could not be loaded.", provider.display_name)),
        ),
        None => build_provider_error_snapshot(
          provider.id,
          provider.display_name,
          previous_by_id.get(&provider.id),
          &usage_window,
          "Collector returned provider data out of order.".to_string(),
        ),
      })
      .collect::<Vec<_>>();

    self.selected_usage_range = selected_usage_range;
    self.snapshot = build_snapshot(
      providers,
      LoadingState::Idle,
      Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
      selected_usage_range,
    );
    self
      .snapshot_cache
      .insert(self.selected_usage_range, self.snapshot.clone());
    emit_snapshot(app, &self.snapshot);

    Ok(self.snapshot.clone())
  }

  async fn collect_provider_results(
    &mut self,
    app: &AppHandle,
    now: DateTime<Utc>,
    previous_snapshots: Vec<ProviderSnapshot>,
    selected_usage_range: UsageRangePresetId,
    force_refresh: bool,
  ) -> Result<Vec<ProviderCollectResult>, String> {
    let request_id = self.next_request_id;
    self.next_request_id += 1;

    let request = CollectRequest {
      id: request_id,
      now_iso: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
      previous_snapshots,
      selected_usage_range,
      force_refresh,
    };
    let encoded_request = URL_SAFE_NO_PAD
      .encode(serde_json::to_vec(&request).map_err(|error| error.to_string())?);

    let output = app
      .shell()
      .sidecar("pulsedock-collector")
      .map_err(|error| error.to_string())?
      .arg(encoded_request)
      .output()
      .await
      .map_err(|error| error.to_string())?;

    if !output.status.success() {
      let stderr = String::from_utf8_lossy(&output.stderr).trim().to_string();
      let message = if stderr.is_empty() {
        "PulseDock collector sidecar failed.".to_string()
      } else {
        stderr
      };
      return Err(message);
    }

    let response: CollectResponse =
      serde_json::from_slice(&output.stdout).map_err(|error| error.to_string())?;

    if response.id != request_id {
      return Err("Collector returned a mismatched response id.".to_string());
    }

    Ok(response.results)
  }
}

fn emit_snapshot(app: &AppHandle, snapshot: &DashboardSnapshot) {
  let _ = app.emit_to("main", DASHBOARD_CHANGED_EVENT, snapshot.clone());
}

fn create_initial_snapshot(
  provider_count: usize,
  selected_usage_range: UsageRangePresetId,
) -> DashboardSnapshot {
  let now = Utc::now();

  DashboardSnapshot {
    summary: create_empty_summary(now, provider_count, selected_usage_range),
    providers: Vec::new(),
    notices: Vec::new(),
    last_refreshed_at: None,
    provenance: Vec::new(),
    loading_state: LoadingState::Loading,
    selected_usage_range,
  }
}

fn create_empty_summary(
  now: DateTime<Utc>,
  provider_count: usize,
  selected_usage_range: UsageRangePresetId,
) -> DashboardSummary {
  DashboardSummary {
    estimated_cost: 0.0,
    total_tokens: 0,
    provider_count,
    loaded_provider_count: 0,
    usage_window: create_usage_window(now, selected_usage_range, &[]),
  }
}

fn create_usage_window(
  now: DateTime<Utc>,
  range: UsageRangePresetId,
  providers: &[ProviderSnapshot],
) -> UsageWindow {
  let earliest_loaded_date = if range == UsageRangePresetId::All {
    providers
      .iter()
      .filter(|provider| provider.is_loaded())
      .filter_map(|provider| DateTime::parse_from_rfc3339(&provider.usage_window.since).ok())
      .map(|value| value.with_timezone(&Utc))
      .min()
  } else {
    None
  };

  create_usage_date_window(now, range, earliest_loaded_date).usage_window
}

fn build_snapshot(
  providers: Vec<ProviderSnapshot>,
  loading_state: LoadingState,
  refreshed_at: Option<String>,
  selected_usage_range: UsageRangePresetId,
) -> DashboardSnapshot {
  let loaded_providers = providers
    .iter()
    .filter(|provider| provider.is_loaded())
    .collect::<Vec<_>>();
  let now = refreshed_at
    .as_deref()
    .and_then(|value| DateTime::parse_from_rfc3339(value).ok())
    .map(|value| value.with_timezone(&Utc))
    .unwrap_or_else(Utc::now);

  DashboardSnapshot {
    summary: DashboardSummary {
      estimated_cost: loaded_providers
        .iter()
        .map(|provider| provider.estimated_cost)
        .sum(),
      total_tokens: loaded_providers
        .iter()
        .map(|provider| provider.total_tokens)
        .sum(),
      provider_count: providers.len(),
      loaded_provider_count: loaded_providers.len(),
      usage_window: create_usage_window(now, selected_usage_range, &providers),
    },
    notices: build_notices(&providers),
    last_refreshed_at: refreshed_at,
    provenance: unique_values(
      providers
        .iter()
        .flat_map(|provider| provider.provenance.iter().cloned())
        .collect(),
    ),
    providers,
    loading_state,
    selected_usage_range,
  }
}

fn build_notices(providers: &[ProviderSnapshot]) -> Vec<DashboardNotice> {
  let errors = providers
    .iter()
    .filter(|provider| provider.status == ProviderStatus::Error)
    .count();
  let stale = providers
    .iter()
    .filter(|provider| provider.status == ProviderStatus::Stale)
    .count();
  let mut notices = Vec::new();

  if errors > 0 {
    notices.push(DashboardNotice {
      level: "error".to_string(),
      message: format!("{errors} of {} providers failed to refresh.", providers.len()),
    });
  }

  if stale > 0 {
    notices.push(DashboardNotice {
      level: "warning".to_string(),
      message: if stale == 1 {
        "1 provider is showing stale data.".to_string()
      } else {
        format!("{stale} providers are showing stale data.")
      },
    });
  }

  notices
}

fn unique_values(values: Vec<String>) -> Vec<String> {
  let mut unique = Vec::new();

  for value in values {
    if !unique.contains(&value) {
      unique.push(value);
    }
  }

  unique
}

fn build_provider_error_snapshot(
  id: ProviderId,
  display_name: &str,
  previous_snapshot: Option<&ProviderSnapshot>,
  usage_window: &UsageWindow,
  detail_message: String,
) -> ProviderSnapshot {
  if let Some(previous_snapshot) = previous_snapshot.cloned() {
    return ProviderSnapshot {
      status: ProviderStatus::Stale,
      stale_since: previous_snapshot
        .stale_since
        .or_else(|| Some(Utc::now().to_rfc3339_opts(chrono::SecondsFormat::Millis, true))),
      detail_message: Some(detail_message),
      warnings: unique_values({
        let mut warnings = previous_snapshot.warnings.clone();
        warnings.push("Showing last known provider data.".to_string());
        warnings
      }),
      quota_status: if previous_snapshot.quota_status == SectionAvailability::Available {
        SectionAvailability::Stale
      } else {
        previous_snapshot.quota_status
      },
      cost_status: if previous_snapshot.cost_status == SectionAvailability::Available {
        SectionAvailability::Stale
      } else {
        previous_snapshot.cost_status
      },
      ..previous_snapshot
    };
  }

  ProviderSnapshot {
    id,
    display_name: display_name.to_string(),
    status: ProviderStatus::Error,
    usage_window: usage_window.clone(),
    input_tokens: 0,
    cache_write_tokens: 0,
    cached_input_tokens: 0,
    output_tokens: 0,
    reasoning_tokens: 0,
    total_tokens: 0,
    estimated_cost: 0.0,
    top_label: None,
    top_label_type: TopLabelType::Source,
    activity_count: 0,
    activity_label: if id == ProviderId::Codex {
      "Sessions".to_string()
    } else {
      "Active days".to_string()
    },
    warnings: Vec::new(),
    last_refreshed_at: None,
    stale_since: None,
    provenance: Vec::new(),
    detail_message: Some(detail_message),
    quota_status: SectionAvailability::Unsupported,
    quota_status_message: None,
    quota_last_refreshed_at: None,
    cost_status: SectionAvailability::Unsupported,
    cost_status_message: None,
    cost_last_refreshed_at: None,
    quota_meters: Vec::new(),
  }
}
