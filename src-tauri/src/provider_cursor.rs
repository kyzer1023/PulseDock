use base64::{Engine as _, engine::general_purpose::URL_SAFE_NO_PAD};
use chrono::{DateTime, Datelike, Local, NaiveDate, TimeZone, Utc};
use csv::StringRecord;
use reqwest::blocking::Client;
use reqwest::header::{ACCEPT, COOKIE, ORIGIN, REFERER};
use rusqlite::{Connection, OpenFlags};
use serde_json::Value;
use std::collections::BTreeMap;
use std::path::PathBuf;

use crate::models::{
    ProviderId, ProviderSnapshot, QuotaMeter, SectionAvailability, TopLabelType, UsageRangePresetId,
};
use crate::provider_shared::{
    CostSnapshot, LabelAggregate, QuotaSnapshot, build_provider_snapshot, create_date_key_window,
    empty_cost_snapshot, merge_label_totals, percent_meter, stale_cost_from_previous,
    stale_or_unsupported_quota, top_label, unsupported_quota, usage_range_covers,
};

const CURSOR_COST_PROVENANCE: &str = "Cursor usage export";

#[derive(Debug, Clone, Default)]
struct CursorAuthState {
    access_token: Option<String>,
    subject: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct CursorDayAggregate {
    input_tokens: i64,
    cache_write_tokens: i64,
    cached_input_tokens: i64,
    output_tokens: i64,
    total_tokens: i64,
    estimated_cost: f64,
    missing_cost: bool,
    by_model: std::collections::HashMap<String, LabelAggregate>,
    by_provider: std::collections::HashMap<String, LabelAggregate>,
}

#[derive(Debug, Clone, Default)]
pub struct CursorRuntime {
    covered_range: Option<UsageRangePresetId>,
    days: BTreeMap<String, CursorDayAggregate>,
    quota_snapshot: Option<QuotaSnapshot>,
}

pub fn collect_provider(
    runtime: &mut CursorRuntime,
    client: &Client,
    now: DateTime<Utc>,
    range: UsageRangePresetId,
    previous_snapshot: Option<&ProviderSnapshot>,
    force_refresh: bool,
    refresh_quota: bool,
) -> ProviderSnapshot {
    let cost_snapshot = runtime.collect_cost(client, now, range, previous_snapshot, force_refresh);
    let quota_snapshot = if refresh_quota || runtime.quota_snapshot.is_none() {
        let next = fetch_quota(client, now, previous_snapshot);
        runtime.quota_snapshot = Some(next.clone());
        next
    } else {
        runtime.quota_snapshot.clone().unwrap_or_else(|| {
            unsupported_quota(
                "Cursor live quota requires an active, unexpired local Cursor session.",
                previous_snapshot,
            )
        })
    };

    build_provider_snapshot(
        ProviderId::Cursor,
        "Cursor",
        "Active days",
        "Cursor live quota",
        now,
        previous_snapshot,
        cost_snapshot,
        quota_snapshot,
    )
}

impl CursorRuntime {
    fn collect_cost(
        &mut self,
        client: &Client,
        now: DateTime<Utc>,
        range: UsageRangePresetId,
        previous_snapshot: Option<&ProviderSnapshot>,
        force_refresh: bool,
    ) -> CostSnapshot {
        let fallback_window = create_date_key_window(now, range, None).usage_window;
        let window = match self.ensure_coverage(client, now, range, force_refresh) {
            Ok(window) => window,
            Err(error) => {
                if let Some(previous_snapshot) = previous_snapshot {
                    if previous_snapshot.cost_status == SectionAvailability::Available {
                        return stale_cost_from_previous(
                            previous_snapshot,
                            Some(error),
                            previous_snapshot.usage_window.clone(),
                            vec![CURSOR_COST_PROVENANCE.to_string()],
                            "Cursor cost data could not be refreshed. Showing last known values.",
                        );
                    }
                }

                return empty_cost_snapshot(
                    fallback_window,
                    "Cursor token-cost export is unavailable.",
                    Some(error),
                    vec![CURSOR_COST_PROVENANCE.to_string()],
                    previous_snapshot.and_then(|snapshot| snapshot.cost_last_refreshed_at.clone()),
                    false,
                    true,
                );
            }
        };

        let mut totals = CursorDayAggregate::default();
        let mut activity_count = 0_i64;
        for (day_key, aggregate) in &self.days {
            if day_key < &window.cursor_since || day_key > &window.cursor_until {
                continue;
            }

            activity_count += 1;
            totals.input_tokens += aggregate.input_tokens;
            totals.cache_write_tokens += aggregate.cache_write_tokens;
            totals.cached_input_tokens += aggregate.cached_input_tokens;
            totals.output_tokens += aggregate.output_tokens;
            totals.total_tokens += aggregate.total_tokens;
            totals.estimated_cost += aggregate.estimated_cost;
            totals.missing_cost |= aggregate.missing_cost;
            merge_label_totals(&mut totals.by_model, &aggregate.by_model);
            merge_label_totals(&mut totals.by_provider, &aggregate.by_provider);
        }

        if totals.total_tokens == 0 && totals.estimated_cost == 0.0 {
            let detail_message = format!(
                "No Cursor usage rows were found for {}.",
                window.usage_window.label.to_lowercase()
            );
            return empty_cost_snapshot(
                window.usage_window,
                "No recent Cursor token-cost data found.",
                Some(detail_message),
                vec![CURSOR_COST_PROVENANCE.to_string()],
                Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
                false,
                false,
            );
        }

        let top_provider = top_label(&totals.by_provider).filter(|value| value != "unknown");
        let top_model = top_label(&totals.by_model);
        let warnings = if totals.missing_cost {
            vec!["Cursor export included rows with missing cost values.".to_string()]
        } else {
            Vec::new()
        };

        CostSnapshot {
            usage_window: window.usage_window,
            input_tokens: totals.input_tokens,
            cache_write_tokens: totals.cache_write_tokens,
            cached_input_tokens: totals.cached_input_tokens,
            output_tokens: totals.output_tokens,
            reasoning_tokens: 0,
            total_tokens: totals.total_tokens,
            estimated_cost: totals.estimated_cost,
            top_label: top_provider.clone().or(top_model.clone()),
            top_label_type: if top_provider.is_some() {
                TopLabelType::Provider
            } else {
                TopLabelType::Model
            },
            activity_count,
            warnings,
            detail_message: None,
            provenance: vec![CURSOR_COST_PROVENANCE.to_string()],
            cost_status: SectionAvailability::Available,
            cost_status_message: None,
            cost_last_refreshed_at: Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
            has_data: true,
            refresh_failed: false,
        }
    }

    fn ensure_coverage(
        &mut self,
        client: &Client,
        now: DateTime<Utc>,
        requested_range: UsageRangePresetId,
        force_refresh: bool,
    ) -> Result<crate::provider_shared::DateKeyWindow, String> {
        if !force_refresh {
            if let Some(cached_range) = self.covered_range {
                if usage_range_covers(cached_range, requested_range) {
                    return Ok(create_date_key_window(
                        now,
                        requested_range,
                        self.earliest_date(),
                    ));
                }
            }
        }

        let fetch_range = requested_range;
        let earliest = if fetch_range == UsageRangePresetId::All {
            Some(Utc.with_ymd_and_hms(2000, 1, 1, 0, 0, 0).single().unwrap())
        } else {
            None
        };
        let window = create_date_key_window(now, fetch_range, earliest);
        let auth_state = get_auth_state()?;
        let access_token = auth_state
            .access_token
            .ok_or_else(|| "Cursor access token is unavailable or expired.".to_string())?;
        let subject = auth_state
            .subject
            .ok_or_else(|| "Cursor access token is unavailable or expired.".to_string())?;
        let cookie = build_session_cookie(&access_token, &subject)?;

        let start_date = local_date_to_epoch_ms(window.since_date)?;
        let end_date = local_date_to_epoch_ms(window.until_date)? + 86_399_999;
        let url = format!(
            "https://cursor.com/api/dashboard/export-usage-events-csv?startDate={start_date}&endDate={end_date}&strategy=tokens"
        );
        let response = client
            .get(url)
            .header(COOKIE, cookie)
            .header(ACCEPT, "text/csv")
            .send()
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Err(format!(
                "Cursor export request failed with HTTP {}.",
                response.status()
            ));
        }

        let csv_text = response.text().map_err(|error| error.to_string())?;
        self.days = parse_usage_csv(&csv_text)?;
        self.covered_range = Some(fetch_range);
        Ok(create_date_key_window(
            now,
            requested_range,
            self.earliest_date(),
        ))
    }

    fn earliest_date(&self) -> Option<DateTime<Utc>> {
        self.days.keys().next().and_then(|value| {
            let date = NaiveDate::parse_from_str(value, "%Y%m%d").ok()?;
            let local = Local
                .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
                .single()?;
            Some(local.with_timezone(&Utc))
        })
    }
}

fn get_auth_state() -> Result<CursorAuthState, String> {
    let db_path = resolve_state_db_path()?;
    if !db_path.exists() {
        return Ok(CursorAuthState::default());
    }

    let connection = Connection::open_with_flags(&db_path, OpenFlags::SQLITE_OPEN_READ_ONLY)
        .map_err(|error| error.to_string())?;
    let mut statement = connection
        .prepare("SELECT key, value FROM ItemTable WHERE key IN ('cursorAuth/accessToken')")
        .map_err(|error| error.to_string())?;
    let rows = statement
        .query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })
        .map_err(|error| error.to_string())?;

    let mut values = std::collections::HashMap::new();
    for row in rows {
        let (key, value) = row.map_err(|error| error.to_string())?;
        values.insert(key, value);
    }

    let access_token = values
        .remove("cursorAuth/accessToken")
        .map(|value| value.trim().to_string())
        .filter(|value| !value.is_empty());
    let usable_access_token = access_token.filter(|value| token_is_usable(value));
    let payload = usable_access_token.as_deref().and_then(decode_jwt_payload);

    Ok(CursorAuthState {
        access_token: usable_access_token,
        subject: payload.as_ref().and_then(|payload| {
            payload
                .get("sub")
                .and_then(Value::as_str)
                .map(ToString::to_string)
        }),
    })
}

fn resolve_state_db_path() -> Result<PathBuf, String> {
    let app_data = std::env::var_os("APPDATA")
        .map(PathBuf::from)
        .or_else(|| {
            std::env::var_os("USERPROFILE")
                .map(|value| PathBuf::from(value).join("AppData\\Roaming"))
        })
        .ok_or_else(|| "APPDATA is not set.".to_string())?;
    Ok(app_data
        .join("Cursor")
        .join("User")
        .join("globalStorage")
        .join("state.vscdb"))
}

fn token_is_usable(token: &str) -> bool {
    decode_jwt_payload(token)
        .and_then(|payload| payload.get("exp").and_then(Value::as_i64))
        .map(|expires_at| expires_at * 1000 > Utc::now().timestamp_millis())
        .unwrap_or(false)
}

fn decode_jwt_payload(token: &str) -> Option<Value> {
    let payload = token.split('.').nth(1)?;
    let decoded = URL_SAFE_NO_PAD.decode(payload).ok()?;
    serde_json::from_slice(&decoded).ok()
}

fn get_user_id(subject: &str) -> Result<String, String> {
    subject
        .split('|')
        .last()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToString::to_string)
        .ok_or_else(|| "Cursor local session is missing a usable subject identifier.".to_string())
}

fn build_session_cookie(access_token: &str, subject: &str) -> Result<String, String> {
    let user_id = get_user_id(subject)?;
    Ok(format!(
        "WorkosCursorSessionToken={}",
        url::form_urlencoded::byte_serialize(format!("{user_id}::{access_token}").as_bytes())
            .collect::<String>()
    ))
}

fn parse_usage_csv(csv_text: &str) -> Result<BTreeMap<String, CursorDayAggregate>, String> {
    let mut reader = csv::ReaderBuilder::new()
        .has_headers(true)
        .from_reader(csv_text.as_bytes());
    let headers = reader.headers().map_err(|error| error.to_string())?.clone();
    let header_index =
        |name: &str| -> Option<usize> { headers.iter().position(|header| header == name) };
    let mut days = BTreeMap::new();

    for record in reader.records() {
        let record = record.map_err(|error| error.to_string())?;
        let timestamp = record_value(&record, header_index("Date"))
            .trim()
            .to_string();
        let day_key = cursor_day_key(&timestamp)?;
        let model = record_value(&record, header_index("Model"))
            .trim()
            .to_string();
        let provider = detect_provider(&model).unwrap_or_else(|| "unknown".to_string());
        let input_with_cache_write = parse_int(record_value(
            &record,
            header_index("Input (w/ Cache Write)"),
        ));
        let input_without_cache_write = parse_int(record_value(
            &record,
            header_index("Input (w/o Cache Write)"),
        ));
        let cache_read = parse_int(record_value(&record, header_index("Cache Read")));
        let output_tokens = parse_int(record_value(&record, header_index("Output Tokens")));
        let estimated_cost = parse_money(record_value(&record, header_index("Cost")));
        if input_with_cache_write == 0
            && input_without_cache_write == 0
            && cache_read == 0
            && output_tokens == 0
            && estimated_cost == 0.0
        {
            continue;
        }

        let cache_write_tokens = (input_with_cache_write - input_without_cache_write).max(0);
        let total_tokens =
            input_without_cache_write + cache_write_tokens + cache_read + output_tokens;
        let aggregate = days
            .entry(day_key)
            .or_insert_with(CursorDayAggregate::default);
        aggregate.input_tokens += input_without_cache_write;
        aggregate.cache_write_tokens += cache_write_tokens;
        aggregate.cached_input_tokens += cache_read;
        aggregate.output_tokens += output_tokens;
        aggregate.total_tokens += total_tokens;
        aggregate.estimated_cost += estimated_cost;
        aggregate.missing_cost |= record_value(&record, header_index("Cost"))
            .trim()
            .is_empty();

        let model_entry = aggregate.by_model.entry(model).or_default();
        model_entry.estimated_cost += estimated_cost;
        model_entry.total_tokens += total_tokens;

        let provider_entry = aggregate.by_provider.entry(provider).or_default();
        provider_entry.estimated_cost += estimated_cost;
        provider_entry.total_tokens += total_tokens;
    }

    Ok(days)
}

fn fetch_quota(
    client: &Client,
    now: DateTime<Utc>,
    previous_snapshot: Option<&ProviderSnapshot>,
) -> QuotaSnapshot {
    let auth_state = match get_auth_state() {
        Ok(auth_state) => auth_state,
        Err(error) => return stale_or_unsupported_quota(previous_snapshot, &error),
    };
    let Some(access_token) = auth_state.access_token.clone() else {
        return unsupported_quota(
            "Cursor live quota requires an active, unexpired local Cursor session.",
            previous_snapshot,
        );
    };
    let Some(subject) = auth_state.subject.clone() else {
        return unsupported_quota(
            "Cursor live quota requires an active, unexpired local Cursor session.",
            previous_snapshot,
        );
    };
    let cookie = match build_session_cookie(&access_token, &subject) {
        Ok(cookie) => cookie,
        Err(error) => return unsupported_quota(&error, previous_snapshot),
    };

    let modern = fetch_json(client, "https://cursor.com/api/usage-summary", &cookie);
    let legacy = get_user_id(&subject)
        .ok()
        .and_then(|user_id| fetch_legacy_meter(client, &cookie, &user_id).ok());

    let modern = match modern {
        Ok(modern) => modern,
        Err(error) => return stale_or_unsupported_quota(previous_snapshot, &error),
    };

    let meters = select_quota_meters(map_modern_quota(&modern), legacy);
    if meters.is_empty() {
        return unsupported_quota(
            "Cursor is authenticated, but this account did not expose any supported quota metrics.",
            previous_snapshot,
        );
    }

    QuotaSnapshot {
        quota_status: SectionAvailability::Available,
        quota_status_message: modern
            .get("membershipType")
            .and_then(Value::as_str)
            .map(|value| format!("Cursor {}", value.replace('_', " ")))
            .or_else(|| {
                is_legacy_request_snapshot(&meters)
                    .then(|| "Cursor legacy request quota".to_string())
            }),
        quota_last_refreshed_at: Some(now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true)),
        quota_meters: meters,
        warnings: Vec::new(),
        has_data: true,
        refresh_failed: false,
    }
}

fn fetch_json(client: &Client, url: &str, cookie: &str) -> Result<Value, String> {
    let response = client
        .get(url)
        .header(COOKIE, cookie)
        .header(ACCEPT, "application/json")
        .header(ORIGIN, "https://cursor.com")
        .header(REFERER, "https://cursor.com/dashboard")
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Cursor quota request failed with HTTP {}.",
            response.status()
        ));
    }
    response.json().map_err(|error| error.to_string())
}

fn fetch_legacy_meter(client: &Client, cookie: &str, user_id: &str) -> Result<QuotaMeter, String> {
    let url = format!("https://cursor.com/api/usage?user={user_id}");
    let response = client
        .get(url)
        .header(COOKIE, cookie)
        .header(ACCEPT, "application/json")
        .send()
        .map_err(|error| error.to_string())?;
    if !response.status().is_success() {
        return Err(format!(
            "Cursor legacy request quota failed with HTTP {}.",
            response.status()
        ));
    }
    let payload: Value = response.json().map_err(|error| error.to_string())?;
    let requests_used = payload
        .get("gpt-4")
        .and_then(|value| {
            value
                .get("numRequestsTotal")
                .or_else(|| value.get("numRequests"))
        })
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    let requests_limit = payload
        .get("gpt-4")
        .and_then(|value| value.get("maxRequestUsage"))
        .and_then(Value::as_f64)
        .unwrap_or(0.0);
    if requests_limit <= 0.0 {
        return Err("Cursor legacy request quota is unavailable.".to_string());
    }

    Ok(QuotaMeter {
        id: "requests".to_string(),
        label: "Requests".to_string(),
        kind: "count".to_string(),
        used: requests_used,
        limit: Some(requests_limit),
        display_mode: None,
        currency_code: None,
        unit_label: Some("requests".to_string()),
        reset_at: None,
        period_seconds: None,
        availability: SectionAvailability::Available,
        source_label: Some("Cursor legacy quota".to_string()),
    })
}

fn select_quota_meters(
    modern_meters: Vec<QuotaMeter>,
    legacy_meter: Option<QuotaMeter>,
) -> Vec<QuotaMeter> {
    if let Some(legacy_meter) = legacy_meter {
        return vec![legacy_meter];
    }

    modern_meters
}

fn is_legacy_request_snapshot(meters: &[QuotaMeter]) -> bool {
    !meters.is_empty()
        && meters
            .iter()
            .all(|meter| meter.id == "requests" || meter.unit_label.as_deref() == Some("requests"))
}

fn map_modern_quota(payload: &Value) -> Vec<QuotaMeter> {
    let usage_scope = if payload.get("limitType").and_then(Value::as_str) == Some("team")
        && payload.pointer("/teamUsage/plan").is_some()
    {
        payload.get("teamUsage")
    } else {
        payload.get("individualUsage")
    };
    let plan = usage_scope.and_then(|scope| scope.get("plan"));
    let on_demand = usage_scope.and_then(|scope| scope.get("onDemand"));
    let reset_at = payload
        .get("billingCycleEnd")
        .and_then(Value::as_str)
        .map(ToString::to_string);
    let period_seconds = match (
        payload.get("billingCycleStart").and_then(Value::as_str),
        payload.get("billingCycleEnd").and_then(Value::as_str),
    ) {
        (Some(start), Some(end)) => DateTime::parse_from_rfc3339(end).ok().and_then(|end| {
            DateTime::parse_from_rfc3339(start)
                .ok()
                .map(|start| (end - start).num_seconds())
        }),
        _ => None,
    };

    let mut meters = Vec::new();
    if let Some(plan) = plan {
        if plan
            .get("enabled")
            .and_then(Value::as_bool)
            .unwrap_or(false)
        {
            let limit = plan.get("limit").and_then(Value::as_f64);
            let remaining = plan.get("remaining").and_then(Value::as_f64).unwrap_or(0.0);
            let used = plan
                .get("used")
                .and_then(Value::as_f64)
                .unwrap_or_else(|| limit.map(|limit| limit - remaining).unwrap_or(0.0));
            let is_team_plan = payload.get("limitType").and_then(Value::as_str) == Some("team");
            if is_team_plan {
                if let Some(limit) = limit.filter(|limit| *limit > 0.0) {
                    meters.push(QuotaMeter {
                        id: "total-usage".to_string(),
                        label: "Total usage".to_string(),
                        kind: "currency".to_string(),
                        used: used / 100.0,
                        limit: Some(limit / 100.0),
                        display_mode: None,
                        currency_code: Some("USD".to_string()),
                        unit_label: None,
                        reset_at: reset_at.clone(),
                        period_seconds,
                        availability: SectionAvailability::Available,
                        source_label: Some("Cursor live quota".to_string()),
                    });
                }
            } else {
                let percent_used = plan
                    .get("totalPercentUsed")
                    .and_then(Value::as_f64)
                    .or_else(|| {
                        limit
                            .filter(|limit| *limit > 0.0)
                            .map(|limit| (used / limit) * 100.0)
                    })
                    .unwrap_or(0.0);
                meters.push(percent_meter(
                    "total-usage",
                    "Total usage",
                    percent_used,
                    reset_at.clone(),
                    period_seconds,
                    "Cursor live quota",
                    None,
                ));
            }
            if let Some(percent) = plan.get("autoPercentUsed").and_then(Value::as_f64) {
                meters.push(percent_meter(
                    "auto-usage",
                    "Auto usage",
                    percent,
                    reset_at.clone(),
                    period_seconds,
                    "Cursor live quota",
                    None,
                ));
            }
            if let Some(percent) = plan.get("apiPercentUsed").and_then(Value::as_f64) {
                meters.push(percent_meter(
                    "api-usage",
                    "API usage",
                    percent,
                    reset_at.clone(),
                    period_seconds,
                    "Cursor live quota",
                    None,
                ));
            }
            let on_demand_limit = on_demand
                .and_then(|value| value.get("limit"))
                .and_then(Value::as_f64);
            let on_demand_remaining = on_demand
                .and_then(|value| value.get("remaining"))
                .and_then(Value::as_f64);
            if let (Some(limit), Some(remaining)) = (on_demand_limit, on_demand_remaining) {
                if limit > 0.0 {
                    meters.push(QuotaMeter {
                        id: "on-demand".to_string(),
                        label: "On-demand".to_string(),
                        kind: "currency".to_string(),
                        used: (limit - remaining) / 100.0,
                        limit: Some(limit / 100.0),
                        display_mode: None,
                        currency_code: Some("USD".to_string()),
                        unit_label: None,
                        reset_at: reset_at.clone(),
                        period_seconds,
                        availability: SectionAvailability::Available,
                        source_label: Some("Cursor live quota".to_string()),
                    });
                }
            }
        }
    }

    meters
}

fn record_value<'a>(record: &'a StringRecord, index: Option<usize>) -> &'a str {
    index.and_then(|index| record.get(index)).unwrap_or("")
}

fn cursor_day_key(timestamp: &str) -> Result<String, String> {
    let parsed = DateTime::parse_from_rfc3339(timestamp)
        .map_err(|_| format!("Invalid timestamp \"{timestamp}\"."))?;
    Ok(parsed
        .with_timezone(&Local)
        .date_naive()
        .format("%Y%m%d")
        .to_string())
}

fn local_date_to_epoch_ms(date: NaiveDate) -> Result<i64, String> {
    let local = Local
        .with_ymd_and_hms(date.year(), date.month(), date.day(), 0, 0, 0)
        .single()
        .ok_or_else(|| "Unable to resolve a local day boundary.".to_string())?;
    let utc = local.with_timezone(&Utc);
    Ok(utc.timestamp_millis())
}

fn parse_int(value: &str) -> i64 {
    value.trim().replace(',', "").parse::<i64>().unwrap_or(0)
}

fn parse_money(value: &str) -> f64 {
    value
        .chars()
        .filter(|character| character.is_ascii_digit() || *character == '.' || *character == '-')
        .collect::<String>()
        .parse::<f64>()
        .unwrap_or(0.0)
}

fn detect_provider(model: &str) -> Option<String> {
    let model = model.to_ascii_lowercase();
    if model.contains("anthropic") || model.contains("claude") {
        return Some("Anthropic".to_string());
    }
    if model.contains("gpt")
        || model.contains("openai")
        || model.contains("codex")
        || model.starts_with("o1")
        || model.starts_with("o3")
        || model.starts_with("o4")
    {
        return Some("OpenAI".to_string());
    }
    if model.contains("gemini") || model.contains("google") {
        return Some("Google".to_string());
    }
    None
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[test]
    fn usage_csv_aggregates_tokens_and_providers() {
        let csv_text = "\
Date,Model,Input (w/ Cache Write),Input (w/o Cache Write),Cache Read,Output Tokens,Cost\n\
2026-03-25T10:00:00Z,claude-3.7-sonnet,120,100,50,25,$1.50\n\
2026-03-25T12:00:00Z,gpt-5,20,20,0,5,$0.25\n";
        let day_key = cursor_day_key("2026-03-25T10:00:00Z").expect("day key");

        let days = parse_usage_csv(csv_text).expect("csv parsed");
        let aggregate = days.get(&day_key).expect("aggregate");

        assert_eq!(aggregate.input_tokens, 120);
        assert_eq!(aggregate.cache_write_tokens, 20);
        assert_eq!(aggregate.cached_input_tokens, 50);
        assert_eq!(aggregate.output_tokens, 30);
        assert_eq!(aggregate.total_tokens, 220);
        assert!((aggregate.estimated_cost - 1.75).abs() < f64::EPSILON);
        assert_eq!(
            aggregate
                .by_provider
                .get("Anthropic")
                .map(|value| value.total_tokens),
            Some(195)
        );
        assert_eq!(
            aggregate
                .by_provider
                .get("OpenAI")
                .map(|value| value.total_tokens),
            Some(25)
        );
    }

    #[test]
    fn modern_quota_mapping_keeps_plan_and_on_demand_meters() {
        let payload = json!({
          "limitType": "individual",
          "billingCycleStart": "2026-03-01T00:00:00Z",
          "billingCycleEnd": "2026-04-01T00:00:00Z",
          "individualUsage": {
            "plan": {
              "enabled": true,
              "limit": 100.0,
              "used": 25.0,
              "remaining": 75.0,
              "totalPercentUsed": 25.0,
              "autoPercentUsed": 10.0,
              "apiPercentUsed": 5.0
            },
            "onDemand": {
              "limit": 5000.0,
              "remaining": 4200.0
            }
          }
        });

        let meters = map_modern_quota(&payload);

        assert_eq!(
            meters
                .iter()
                .map(|meter| meter.id.as_str())
                .collect::<Vec<_>>(),
            vec!["total-usage", "auto-usage", "api-usage", "on-demand",]
        );
        assert_eq!(
            meters
                .iter()
                .find(|meter| meter.id == "on-demand")
                .and_then(|meter| meter.limit),
            Some(50.0)
        );
    }

    #[test]
    fn legacy_quota_snapshot_stays_legacy_only_when_request_meter_exists() {
        let modern_payload = json!({
          "limitType": "individual",
          "billingCycleStart": "2026-03-01T00:00:00Z",
          "billingCycleEnd": "2026-04-01T00:00:00Z",
          "individualUsage": {
            "plan": {
              "enabled": true,
              "limit": 100.0,
              "used": 1.0,
              "remaining": 99.0,
              "totalPercentUsed": 1.0,
              "autoPercentUsed": 0.0
            }
          }
        });
        let legacy_meter = QuotaMeter {
            id: "requests".to_string(),
            label: "Requests".to_string(),
            kind: "count".to_string(),
            used: 31.0,
            limit: Some(500.0),
            display_mode: None,
            currency_code: None,
            unit_label: Some("requests".to_string()),
            reset_at: None,
            period_seconds: None,
            availability: SectionAvailability::Available,
            source_label: Some("Cursor legacy quota".to_string()),
        };

        let meters = select_quota_meters(map_modern_quota(&modern_payload), Some(legacy_meter));

        assert_eq!(
            meters
                .iter()
                .map(|meter| meter.id.as_str())
                .collect::<Vec<_>>(),
            vec!["requests"]
        );
        assert!(is_legacy_request_snapshot(&meters));
    }
}
