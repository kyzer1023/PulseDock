use std::collections::{BTreeSet, HashMap};

use chrono::{DateTime, Datelike, Duration, Local, NaiveDate, TimeZone, Utc};

use crate::models::{
    ProviderId, ProviderSnapshot, ProviderStatus, QuotaDisplayMode, QuotaMeter,
    SectionAvailability, TopLabelType, UsageRangePresetId, UsageWindow,
};

#[derive(Debug, Clone, Default)]
pub struct LabelAggregate {
    pub estimated_cost: f64,
    pub total_tokens: i64,
}

#[derive(Debug, Clone)]
pub struct CostSnapshot {
    pub usage_window: UsageWindow,
    pub input_tokens: i64,
    pub cache_write_tokens: i64,
    pub cached_input_tokens: i64,
    pub output_tokens: i64,
    pub reasoning_tokens: i64,
    pub total_tokens: i64,
    pub estimated_cost: f64,
    pub top_label: Option<String>,
    pub top_label_type: TopLabelType,
    pub activity_count: i64,
    pub warnings: Vec<String>,
    pub detail_message: Option<String>,
    pub provenance: Vec<String>,
    pub cost_status: SectionAvailability,
    pub cost_status_message: Option<String>,
    pub cost_last_refreshed_at: Option<String>,
    pub has_data: bool,
    pub refresh_failed: bool,
}

#[derive(Debug, Clone)]
pub struct QuotaSnapshot {
    pub quota_status: SectionAvailability,
    pub quota_status_message: Option<String>,
    pub quota_last_refreshed_at: Option<String>,
    pub quota_meters: Vec<QuotaMeter>,
    pub warnings: Vec<String>,
    pub has_data: bool,
    pub refresh_failed: bool,
}

#[derive(Debug, Clone)]
pub struct DateKeyWindow {
    pub usage_window: UsageWindow,
    pub since_date: NaiveDate,
    pub until_date: NaiveDate,
    pub codex_since: String,
    pub codex_until: String,
    pub cursor_since: String,
    pub cursor_until: String,
}

pub fn create_date_key_window(
    now: DateTime<Utc>,
    range: UsageRangePresetId,
    earliest_available_at: Option<DateTime<Utc>>,
) -> DateKeyWindow {
    let now_local = now.with_timezone(&Local);
    let until_date = now_local.date_naive();
    let mut since_date = earliest_available_at
        .map(|value| value.with_timezone(&Local).date_naive())
        .unwrap_or(until_date);

    if let Some(trailing_days) = trailing_days(range) {
        since_date = until_date - Duration::days((trailing_days - 1) as i64);
    }

    let since_local = Local
        .with_ymd_and_hms(
            since_date.year(),
            since_date.month(),
            since_date.day(),
            0,
            0,
            0,
        )
        .single()
        .unwrap_or(now_local);

    DateKeyWindow {
        usage_window: UsageWindow {
            label: window_label(range).to_string(),
            since: since_local
                .with_timezone(&Utc)
                .to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
            until: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
        },
        since_date,
        until_date,
        codex_since: since_date.format("%Y-%m-%d").to_string(),
        codex_until: until_date.format("%Y-%m-%d").to_string(),
        cursor_since: since_date.format("%Y%m%d").to_string(),
        cursor_until: until_date.format("%Y%m%d").to_string(),
    }
}

pub fn usage_range_covers(
    cached_range: UsageRangePresetId,
    requested_range: UsageRangePresetId,
) -> bool {
    usage_range_order(cached_range) >= usage_range_order(requested_range)
}

pub fn empty_cost_snapshot(
    usage_window: UsageWindow,
    status_message: &str,
    detail_message: Option<String>,
    provenance: Vec<String>,
    cost_last_refreshed_at: Option<String>,
    stale: bool,
    refresh_failed: bool,
) -> CostSnapshot {
    CostSnapshot {
        usage_window,
        input_tokens: 0,
        cache_write_tokens: 0,
        cached_input_tokens: 0,
        output_tokens: 0,
        reasoning_tokens: 0,
        total_tokens: 0,
        estimated_cost: 0.0,
        top_label: None,
        top_label_type: TopLabelType::Model,
        activity_count: 0,
        warnings: Vec::new(),
        detail_message,
        provenance,
        cost_status: if stale {
            SectionAvailability::Stale
        } else {
            SectionAvailability::Unsupported
        },
        cost_status_message: Some(status_message.to_string()),
        cost_last_refreshed_at,
        has_data: false,
        refresh_failed,
    }
}

pub fn stale_cost_from_previous(
    previous_snapshot: &ProviderSnapshot,
    warning: Option<String>,
    usage_window: UsageWindow,
    provenance: Vec<String>,
    status_message: &str,
) -> CostSnapshot {
    CostSnapshot {
        usage_window,
        input_tokens: previous_snapshot.input_tokens,
        cache_write_tokens: previous_snapshot.cache_write_tokens,
        cached_input_tokens: previous_snapshot.cached_input_tokens,
        output_tokens: previous_snapshot.output_tokens,
        reasoning_tokens: previous_snapshot.reasoning_tokens,
        total_tokens: previous_snapshot.total_tokens,
        estimated_cost: previous_snapshot.estimated_cost,
        top_label: previous_snapshot.top_label.clone(),
        top_label_type: previous_snapshot.top_label_type,
        activity_count: previous_snapshot.activity_count,
        warnings: warning.into_iter().collect(),
        detail_message: previous_snapshot.detail_message.clone(),
        provenance,
        cost_status: SectionAvailability::Stale,
        cost_status_message: Some(status_message.to_string()),
        cost_last_refreshed_at: previous_snapshot.cost_last_refreshed_at.clone(),
        has_data: true,
        refresh_failed: true,
    }
}

pub fn unsupported_quota(
    message: &str,
    previous_snapshot: Option<&ProviderSnapshot>,
) -> QuotaSnapshot {
    QuotaSnapshot {
        quota_status: SectionAvailability::Unsupported,
        quota_status_message: Some(message.to_string()),
        quota_last_refreshed_at: previous_snapshot
            .and_then(|snapshot| snapshot.quota_last_refreshed_at.clone()),
        quota_meters: Vec::new(),
        warnings: Vec::new(),
        has_data: false,
        refresh_failed: false,
    }
}

pub fn stale_or_unsupported_quota(
    previous_snapshot: Option<&ProviderSnapshot>,
    warning: &str,
) -> QuotaSnapshot {
    if let Some(previous_snapshot) = previous_snapshot {
        if !previous_snapshot.quota_meters.is_empty() {
            return QuotaSnapshot {
                quota_status: SectionAvailability::Stale,
                quota_status_message: Some(
                    "Quota could not be refreshed. Showing last known values.".to_string(),
                ),
                quota_last_refreshed_at: previous_snapshot.quota_last_refreshed_at.clone(),
                quota_meters: mark_quota_meters_stale(&previous_snapshot.quota_meters),
                warnings: vec![warning.to_string()],
                has_data: true,
                refresh_failed: true,
            };
        }
    }

    QuotaSnapshot {
        quota_status: SectionAvailability::Unsupported,
        quota_status_message: Some(warning.to_string()),
        quota_last_refreshed_at: previous_snapshot
            .and_then(|snapshot| snapshot.quota_last_refreshed_at.clone()),
        quota_meters: Vec::new(),
        warnings: Vec::new(),
        has_data: false,
        refresh_failed: true,
    }
}

pub fn mark_quota_meters_stale(meters: &[QuotaMeter]) -> Vec<QuotaMeter> {
    meters
        .iter()
        .cloned()
        .map(|mut meter| {
            meter.availability = SectionAvailability::Stale;
            meter
        })
        .collect()
}

pub fn build_provider_snapshot(
    id: ProviderId,
    display_name: &str,
    activity_label: &str,
    quota_provenance_label: &str,
    now: DateTime<Utc>,
    previous_snapshot: Option<&ProviderSnapshot>,
    cost_snapshot: CostSnapshot,
    quota_snapshot: QuotaSnapshot,
) -> ProviderSnapshot {
    let mut warnings = BTreeSet::new();
    for warning in &cost_snapshot.warnings {
        warnings.insert(warning.clone());
    }
    for warning in &quota_snapshot.warnings {
        warnings.insert(warning.clone());
    }

    let warnings = warnings.into_iter().collect::<Vec<_>>();
    let has_any_data = cost_snapshot.has_data || quota_snapshot.has_data;
    let has_stale_data = quota_snapshot.quota_status == SectionAvailability::Stale
        || cost_snapshot.cost_status == SectionAvailability::Stale;
    let has_refresh_failure = cost_snapshot.refresh_failed || quota_snapshot.refresh_failed;
    let status = if !has_any_data && has_refresh_failure {
        ProviderStatus::Error
    } else if has_stale_data {
        ProviderStatus::Stale
    } else if has_refresh_failure || !warnings.is_empty() {
        ProviderStatus::Warning
    } else if !has_any_data {
        ProviderStatus::Empty
    } else {
        ProviderStatus::Fresh
    };

    let now_iso = now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true);
    let mut provenance = BTreeSet::new();
    for item in &cost_snapshot.provenance {
        provenance.insert(item.clone());
    }
    provenance.insert(quota_provenance_label.to_string());

    ProviderSnapshot {
        id,
        display_name: display_name.to_string(),
        status,
        usage_window: cost_snapshot.usage_window.clone(),
        input_tokens: cost_snapshot.input_tokens,
        cache_write_tokens: cost_snapshot.cache_write_tokens,
        cached_input_tokens: cost_snapshot.cached_input_tokens,
        output_tokens: cost_snapshot.output_tokens,
        reasoning_tokens: cost_snapshot.reasoning_tokens,
        total_tokens: cost_snapshot.total_tokens,
        estimated_cost: cost_snapshot.estimated_cost,
        top_label: cost_snapshot.top_label.clone(),
        top_label_type: cost_snapshot.top_label_type,
        activity_count: cost_snapshot.activity_count,
        activity_label: activity_label.to_string(),
        warnings,
        last_refreshed_at: Some(now_iso.clone()),
        stale_since: if status == ProviderStatus::Stale {
            previous_snapshot
                .and_then(|snapshot| snapshot.stale_since.clone())
                .or_else(|| Some(now_iso))
        } else {
            None
        },
        provenance: provenance.into_iter().collect(),
        detail_message: if has_any_data {
            quota_snapshot
                .quota_status_message
                .clone()
                .or(cost_snapshot.cost_status_message.clone())
        } else {
            cost_snapshot
                .detail_message
                .clone()
                .or(quota_snapshot.quota_status_message.clone())
        },
        quota_status: quota_snapshot.quota_status,
        quota_status_message: quota_snapshot.quota_status_message.clone(),
        quota_last_refreshed_at: quota_snapshot.quota_last_refreshed_at.clone(),
        cost_status: cost_snapshot.cost_status,
        cost_status_message: cost_snapshot.cost_status_message.clone(),
        cost_last_refreshed_at: cost_snapshot.cost_last_refreshed_at.clone(),
        quota_meters: quota_snapshot.quota_meters.clone(),
    }
}

pub fn merge_label_totals(
    target: &mut HashMap<String, LabelAggregate>,
    source: &HashMap<String, LabelAggregate>,
) {
    for (label, aggregate) in source {
        let entry = target.entry(label.clone()).or_default();
        entry.estimated_cost += aggregate.estimated_cost;
        entry.total_tokens += aggregate.total_tokens;
    }
}

pub fn top_label(source: &HashMap<String, LabelAggregate>) -> Option<String> {
    source
        .iter()
        .max_by(|left, right| {
            left.1
                .estimated_cost
                .partial_cmp(&right.1.estimated_cost)
                .unwrap_or(std::cmp::Ordering::Equal)
                .then(left.1.total_tokens.cmp(&right.1.total_tokens))
        })
        .map(|(label, _)| label.clone())
}

pub fn percent_meter(
    id: &str,
    label: &str,
    used: f64,
    reset_at: Option<String>,
    period_seconds: Option<i64>,
    source_label: &str,
    display_mode: Option<QuotaDisplayMode>,
) -> QuotaMeter {
    QuotaMeter {
        id: id.to_string(),
        label: label.to_string(),
        kind: "percent".to_string(),
        used,
        limit: Some(100.0),
        display_mode,
        currency_code: None,
        unit_label: None,
        reset_at,
        period_seconds,
        availability: SectionAvailability::Available,
        source_label: Some(source_label.to_string()),
    }
}

fn trailing_days(range: UsageRangePresetId) -> Option<i64> {
    match range {
        UsageRangePresetId::Today => Some(1),
        UsageRangePresetId::Week => Some(7),
        UsageRangePresetId::Month => Some(30),
        UsageRangePresetId::All => None,
    }
}

fn window_label(range: UsageRangePresetId) -> &'static str {
    match range {
        UsageRangePresetId::Today => "Today",
        UsageRangePresetId::Week => "Last 7 days",
        UsageRangePresetId::Month => "Last 30 days",
        UsageRangePresetId::All => "All time",
    }
}

fn usage_range_order(range: UsageRangePresetId) -> i32 {
    match range {
        UsageRangePresetId::Today => 0,
        UsageRangePresetId::Week => 1,
        UsageRangePresetId::Month => 2,
        UsageRangePresetId::All => 3,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn usage_window_builds_expected_labels() {
        let now = Utc
            .with_ymd_and_hms(2026, 3, 25, 18, 0, 0)
            .single()
            .unwrap();
        assert_eq!(
            create_date_key_window(now, UsageRangePresetId::Today, None)
                .usage_window
                .label,
            "Today"
        );
        assert_eq!(
            create_date_key_window(now, UsageRangePresetId::Week, None)
                .usage_window
                .label,
            "Last 7 days"
        );
        assert_eq!(
            create_date_key_window(now, UsageRangePresetId::Month, None)
                .usage_window
                .label,
            "Last 30 days"
        );
        assert_eq!(
            create_date_key_window(now, UsageRangePresetId::All, None)
                .usage_window
                .label,
            "All time"
        );
    }

    #[test]
    fn usage_range_coverage_matches_expected_order() {
        assert!(usage_range_covers(
            UsageRangePresetId::Week,
            UsageRangePresetId::Today
        ));
        assert!(!usage_range_covers(
            UsageRangePresetId::Week,
            UsageRangePresetId::Month
        ));
        assert!(usage_range_covers(
            UsageRangePresetId::All,
            UsageRangePresetId::Today
        ));
    }

    fn make_previous_snapshot(status: ProviderStatus, stale_since: Option<&str>) -> ProviderSnapshot {
        ProviderSnapshot {
            id: ProviderId::Cursor,
            display_name: "Cursor".to_string(),
            status,
            usage_window: UsageWindow {
                label: "Last 7 days".to_string(),
                since: "2026-03-19T00:00:00.000Z".to_string(),
                until: "2026-03-25T12:00:00.000Z".to_string(),
            },
            input_tokens: 100,
            cache_write_tokens: 20,
            cached_input_tokens: 30,
            output_tokens: 40,
            reasoning_tokens: 0,
            total_tokens: 190,
            estimated_cost: 1.5,
            top_label: Some("OpenAI".to_string()),
            top_label_type: TopLabelType::Provider,
            activity_count: 2,
            activity_label: "Active days".to_string(),
            warnings: Vec::new(),
            last_refreshed_at: Some("2026-03-25T12:00:00.000Z".to_string()),
            stale_since: stale_since.map(ToString::to_string),
            provenance: vec!["Cursor usage export".to_string()],
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

    fn make_cost_snapshot() -> CostSnapshot {
        CostSnapshot {
            usage_window: UsageWindow {
                label: "Last 7 days".to_string(),
                since: "2026-03-19T00:00:00.000Z".to_string(),
                until: "2026-03-25T12:00:00.000Z".to_string(),
            },
            input_tokens: 100,
            cache_write_tokens: 20,
            cached_input_tokens: 30,
            output_tokens: 40,
            reasoning_tokens: 0,
            total_tokens: 190,
            estimated_cost: 1.5,
            top_label: Some("OpenAI".to_string()),
            top_label_type: TopLabelType::Provider,
            activity_count: 2,
            warnings: Vec::new(),
            detail_message: None,
            provenance: vec!["Cursor usage export".to_string()],
            cost_status: SectionAvailability::Available,
            cost_status_message: None,
            cost_last_refreshed_at: Some("2026-03-25T12:00:00.000Z".to_string()),
            has_data: true,
            refresh_failed: false,
        }
    }

    fn make_quota_snapshot() -> QuotaSnapshot {
        QuotaSnapshot {
            quota_status: SectionAvailability::Available,
            quota_status_message: Some("Cursor live quota".to_string()),
            quota_last_refreshed_at: Some("2026-03-25T12:00:00.000Z".to_string()),
            quota_meters: Vec::new(),
            warnings: Vec::new(),
            has_data: true,
            refresh_failed: false,
        }
    }

    #[test]
    fn build_provider_snapshot_returns_error_for_hard_failures_without_data() {
        let now = Utc
            .with_ymd_and_hms(2026, 3, 25, 12, 0, 0)
            .single()
            .unwrap();
        let cost_snapshot = empty_cost_snapshot(
            UsageWindow {
                label: "Last 7 days".to_string(),
                since: "2026-03-19T00:00:00.000Z".to_string(),
                until: "2026-03-25T12:00:00.000Z".to_string(),
            },
            "Cursor token-cost export is unavailable.",
            Some("Cursor export request failed with HTTP 500.".to_string()),
            vec!["Cursor usage export".to_string()],
            None,
            false,
            true,
        );
        let quota_snapshot = unsupported_quota(
            "Cursor live quota requires an active, unexpired local Cursor session.",
            None,
        );

        let snapshot = build_provider_snapshot(
            ProviderId::Cursor,
            "Cursor",
            "Active days",
            "Cursor live quota",
            now,
            None,
            cost_snapshot,
            quota_snapshot,
        );

        assert_eq!(snapshot.status, ProviderStatus::Error);
        assert!(snapshot.stale_since.is_none());
    }

    #[test]
    fn build_provider_snapshot_distinguishes_stale_from_warning_and_preserves_stale_since() {
        let now = Utc
            .with_ymd_and_hms(2026, 3, 25, 12, 30, 0)
            .single()
            .unwrap();
        let previous = make_previous_snapshot(
            ProviderStatus::Stale,
            Some("2026-03-24T10:00:00.000Z"),
        );
        let cost_snapshot = stale_cost_from_previous(
            &previous,
            Some("Cursor export request failed with HTTP 500.".to_string()),
            previous.usage_window.clone(),
            vec!["Cursor usage export".to_string()],
            "Cursor cost data could not be refreshed. Showing last known values.",
        );
        let quota_snapshot = make_quota_snapshot();

        let snapshot = build_provider_snapshot(
            ProviderId::Cursor,
            "Cursor",
            "Active days",
            "Cursor live quota",
            now,
            Some(&previous),
            cost_snapshot,
            quota_snapshot,
        );

        assert_eq!(snapshot.status, ProviderStatus::Stale);
        assert_eq!(
            snapshot.stale_since.as_deref(),
            Some("2026-03-24T10:00:00.000Z")
        );
    }

    #[test]
    fn build_provider_snapshot_marks_partial_refresh_failures_as_warning() {
        let now = Utc
            .with_ymd_and_hms(2026, 3, 25, 12, 0, 0)
            .single()
            .unwrap();
        let cost_snapshot = make_cost_snapshot();
        let quota_snapshot = QuotaSnapshot {
            quota_status: SectionAvailability::Unsupported,
            quota_status_message: Some("Cursor quota request failed with HTTP 500.".to_string()),
            quota_last_refreshed_at: None,
            quota_meters: Vec::new(),
            warnings: Vec::new(),
            has_data: false,
            refresh_failed: true,
        };

        let snapshot = build_provider_snapshot(
            ProviderId::Cursor,
            "Cursor",
            "Active days",
            "Cursor live quota",
            now,
            None,
            cost_snapshot,
            quota_snapshot,
        );

        assert_eq!(snapshot.status, ProviderStatus::Warning);
        assert!(snapshot.stale_since.is_none());
    }
}
