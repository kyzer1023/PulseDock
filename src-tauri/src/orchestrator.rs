use std::collections::HashMap;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use reqwest::blocking::Client;
use tokio::sync::{Mutex, Notify, RwLock};

use tauri::{AppHandle, Emitter};

use crate::models::{
    DashboardNotice, DashboardSnapshot, DashboardSummary, LoadingState, ProviderId,
    ProviderSnapshot, ProviderStatus, SectionAvailability, TopLabelType, UsageRangePresetId,
    UsageWindow,
};
use crate::provider_codex::{CodexRuntime, collect_provider as collect_codex_provider};
use crate::provider_cursor::{CursorRuntime, collect_provider as collect_cursor_provider};
use crate::usage_range::{DEFAULT_USAGE_RANGE_PRESET_ID, create_usage_date_window};

pub const DASHBOARD_CHANGED_EVENT: &str = "pulsedock:dashboard-changed";

enum CollectionContinuation {
    Publish(DashboardSnapshot),
    UseCached(DashboardSnapshot),
    Retry(UsageRangePresetId),
}

struct RuntimeState {
    selected_usage_range: UsageRangePresetId,
    snapshot_cache: HashMap<UsageRangePresetId, DashboardSnapshot>,
    in_flight: Option<Arc<Notify>>,
    codex: CodexRuntime,
    cursor: CursorRuntime,
}

impl Default for RuntimeState {
    fn default() -> Self {
        Self {
            selected_usage_range: DEFAULT_USAGE_RANGE_PRESET_ID,
            snapshot_cache: HashMap::new(),
            in_flight: None,
            codex: CodexRuntime::default(),
            cursor: CursorRuntime::default(),
        }
    }
}

pub struct ProviderOrchestrator {
    client: Client,
    snapshot: Arc<RwLock<DashboardSnapshot>>,
    state: Arc<Mutex<RuntimeState>>,
}

impl ProviderOrchestrator {
    pub fn new() -> Self {
        let client = Client::builder()
            .connect_timeout(std::time::Duration::from_secs(5))
            .build()
            .expect("PulseDock HTTP client should initialize");
        Self {
            client,
            snapshot: Arc::new(RwLock::new(create_initial_snapshot(
                2,
                DEFAULT_USAGE_RANGE_PRESET_ID,
            ))),
            state: Arc::new(Mutex::new(RuntimeState {
                selected_usage_range: DEFAULT_USAGE_RANGE_PRESET_ID,
                ..RuntimeState::default()
            })),
        }
    }

    pub async fn get_snapshot(&self) -> DashboardSnapshot {
        self.snapshot.read().await.clone()
    }

    pub async fn refresh(&self, app: &AppHandle) -> Result<DashboardSnapshot, String> {
        self.run_collection(app, true).await
    }

    pub async fn set_usage_range(
        &self,
        app: &AppHandle,
        range: UsageRangePresetId,
    ) -> Result<DashboardSnapshot, String> {
        {
            let mut state = self.state.lock().await;
            state.selected_usage_range = range;

            if let Some(snapshot) = state.snapshot_cache.get(&range).cloned() {
                let snapshot = DashboardSnapshot {
                    loading_state: LoadingState::Idle,
                    selected_usage_range: range,
                    ..snapshot
                };
                *self.snapshot.write().await = snapshot.clone();
                emit_snapshot(app, &snapshot);
                return Ok(snapshot);
            }

            if state.in_flight.is_some() {
                let current = self.snapshot.read().await.clone();
                let snapshot = DashboardSnapshot {
                    loading_state: if current.last_refreshed_at.is_none() {
                        LoadingState::Loading
                    } else {
                        LoadingState::Switching
                    },
                    selected_usage_range: range,
                    ..current
                };
                *self.snapshot.write().await = snapshot.clone();
                emit_snapshot(app, &snapshot);
                return Ok(snapshot);
            }
        }

        self.run_collection(app, false).await
    }

    async fn run_collection(
        &self,
        app: &AppHandle,
        force_refresh: bool,
    ) -> Result<DashboardSnapshot, String> {
        let (notify, mut codex, mut cursor) = {
            let mut state = self.state.lock().await;
            if force_refresh {
                state.snapshot_cache.clear();
            }

            if let Some(notify) = state.in_flight.clone() {
                drop(state);
                notify.notified().await;
                return Ok(self.snapshot.read().await.clone());
            }

            let notify = Arc::new(Notify::new());
            state.in_flight = Some(notify.clone());
            let codex = std::mem::take(&mut state.codex);
            let cursor = std::mem::take(&mut state.cursor);
            (notify, codex, cursor)
        };

        let mut refresh_requested = force_refresh;
        let mut final_snapshot = None;
        let mut final_error = None;

        loop {
            let current = self.snapshot.read().await.clone();
            let (target_range, previous_by_id) = {
                let state = self.state.lock().await;
                let target_range = state.selected_usage_range;
                let previous_snapshot =
                    previous_snapshot_for_range(&current, &state.snapshot_cache, target_range);
                (
                    target_range,
                    previous_snapshot
                        .map(provider_map_from_snapshot)
                        .unwrap_or_default(),
                )
            };

            let loading_state = if current.last_refreshed_at.is_none() {
                LoadingState::Loading
            } else if refresh_requested {
                LoadingState::Refreshing
            } else {
                LoadingState::Switching
            };
            let loading_snapshot = DashboardSnapshot {
                loading_state,
                selected_usage_range: target_range,
                ..current.clone()
            };
            *self.snapshot.write().await = loading_snapshot.clone();
            emit_snapshot(app, &loading_snapshot);

            let collected = collect_target_range(
                self.client.clone(),
                codex,
                cursor,
                target_range,
                previous_by_id,
                refresh_requested,
            )
            .await;

            let (next_codex, next_cursor, providers, now) = match collected {
                Ok(collected) => collected,
                Err(error) => {
                    codex = CodexRuntime::default();
                    cursor = CursorRuntime::default();
                    final_error = Some(error);
                    break;
                }
            };
            codex = next_codex;
            cursor = next_cursor;

            let snapshot = build_snapshot(
                providers,
                LoadingState::Idle,
                Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
                target_range,
            );

            let continuation = {
                let mut state = self.state.lock().await;
                record_collection_result(&mut state, target_range, snapshot.clone())
            };

            match continuation {
                CollectionContinuation::Publish(snapshot)
                | CollectionContinuation::UseCached(snapshot) => {
                    final_snapshot = Some(snapshot);
                    break;
                }
                CollectionContinuation::Retry(next_range) => {
                    let current = self.snapshot.read().await.clone();
                    let switching_snapshot = DashboardSnapshot {
                        loading_state: if current.last_refreshed_at.is_none() {
                            LoadingState::Loading
                        } else {
                            LoadingState::Switching
                        },
                        selected_usage_range: next_range,
                        ..current
                    };
                    *self.snapshot.write().await = switching_snapshot.clone();
                    emit_snapshot(app, &switching_snapshot);
                    refresh_requested = false;
                }
            }
        }

        {
            let mut state = self.state.lock().await;
            state.codex = codex;
            state.cursor = cursor;
            state.in_flight = None;
        }
        notify.notify_waiters();

        if let Some(error) = final_error {
            return Err(error);
        }

        let snapshot = final_snapshot.expect("collection should produce a final snapshot");
        *self.snapshot.write().await = snapshot.clone();
        emit_snapshot(app, &snapshot);
        Ok(snapshot)
    }
}

fn emit_snapshot(app: &AppHandle, snapshot: &DashboardSnapshot) {
    let _ = app.emit_to("main", DASHBOARD_CHANGED_EVENT, snapshot.clone());
}

fn previous_snapshot_for_range(
    current: &DashboardSnapshot,
    cache: &HashMap<UsageRangePresetId, DashboardSnapshot>,
    target_range: UsageRangePresetId,
) -> Option<DashboardSnapshot> {
    cache
        .get(&target_range)
        .cloned()
        .or_else(|| (!current.providers.is_empty()).then_some(current.clone()))
}

fn provider_map_from_snapshot(
    snapshot: DashboardSnapshot,
) -> HashMap<ProviderId, ProviderSnapshot> {
    snapshot
        .providers
        .into_iter()
        .map(|provider| (provider.id, provider))
        .collect()
}

fn record_collection_result(
    state: &mut RuntimeState,
    target_range: UsageRangePresetId,
    snapshot: DashboardSnapshot,
) -> CollectionContinuation {
    state.snapshot_cache.insert(target_range, snapshot.clone());

    if state.selected_usage_range == target_range {
        return CollectionContinuation::Publish(snapshot);
    }

    if let Some(selected_snapshot) = state
        .snapshot_cache
        .get(&state.selected_usage_range)
        .cloned()
    {
        return CollectionContinuation::UseCached(selected_snapshot);
    }

    CollectionContinuation::Retry(state.selected_usage_range)
}

async fn collect_target_range(
    client: Client,
    codex: CodexRuntime,
    cursor: CursorRuntime,
    target_range: UsageRangePresetId,
    previous_by_id: HashMap<ProviderId, ProviderSnapshot>,
    force_refresh: bool,
) -> Result<
    (
        CodexRuntime,
        CursorRuntime,
        Vec<ProviderSnapshot>,
        DateTime<Utc>,
    ),
    String,
> {
    let now = Utc::now();
    let codex_previous = previous_by_id.get(&ProviderId::Codex).cloned();
    let cursor_previous = previous_by_id.get(&ProviderId::Cursor).cloned();

    let codex_client = client.clone();
    let codex_handle = tokio::task::spawn_blocking(move || {
        let mut codex = codex;
        let snapshot = collect_codex_provider(
            &mut codex,
            &codex_client,
            now,
            target_range,
            codex_previous.as_ref(),
            force_refresh,
            true,
        );
        (codex, snapshot)
    });

    let cursor_handle = tokio::task::spawn_blocking(move || {
        let mut cursor = cursor;
        let snapshot = collect_cursor_provider(
            &mut cursor,
            &client,
            now,
            target_range,
            cursor_previous.as_ref(),
            force_refresh,
            true,
        );
        (cursor, snapshot)
    });

    let (codex, codex_snapshot) = codex_handle.await.map_err(|error| error.to_string())?;
    let (cursor, cursor_snapshot) = cursor_handle.await.map_err(|error| error.to_string())?;

    Ok((codex, cursor, vec![codex_snapshot, cursor_snapshot], now))
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
    let warnings = providers
        .iter()
        .filter(|provider| provider.status == ProviderStatus::Warning)
        .count();
    let mut notices = Vec::new();

    if errors > 0 {
        notices.push(DashboardNotice {
            level: "error".to_string(),
            message: format!(
                "{errors} of {} providers failed to refresh.",
                providers.len()
            ),
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

    if warnings > 0 {
        notices.push(DashboardNotice {
            level: "warning".to_string(),
            message: if warnings == 1 {
                "1 provider reported warnings.".to_string()
            } else {
                format!("{warnings} providers reported warnings.")
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

#[cfg(test)]
mod tests {
    use super::*;
    use chrono::TimeZone;

    fn make_provider_snapshot(
        id: ProviderId,
        range: UsageRangePresetId,
        total_tokens: i64,
    ) -> ProviderSnapshot {
        ProviderSnapshot {
            id,
            display_name: match id {
                ProviderId::Codex => "Codex".to_string(),
                ProviderId::Cursor => "Cursor".to_string(),
            },
            status: ProviderStatus::Fresh,
            usage_window: create_usage_date_window(
                Utc.with_ymd_and_hms(2026, 3, 25, 12, 0, 0)
                    .single()
                    .unwrap(),
                range,
                None,
            )
            .usage_window,
            input_tokens: total_tokens,
            cache_write_tokens: 0,
            cached_input_tokens: 0,
            output_tokens: 0,
            reasoning_tokens: 0,
            total_tokens,
            estimated_cost: total_tokens as f64,
            top_label: None,
            top_label_type: TopLabelType::Source,
            activity_count: 1,
            activity_label: "Sessions".to_string(),
            warnings: Vec::new(),
            last_refreshed_at: Some("2026-03-25T12:00:00.000Z".to_string()),
            stale_since: None,
            provenance: Vec::new(),
            detail_message: None,
            quota_status: SectionAvailability::Available,
            quota_status_message: None,
            quota_last_refreshed_at: Some("2026-03-25T12:00:00.000Z".to_string()),
            cost_status: SectionAvailability::Available,
            cost_status_message: None,
            cost_last_refreshed_at: Some("2026-03-25T12:00:00.000Z".to_string()),
            quota_meters: Vec::new(),
        }
    }

    fn make_dashboard_snapshot(range: UsageRangePresetId, total_tokens: i64) -> DashboardSnapshot {
        let codex = make_provider_snapshot(ProviderId::Codex, range, total_tokens);
        let cursor = make_provider_snapshot(ProviderId::Cursor, range, total_tokens / 2);
        build_snapshot(
            vec![codex, cursor],
            LoadingState::Idle,
            Some("2026-03-25T12:00:00.000Z".to_string()),
            range,
        )
    }

    #[test]
    fn previous_snapshot_selection_prefers_matching_cached_range() {
        let current = make_dashboard_snapshot(UsageRangePresetId::Week, 100);
        let cached_month = make_dashboard_snapshot(UsageRangePresetId::Month, 900);
        let cache = HashMap::from([(UsageRangePresetId::Month, cached_month.clone())]);

        let selected = previous_snapshot_for_range(&current, &cache, UsageRangePresetId::Month)
            .expect("matching snapshot");

        assert_eq!(selected.selected_usage_range, UsageRangePresetId::Month);
        assert_eq!(
            selected.summary.total_tokens,
            cached_month.summary.total_tokens
        );
    }

    #[test]
    fn previous_snapshot_selection_falls_back_to_current_snapshot_for_uncached_switches() {
        let current = make_dashboard_snapshot(UsageRangePresetId::Week, 100);
        let cache = HashMap::new();

        let selected = previous_snapshot_for_range(&current, &cache, UsageRangePresetId::Month)
            .expect("current snapshot fallback");

        assert_eq!(selected.selected_usage_range, UsageRangePresetId::Week);
        assert_eq!(selected.summary.total_tokens, current.summary.total_tokens);
    }

    #[test]
    fn record_collection_result_retries_when_selected_range_changes_without_cache() {
        let mut state = RuntimeState {
            selected_usage_range: UsageRangePresetId::Month,
            ..RuntimeState::default()
        };
        let week_snapshot = make_dashboard_snapshot(UsageRangePresetId::Week, 100);

        let next = record_collection_result(&mut state, UsageRangePresetId::Week, week_snapshot);

        match next {
            CollectionContinuation::Retry(range) => {
                assert_eq!(range, UsageRangePresetId::Month);
            }
            _ => panic!("expected retry"),
        }
    }

    #[test]
    fn record_collection_result_uses_cached_selected_range_instead_of_overwriting_it() {
        let cached_month = make_dashboard_snapshot(UsageRangePresetId::Month, 900);
        let mut state = RuntimeState {
            selected_usage_range: UsageRangePresetId::Month,
            snapshot_cache: HashMap::from([(UsageRangePresetId::Month, cached_month.clone())]),
            ..RuntimeState::default()
        };
        let week_snapshot = make_dashboard_snapshot(UsageRangePresetId::Week, 100);

        let next = record_collection_result(&mut state, UsageRangePresetId::Week, week_snapshot);

        match next {
            CollectionContinuation::UseCached(snapshot) => {
                assert_eq!(snapshot.selected_usage_range, UsageRangePresetId::Month);
                assert_eq!(
                    snapshot.summary.total_tokens,
                    cached_month.summary.total_tokens
                );
            }
            _ => panic!("expected cached snapshot"),
        }
    }

    #[test]
    fn build_notices_does_not_label_generic_warnings_as_stale() {
        let provider = ProviderSnapshot {
            status: ProviderStatus::Warning,
            ..make_provider_snapshot(ProviderId::Codex, UsageRangePresetId::Week, 100)
        };

        let notices = build_notices(&[provider]);

        assert_eq!(notices.len(), 1);
        assert_eq!(notices[0].level, "warning");
        assert_eq!(notices[0].message, "1 provider reported warnings.");
    }

    #[test]
    fn build_notices_keeps_stale_and_warning_counts_separate() {
        let stale = ProviderSnapshot {
            status: ProviderStatus::Stale,
            ..make_provider_snapshot(ProviderId::Codex, UsageRangePresetId::Week, 100)
        };
        let warning = ProviderSnapshot {
            status: ProviderStatus::Warning,
            ..make_provider_snapshot(ProviderId::Cursor, UsageRangePresetId::Week, 50)
        };

        let notices = build_notices(&[stale, warning]);

        assert_eq!(notices.len(), 2);
        assert_eq!(notices[0].message, "1 provider is showing stale data.");
        assert_eq!(notices[1].message, "1 provider reported warnings.");
    }
}

fn _build_provider_error_snapshot(
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
            warnings: {
                let mut warnings = previous_snapshot.warnings.clone();
                warnings.push("Showing last known provider data.".to_string());
                unique_values(warnings)
            },
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
