use std::collections::{BTreeMap, BTreeSet, HashMap};
use std::fs::{self, File};
use std::io::{BufRead, BufReader};
use std::path::{Path, PathBuf};
use std::time::{Duration as StdDuration, Instant, SystemTime};

use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, AUTHORIZATION, USER_AGENT};
use serde_json::Value;

use crate::models::{
    ProviderId, ProviderSnapshot, QuotaDisplayMode, SectionAvailability, TopLabelType,
    UsageRangePresetId,
};
use crate::provider_shared::{
    CostSnapshot, LabelAggregate, QuotaSnapshot, build_provider_snapshot, create_date_key_window,
    empty_cost_snapshot, merge_label_totals, percent_meter, stale_or_unsupported_quota, top_label,
    unsupported_quota,
};

const SCAN_BUDGET: StdDuration = StdDuration::from_secs(5);
const CODEX_LOCAL_PROVENANCE: &str = "Codex local sessions";
const DEFAULT_FALLBACK_MODEL: &str = "gpt-5-codex";

#[derive(Debug, Clone, Default)]
struct UsageSnapshot {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    total_tokens: i64,
}

#[derive(Debug, Clone)]
struct UsageInfo {
    direct: Option<UsageSnapshot>,
    cumulative: Option<UsageSnapshot>,
    model: Option<String>,
}

#[derive(Debug, Clone)]
struct CodexEvent {
    local_day_key: String,
    model: String,
    source: String,
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    total_tokens: i64,
    estimated_cost: f64,
    warnings: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct DayAggregate {
    input_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    reasoning_tokens: i64,
    total_tokens: i64,
    estimated_cost: f64,
    by_model: HashMap<String, LabelAggregate>,
    by_source: HashMap<String, LabelAggregate>,
    warnings: BTreeSet<String>,
}

impl DayAggregate {
    fn add_event(&mut self, event: &CodexEvent) {
        self.input_tokens += event.input_tokens;
        self.cached_input_tokens += event.cached_input_tokens;
        self.output_tokens += event.output_tokens;
        self.reasoning_tokens += event.reasoning_tokens;
        self.total_tokens += event.total_tokens;
        self.estimated_cost += event.estimated_cost;

        let model_entry = self.by_model.entry(event.model.clone()).or_default();
        model_entry.estimated_cost += event.estimated_cost;
        model_entry.total_tokens += event.total_tokens;

        let source_entry = self.by_source.entry(event.source.clone()).or_default();
        source_entry.estimated_cost += event.estimated_cost;
        source_entry.total_tokens += event.total_tokens;

        for warning in &event.warnings {
            self.warnings.insert(warning.clone());
        }
    }
}

#[derive(Debug, Clone, Default)]
struct SessionAggregate {
    modified_at: Option<SystemTime>,
    file_size: u64,
    warnings: BTreeSet<String>,
    days: BTreeMap<String, DayAggregate>,
}

#[derive(Debug, Clone, Default)]
pub struct CodexRuntime {
    files: HashMap<String, SessionAggregate>,
    discovery_warnings: BTreeSet<String>,
    quota_snapshot: Option<QuotaSnapshot>,
}

pub fn collect_provider(
    runtime: &mut CodexRuntime,
    client: &Client,
    now: DateTime<Utc>,
    range: UsageRangePresetId,
    previous_snapshot: Option<&ProviderSnapshot>,
    force_refresh: bool,
    refresh_quota: bool,
) -> ProviderSnapshot {
    let cost_snapshot = runtime.collect_cost(now, range, previous_snapshot, force_refresh);
    let quota_snapshot = if refresh_quota || runtime.quota_snapshot.is_none() {
        let next = fetch_quota(client, now, previous_snapshot);
        runtime.quota_snapshot = Some(next.clone());
        next
    } else {
        runtime.quota_snapshot.clone().unwrap_or_else(|| {
            unsupported_quota(
                "Codex live quota requires a local Codex OAuth session.",
                previous_snapshot,
            )
        })
    };

    build_provider_snapshot(
        ProviderId::Codex,
        "Codex",
        "Sessions",
        "Codex live quota",
        now,
        previous_snapshot,
        cost_snapshot,
        quota_snapshot,
    )
}

impl CodexRuntime {
    fn collect_cost(
        &mut self,
        now: DateTime<Utc>,
        range: UsageRangePresetId,
        previous_snapshot: Option<&ProviderSnapshot>,
        force_refresh: bool,
    ) -> CostSnapshot {
        if let Err(error) = self.refresh_from_disk(force_refresh) {
            return empty_cost_snapshot(
                create_date_key_window(now, range, self.earliest_date()).usage_window,
                "Local Codex session data is unavailable.",
                Some(error),
                codex_provenance(),
                previous_snapshot.and_then(|snapshot| snapshot.cost_last_refreshed_at.clone()),
                false,
                true,
            );
        }

        let window = create_date_key_window(now, range, self.earliest_date());
        if self.files.is_empty() {
            return empty_cost_snapshot(
                window.usage_window,
                "Local Codex session data is unavailable.",
                Some("No Codex session data was found under the local Codex home.".to_string()),
                codex_provenance(),
                previous_snapshot.and_then(|snapshot| snapshot.cost_last_refreshed_at.clone()),
                false,
                false,
            );
        }

        let mut totals = DayAggregate::default();
        let mut session_count = 0_i64;
        let mut warnings = self.discovery_warnings.clone();

        for aggregate in self.files.values() {
            let mut session_in_range = false;
            for (day_key, day) in &aggregate.days {
                if day_key < &window.codex_since || day_key > &window.codex_until {
                    continue;
                }

                session_in_range = true;
                totals.input_tokens += day.input_tokens;
                totals.cached_input_tokens += day.cached_input_tokens;
                totals.output_tokens += day.output_tokens;
                totals.reasoning_tokens += day.reasoning_tokens;
                totals.total_tokens += day.total_tokens;
                totals.estimated_cost += day.estimated_cost;
                merge_label_totals(&mut totals.by_model, &day.by_model);
                merge_label_totals(&mut totals.by_source, &day.by_source);
                for warning in &day.warnings {
                    warnings.insert(warning.clone());
                }
            }

            if session_in_range {
                session_count += 1;
            }

            for warning in &aggregate.warnings {
                warnings.insert(warning.clone());
            }
        }

        let warnings = humanize_warnings(warnings);
        if totals.total_tokens == 0 && totals.estimated_cost == 0.0 {
            let detail_message = format!(
                "No measurable Codex activity was found for {}.",
                window.usage_window.label.to_lowercase()
            );
            let mut snapshot = empty_cost_snapshot(
                window.usage_window,
                if warnings.is_empty() {
                    "No recent Codex cost data found."
                } else {
                    "Codex local cost data is incomplete."
                },
                Some(detail_message),
                codex_provenance(),
                previous_snapshot
                    .and_then(|snapshot| snapshot.cost_last_refreshed_at.clone())
                    .or_else(|| Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true))),
                !warnings.is_empty(),
                false,
            );
            snapshot.warnings = warnings;
            return snapshot;
        }

        let top_model = top_label(&totals.by_model);
        let top_source = top_label(&totals.by_source);
        CostSnapshot {
            usage_window: window.usage_window,
            input_tokens: totals.input_tokens,
            cache_write_tokens: 0,
            cached_input_tokens: totals.cached_input_tokens,
            output_tokens: totals.output_tokens,
            reasoning_tokens: totals.reasoning_tokens,
            total_tokens: totals.total_tokens,
            estimated_cost: totals.estimated_cost,
            top_label: top_model.clone().or(top_source.clone()),
            top_label_type: if top_model.is_some() {
                TopLabelType::Model
            } else {
                TopLabelType::Source
            },
            activity_count: session_count,
            warnings,
            detail_message: None,
            provenance: codex_provenance(),
            cost_status: SectionAvailability::Available,
            cost_status_message: None,
            cost_last_refreshed_at: Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            has_data: true,
            refresh_failed: false,
        }
    }

    fn earliest_date(&self) -> Option<DateTime<Utc>> {
        self.files
            .values()
            .flat_map(|entry| entry.days.keys())
            .min()
            .and_then(|value| parse_local_day_key(value))
    }

    fn refresh_from_disk(&mut self, force_refresh: bool) -> Result<(), String> {
        self.refresh_from_disk_with_budget(force_refresh, SCAN_BUDGET)
    }

    fn refresh_from_disk_with_budget(
        &mut self,
        force_refresh: bool,
        scan_budget: StdDuration,
    ) -> Result<(), String> {
        let sessions_root = resolve_codex_home().join("sessions");
        if !sessions_root.exists() {
            self.files.clear();
            self.discovery_warnings.clear();
            return Ok(());
        }

        let start = Instant::now();
        let deadline = start + scan_budget;
        let mut discovered = HashMap::new();
        let mut stack = vec![sessions_root.clone()];
        let mut discovery_warnings = BTreeSet::new();
        let mut discovery_complete = true;

        while let Some(current) = stack.pop() {
            if Instant::now() >= deadline {
                discovery_warnings.insert("scan-timeout".to_string());
                discovery_complete = false;
                break;
            }

            let entries = match fs::read_dir(&current) {
                Ok(entries) => entries,
                Err(_) => {
                    discovery_warnings.insert("scan-read-failed".to_string());
                    discovery_complete = false;
                    continue;
                }
            };

            for entry in entries.flatten() {
                let path = entry.path();
                let Ok(file_type) = entry.file_type() else {
                    discovery_warnings.insert("scan-read-failed".to_string());
                    discovery_complete = false;
                    continue;
                };

                if file_type.is_dir() {
                    stack.push(path);
                    continue;
                }
                if !file_type.is_file() {
                    continue;
                }

                let Some(name) = path.file_name().and_then(|value| value.to_str()) else {
                    continue;
                };
                if !name.to_ascii_lowercase().starts_with("rollout-")
                    || !name.to_ascii_lowercase().ends_with(".jsonl")
                {
                    continue;
                }

                let relative = path
                    .strip_prefix(&sessions_root)
                    .unwrap_or(&path)
                    .to_string_lossy()
                    .replace('\\', "/");
                discovered.insert(relative, path);
            }
        }

        reconcile_discovered_files(&mut self.files, &discovered, discovery_complete);
        for (relative, path) in discovered {
            if Instant::now() >= deadline {
                discovery_warnings.insert("scan-timeout".to_string());
                break;
            }

            let metadata = match fs::metadata(&path) {
                Ok(metadata) => metadata,
                Err(_) => {
                    discovery_warnings.insert("scan-read-failed".to_string());
                    continue;
                }
            };
            let modified_at = metadata.modified().ok();
            let file_size = metadata.len();
            let should_rescan = force_refresh
                || self
                    .files
                    .get(&relative)
                    .map(|existing| {
                        existing.modified_at != modified_at || existing.file_size != file_size
                    })
                    .unwrap_or(true);
            if !should_rescan {
                continue;
            }

            match scan_session_file(&path, modified_at, file_size, deadline) {
                Ok(aggregate) => {
                    self.files.insert(relative, aggregate);
                }
                Err(error) => {
                    discovery_warnings.insert(error);
                }
            }
        }

        self.discovery_warnings = discovery_warnings;
        Ok(())
    }
}

fn reconcile_discovered_files(
    files: &mut HashMap<String, SessionAggregate>,
    discovered: &HashMap<String, PathBuf>,
    discovery_complete: bool,
) {
    if discovery_complete {
        files.retain(|key, _| discovered.contains_key(key));
    }
}

fn codex_provenance() -> Vec<String> {
    if std::env::var("CODEX_HOME")
        .ok()
        .map(|value| !value.trim().is_empty())
        .unwrap_or(false)
    {
        vec![format!("{CODEX_LOCAL_PROVENANCE} (custom CODEX_HOME)")]
    } else {
        vec![CODEX_LOCAL_PROVENANCE.to_string()]
    }
}

fn resolve_codex_home() -> PathBuf {
    std::env::var_os("CODEX_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(PathBuf::from)
                .unwrap_or_else(|| PathBuf::from("."))
                .join(".codex")
        })
}

fn scan_session_file(
    path: &Path,
    modified_at: Option<SystemTime>,
    file_size: u64,
    deadline: Instant,
) -> Result<SessionAggregate, String> {
    let file = File::open(path).map_err(|_| "scan-read-failed".to_string())?;
    let reader = BufReader::new(file);
    let mut warnings = BTreeSet::new();
    let mut previous_cumulative: Option<UsageSnapshot> = None;
    let mut current_model_hint: Option<String> = None;
    let mut source = "unknown".to_string();
    let mut days = BTreeMap::new();

    for line in reader.lines() {
        if Instant::now() >= deadline {
            return Err("scan-timeout".to_string());
        }

        let Ok(line) = line else {
            warnings.insert("scan-read-failed".to_string());
            continue;
        };
        if line.trim().is_empty() {
            continue;
        }

        let value: Value = match serde_json::from_str(&line) {
            Ok(value) => value,
            Err(_) => {
                warnings.insert("malformed-json-line".to_string());
                continue;
            }
        };

        if value.get("type").and_then(Value::as_str) == Some("session_meta") {
            if let Some(next_source) = value
                .get("payload")
                .and_then(Value::as_object)
                .and_then(|payload| payload.get("source"))
                .and_then(Value::as_str)
            {
                if !next_source.trim().is_empty() {
                    source = next_source.trim().to_string();
                }
            }
        }

        if let Some(model) = extract_turn_model(&value) {
            current_model_hint = Some(model);
        }

        let Some(usage_info) = extract_usage_info(&value) else {
            continue;
        };
        let mut snapshot = usage_info.direct.clone().unwrap_or_else(|| {
            diff_snapshot(
                usage_info.cumulative.clone().unwrap_or_default(),
                previous_cumulative.clone(),
            )
        });
        let regressed = clamp_snapshot(&mut snapshot);
        if let Some(cumulative) = usage_info.cumulative {
            previous_cumulative = Some(cumulative);
        }

        let resolved_model = usage_info
            .model
            .clone()
            .or(current_model_hint.clone())
            .unwrap_or_else(|| DEFAULT_FALLBACK_MODEL.to_string());
        let canonical_model = canonical_model(&resolved_model);
        let mut event_warnings = Vec::new();
        if usage_info.model.is_none() && current_model_hint.is_none() {
            event_warnings.push("fallback-model".to_string());
        }
        if regressed {
            event_warnings.push("regressive-usage".to_string());
            warnings.insert("regressive-usage".to_string());
        }

        let timestamp = value
            .get("timestamp")
            .and_then(Value::as_str)
            .map(ToString::to_string)
            .unwrap_or_else(|| Utc::now().to_rfc3339());
        let estimated_cost = estimate_cost(&canonical_model, &snapshot);
        if estimated_cost.is_none() {
            event_warnings.push("unknown-model-pricing".to_string());
            warnings.insert("unknown-model-pricing".to_string());
        }

        let event = CodexEvent {
            local_day_key: local_day_key(&timestamp)
                .unwrap_or_else(|| Utc::now().date_naive().format("%Y-%m-%d").to_string()),
            model: resolved_model,
            source: source.clone(),
            input_tokens: snapshot.input_tokens,
            cached_input_tokens: snapshot.cached_input_tokens,
            output_tokens: snapshot.output_tokens,
            reasoning_tokens: snapshot.reasoning_tokens,
            total_tokens: snapshot.total_tokens,
            estimated_cost: estimated_cost.unwrap_or(0.0),
            warnings: event_warnings,
        };
        days.entry(event.local_day_key.clone())
            .or_insert_with(DayAggregate::default)
            .add_event(&event);
    }

    if days.is_empty() {
        warnings.insert("unmeasurable-session".to_string());
    }

    let _ = source;
    Ok(SessionAggregate {
        modified_at,
        file_size,
        warnings,
        days,
    })
}

fn extract_turn_model(value: &Value) -> Option<String> {
    if value.get("type").and_then(Value::as_str) != Some("turn_context") {
        return None;
    }

    value
        .get("payload")
        .and_then(|payload| payload.get("model"))
        .or_else(|| value.get("model"))
        .and_then(Value::as_str)
        .map(ToString::to_string)
}

fn extract_usage_info(value: &Value) -> Option<UsageInfo> {
    let payload = extract_token_payload(value)?;
    let info = payload.get("info").unwrap_or(payload);
    let direct = normalize_usage_snapshot(
        info.get("last_token_usage")
            .or_else(|| info.get("lastTokenUsage")),
    );
    let cumulative = normalize_usage_snapshot(
        info.get("total_token_usage")
            .or_else(|| info.get("totalTokenUsage")),
    );
    let model = info
        .get("model")
        .or_else(|| payload.get("model"))
        .and_then(Value::as_str)
        .map(ToString::to_string);

    if direct.is_none() && cumulative.is_none() {
        return None;
    }

    Some(UsageInfo {
        direct,
        cumulative,
        model,
    })
}

fn extract_token_payload(value: &Value) -> Option<&Value> {
    if value.get("type").and_then(Value::as_str) == Some("token_count") {
        return Some(value);
    }

    let payload = value.get("payload")?;
    if payload.get("type").and_then(Value::as_str) == Some("token_count") {
        return Some(payload);
    }

    payload
        .get("payload")
        .filter(|nested| nested.get("type").and_then(Value::as_str) == Some("token_count"))
}

fn normalize_usage_snapshot(value: Option<&Value>) -> Option<UsageSnapshot> {
    let value = value?;
    let input_tokens = number_field(value, &["input_tokens", "inputTokens"]);
    let cached_input_tokens = number_field(
        value,
        &[
            "cached_input_tokens",
            "cachedInputTokens",
            "cache_read_input_tokens",
            "cacheReadInputTokens",
        ],
    );
    let output_tokens = number_field(value, &["output_tokens", "outputTokens"]);
    let reasoning_tokens =
        number_field(value, &["reasoning_output_tokens", "reasoningOutputTokens"]);
    let total_tokens = value
        .get("total_tokens")
        .or_else(|| value.get("totalTokens"))
        .and_then(Value::as_i64)
        .unwrap_or(input_tokens + output_tokens);

    if input_tokens == 0
        && cached_input_tokens == 0
        && output_tokens == 0
        && reasoning_tokens == 0
        && total_tokens == 0
    {
        return None;
    }

    Some(UsageSnapshot {
        input_tokens,
        cached_input_tokens,
        output_tokens,
        reasoning_tokens,
        total_tokens,
    })
}

fn number_field(value: &Value, names: &[&str]) -> i64 {
    for name in names {
        if let Some(number) = value.get(*name).and_then(Value::as_i64) {
            return number;
        }
    }
    0
}

fn diff_snapshot(current: UsageSnapshot, previous: Option<UsageSnapshot>) -> UsageSnapshot {
    let previous = previous.unwrap_or_default();
    UsageSnapshot {
        input_tokens: current.input_tokens - previous.input_tokens,
        cached_input_tokens: current.cached_input_tokens - previous.cached_input_tokens,
        output_tokens: current.output_tokens - previous.output_tokens,
        reasoning_tokens: current.reasoning_tokens - previous.reasoning_tokens,
        total_tokens: current.total_tokens - previous.total_tokens,
    }
}

fn clamp_snapshot(snapshot: &mut UsageSnapshot) -> bool {
    let mut regressed = false;
    for value in [
        &mut snapshot.input_tokens,
        &mut snapshot.cached_input_tokens,
        &mut snapshot.output_tokens,
        &mut snapshot.reasoning_tokens,
        &mut snapshot.total_tokens,
    ] {
        if *value < 0 {
            *value = 0;
            regressed = true;
        }
    }
    regressed
}

fn estimate_cost(model: &str, snapshot: &UsageSnapshot) -> Option<f64> {
    let (input_per_million, cached_per_million, output_per_million) = match model {
        "gpt-5" | "gpt-5-codex" | "gpt-5.1-codex" => (1.25, 0.125, 10.0),
        "gpt-5.1-codex-mini" | "gpt-5-mini" => (0.25, 0.025, 2.0),
        "gpt-5.2-codex" | "gpt-5.3-codex" => (1.75, 0.175, 14.0),
        "gpt-5.4" => (2.5, 0.25, 15.0),
        "codex-mini-latest" => (1.5, 0.375, 6.0),
        _ => return None,
    };

    let non_cached_input = (snapshot.input_tokens - snapshot.cached_input_tokens).max(0) as f64;
    Some(
        (non_cached_input * input_per_million) / 1_000_000.0
            + (snapshot.cached_input_tokens as f64 * cached_per_million) / 1_000_000.0
            + (snapshot.output_tokens as f64 * output_per_million) / 1_000_000.0,
    )
}

fn canonical_model(value: &str) -> String {
    let normalized = value.trim().to_lowercase().replace(' ', "-");
    for candidate in [
        "gpt-5",
        "gpt-5-codex",
        "gpt-5.1-codex",
        "gpt-5.1-codex-mini",
        "gpt-5.2-codex",
        "gpt-5.3-codex",
        "gpt-5-mini",
        "gpt-5.4",
        "codex-mini-latest",
    ] {
        if normalized == candidate || normalized.starts_with(&format!("{candidate}-")) {
            return candidate.to_string();
        }
    }
    normalized
}

fn local_day_key(timestamp: &str) -> Option<String> {
    let parsed = DateTime::parse_from_rfc3339(timestamp).ok()?;
    Some(
        parsed
            .with_timezone(&Local)
            .date_naive()
            .format("%Y-%m-%d")
            .to_string(),
    )
}

fn parse_local_day_key(value: &str) -> Option<DateTime<Utc>> {
    let date = NaiveDate::parse_from_str(value, "%Y-%m-%d").ok()?;
    let local = Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
        .single()?;
    Some(local.with_timezone(&Utc))
}

fn humanize_warnings(codes: BTreeSet<String>) -> Vec<String> {
    let mut warnings = BTreeSet::new();
    for code in codes {
        match code.as_str() {
            "fallback-model" => {
                warnings.insert("Some events required a fallback model mapping.".to_string());
            }
            "malformed-json-line" => {
                warnings.insert("Some local session lines could not be parsed.".to_string());
            }
            "regressive-usage" => {
                warnings.insert(
                    "Some cumulative token counters regressed and were clamped.".to_string(),
                );
            }
            "scan-read-failed" => {
                warnings.insert("Some Codex session files could not be read.".to_string());
            }
            "scan-timeout" => {
                warnings.insert("Codex local session scanning hit its time budget.".to_string());
            }
            "unknown-model-pricing" => {
                warnings.insert("Pricing was missing for one or more models.".to_string());
            }
            "unmeasurable-session" => {}
            other => {
                warnings.insert(other.to_string());
            }
        }
    }
    warnings.into_iter().collect()
}

fn fetch_quota(
    client: &Client,
    now: DateTime<Utc>,
    previous_snapshot: Option<&ProviderSnapshot>,
) -> QuotaSnapshot {
    let auth_path = resolve_codex_home().join("auth.json");
    let raw = match fs::read_to_string(auth_path) {
        Ok(raw) => raw,
        Err(_) => {
            return unsupported_quota(
                "Codex live quota requires a local Codex OAuth session.",
                previous_snapshot,
            );
        }
    };
    let payload: Value = match serde_json::from_str(&raw) {
        Ok(payload) => payload,
        Err(_) => {
            return unsupported_quota(
                "Codex live quota requires a local Codex OAuth session.",
                previous_snapshot,
            );
        }
    };
    let access_token = payload
        .get("tokens")
        .and_then(|tokens| tokens.get("access_token"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string);
    let Some(access_token) = access_token else {
        return unsupported_quota(
            "Codex live quota requires a local Codex OAuth session.",
            previous_snapshot,
        );
    };

    let mut request = client
        .get("https://chatgpt.com/backend-api/wham/usage")
        .header(AUTHORIZATION, format!("Bearer {access_token}"))
        .header(ACCEPT, "application/json")
        .header(USER_AGENT, "PulseDock");
    if let Some(account_id) = payload
        .get("tokens")
        .and_then(|tokens| tokens.get("account_id"))
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request = request.header("ChatGPT-Account-Id", account_id.to_string());
    }

    let response = match request.send() {
        Ok(response) => response,
        Err(_) => {
            return stale_or_unsupported_quota(
                previous_snapshot,
                "Codex live quota refresh failed.",
            );
        }
    };
    if !response.status().is_success() {
        return stale_or_unsupported_quota(
            previous_snapshot,
            &format!(
                "Codex live quota request failed with HTTP {}.",
                response.status()
            ),
        );
    }

    let payload: Value = match response.json() {
        Ok(payload) => payload,
        Err(_) => {
            return stale_or_unsupported_quota(
                previous_snapshot,
                "Codex live quota response could not be parsed.",
            );
        }
    };

    let mut meters = Vec::new();
    if let Some(meter) = build_percent_meter(
        "session",
        "Session (5h)",
        payload.pointer("/rate_limit/primary_window"),
    ) {
        meters.push(meter);
    }
    if let Some(meter) = build_percent_meter(
        "weekly",
        "Weekly",
        payload.pointer("/rate_limit/secondary_window"),
    ) {
        meters.push(meter);
    }
    if let Some(meter) = build_percent_meter(
        "reviews",
        "Reviews",
        payload.pointer("/code_review_rate_limit/primary_window"),
    ) {
        meters.push(meter);
    }

    if let Some(additional) = payload
        .get("additional_rate_limits")
        .and_then(Value::as_array)
    {
        for entry in additional {
            let label = entry
                .get("limit_name")
                .or_else(|| entry.get("metered_feature"))
                .and_then(Value::as_str)
                .map(|value| value.replace('_', " ").replace("GPT-5-Codex-", ""))
                .map(|value| value.trim().to_string())
                .filter(|value| !value.is_empty())
                .unwrap_or_else(|| "Additional limit".to_string());
            if let Some(meter) = build_percent_meter(
                &format!("{}-session", label.to_ascii_lowercase().replace(' ', "-")),
                &label,
                entry.pointer("/rate_limit/primary_window"),
            ) {
                meters.push(meter);
            }
            if let Some(meter) = build_percent_meter(
                &format!("{}-weekly", label.to_ascii_lowercase().replace(' ', "-")),
                &format!("{label} Weekly"),
                entry.pointer("/rate_limit/secondary_window"),
            ) {
                meters.push(meter);
            }
        }
    }

    if meters.is_empty() {
        return stale_or_unsupported_quota(
            previous_snapshot,
            "Codex live quota did not expose any supported meter windows.",
        );
    }

    QuotaSnapshot {
        quota_status: SectionAvailability::Available,
        quota_status_message: payload
            .get("plan_type")
            .and_then(Value::as_str)
            .map(|value| format!("Codex {value} live quota")),
        quota_last_refreshed_at: Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        quota_meters: meters,
        warnings: Vec::new(),
        has_data: true,
        refresh_failed: false,
    }
}

fn build_percent_meter(
    id: &str,
    label: &str,
    window: Option<&Value>,
) -> Option<crate::models::QuotaMeter> {
    let window = window?;
    let used = window.get("used_percent")?.as_f64()?;
    Some(percent_meter(
        id,
        label,
        used,
        window
            .get("reset_at")
            .and_then(Value::as_i64)
            .and_then(|value| DateTime::<Utc>::from_timestamp(value, 0))
            .map(|value| value.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        window.get("limit_window_seconds").and_then(Value::as_i64),
        "Codex live quota",
        Some(QuotaDisplayMode::Remaining),
    ))
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Mutex, OnceLock};

    fn write_rollout(
        path: &Path,
        model: &str,
        source: &str,
        input_tokens: i64,
        cached_input_tokens: i64,
        output_tokens: i64,
    ) {
        let total_tokens = input_tokens + output_tokens;
        let contents = format!(
            concat!(
                "{{\"type\":\"session_meta\",\"payload\":{{\"source\":\"{}\"}}}}\n",
                "{{\"type\":\"turn_context\",\"timestamp\":\"2026-03-25T01:00:00Z\",\"payload\":{{\"model\":\"{}\"}}}}\n",
                "{{\"type\":\"token_count\",\"timestamp\":\"2026-03-25T01:00:00Z\",\"info\":{{\"last_token_usage\":{{\"input_tokens\":{},\"cached_input_tokens\":{},\"output_tokens\":{},\"reasoning_output_tokens\":0,\"total_tokens\":{}}},\"model\":\"{}\"}}}}\n"
            ),
            source, model, input_tokens, cached_input_tokens, output_tokens, total_tokens, model,
        );
        fs::write(path, contents).expect("write rollout");
    }

    fn codex_env_lock() -> &'static Mutex<()> {
        static LOCK: OnceLock<Mutex<()>> = OnceLock::new();
        LOCK.get_or_init(|| Mutex::new(()))
    }

    fn make_temp_dir() -> PathBuf {
        let unique = format!(
            "pulsedock-codex-test-{}-{}",
            std::process::id(),
            SystemTime::now()
                .duration_since(SystemTime::UNIX_EPOCH)
                .expect("timestamp")
                .as_nanos()
        );
        std::env::temp_dir().join(unique)
    }

    #[test]
    fn scan_session_file_extracts_cost_and_source() {
        let temp_dir = make_temp_dir();
        fs::create_dir_all(&temp_dir).expect("temp dir");
        let rollout_path = temp_dir.join("rollout-main.jsonl");
        write_rollout(&rollout_path, "gpt-5-codex", "cli", 1_000, 200, 100);

        let aggregate = scan_session_file(
            &rollout_path,
            None,
            0,
            Instant::now() + StdDuration::from_secs(1),
        )
        .expect("scan succeeds");
        let day = aggregate.days.get("2026-03-25").expect("day aggregate");

        assert_eq!(day.total_tokens, 1_100);
        assert_eq!(
            day.by_source.get("cli").map(|value| value.total_tokens),
            Some(1_100)
        );
        assert!(day.estimated_cost > 0.0);

        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn refresh_from_disk_reloads_changed_rollouts() {
        let _guard = codex_env_lock().lock().expect("lock");
        let temp_dir = make_temp_dir();
        let sessions_dir = temp_dir.join("sessions").join("workspace");
        fs::create_dir_all(&sessions_dir).expect("sessions dir");
        let rollout_path = sessions_dir.join("rollout-main.jsonl");
        write_rollout(&rollout_path, "gpt-5-codex", "cli", 100, 0, 20);

        let previous = std::env::var_os("CODEX_HOME");
        unsafe {
            std::env::set_var("CODEX_HOME", &temp_dir);
        }

        let mut runtime = CodexRuntime::default();
        runtime.refresh_from_disk(false).expect("first scan");
        let first_total = runtime
            .files
            .values()
            .flat_map(|aggregate| aggregate.days.values())
            .map(|day| day.total_tokens)
            .sum::<i64>();

        std::thread::sleep(std::time::Duration::from_millis(20));
        write_rollout(&rollout_path, "gpt-5-codex", "cli", 400, 0, 50);
        runtime.refresh_from_disk(false).expect("second scan");
        let second_total = runtime
            .files
            .values()
            .flat_map(|aggregate| aggregate.days.values())
            .map(|day| day.total_tokens)
            .sum::<i64>();

        if let Some(previous) = previous {
            unsafe {
                std::env::set_var("CODEX_HOME", previous);
            }
        } else {
            unsafe {
                std::env::remove_var("CODEX_HOME");
            }
        }
        let _ = fs::remove_dir_all(temp_dir);

        assert_eq!(first_total, 120);
        assert_eq!(second_total, 450);
    }

    #[test]
    fn warning_humanizer_suppresses_unmeasurable_sessions() {
        let warnings = humanize_warnings(BTreeSet::from([
            "unmeasurable-session".to_string(),
            "scan-timeout".to_string(),
        ]));

        assert_eq!(
            warnings,
            vec!["Codex local session scanning hit its time budget.".to_string()]
        );
    }

    #[test]
    fn scan_session_file_stops_when_deadline_is_exceeded() {
        let temp_dir = make_temp_dir();
        fs::create_dir_all(&temp_dir).expect("temp dir");
        let rollout_path = temp_dir.join("rollout-main.jsonl");
        write_rollout(&rollout_path, "gpt-5-codex", "cli", 1_000, 200, 100);

        let deadline = Instant::now()
            .checked_sub(StdDuration::from_millis(1))
            .expect("deadline in the past");
        let error = scan_session_file(&rollout_path, None, 0, deadline).expect_err("times out");

        assert_eq!(error, "scan-timeout");
        let _ = fs::remove_dir_all(temp_dir);
    }

    #[test]
    fn incomplete_discovery_does_not_prune_existing_sessions() {
        let mut files = HashMap::from([(
            "workspace/rollout-old.jsonl".to_string(),
            SessionAggregate::default(),
        )]);

        let discovered = HashMap::from([(
            "workspace/rollout-new.jsonl".to_string(),
            PathBuf::from("workspace/rollout-new.jsonl"),
        )]);

        reconcile_discovered_files(&mut files, &discovered, false);

        assert!(files.contains_key("workspace/rollout-old.jsonl"));
    }

    #[test]
    fn complete_discovery_prunes_missing_sessions() {
        let mut files = HashMap::from([(
            "workspace/rollout-old.jsonl".to_string(),
            SessionAggregate::default(),
        )]);
        let discovered = HashMap::from([(
            "workspace/rollout-new.jsonl".to_string(),
            PathBuf::from("workspace/rollout-new.jsonl"),
        )]);

        reconcile_discovered_files(&mut files, &discovered, true);

        assert!(!files.contains_key("workspace/rollout-old.jsonl"));
    }

    #[test]
    fn timed_out_refresh_keeps_existing_cached_sessions() {
        let _guard = codex_env_lock().lock().expect("lock");
        let temp_dir = make_temp_dir();
        let sessions_dir = temp_dir.join("sessions").join("workspace");
        fs::create_dir_all(&sessions_dir).expect("sessions dir");
        let rollout_path = sessions_dir.join("rollout-main.jsonl");
        write_rollout(&rollout_path, "gpt-5-codex", "cli", 100, 0, 20);

        let previous = std::env::var_os("CODEX_HOME");
        unsafe {
            std::env::set_var("CODEX_HOME", &temp_dir);
        }

        let mut runtime = CodexRuntime::default();
        runtime
            .refresh_from_disk_with_budget(false, StdDuration::from_secs(1))
            .expect("first scan");
        let first_total = runtime
            .files
            .values()
            .flat_map(|aggregate| aggregate.days.values())
            .map(|day| day.total_tokens)
            .sum::<i64>();

        runtime
            .refresh_from_disk_with_budget(false, StdDuration::ZERO)
            .expect("timed out scan");
        let second_total = runtime
            .files
            .values()
            .flat_map(|aggregate| aggregate.days.values())
            .map(|day| day.total_tokens)
            .sum::<i64>();

        if let Some(previous) = previous {
            unsafe {
                std::env::set_var("CODEX_HOME", previous);
            }
        } else {
            unsafe {
                std::env::remove_var("CODEX_HOME");
            }
        }
        let _ = fs::remove_dir_all(temp_dir);

        assert_eq!(first_total, 120);
        assert_eq!(second_total, first_total);
        assert!(runtime.discovery_warnings.contains("scan-timeout"));
    }
}
