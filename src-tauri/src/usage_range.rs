use chrono::{DateTime, Datelike, Local, TimeZone, Utc};

use crate::models::{UsageRangePresetId, UsageWindow};

pub const DEFAULT_USAGE_RANGE_PRESET_ID: UsageRangePresetId = UsageRangePresetId::Week;

pub struct UsageDateWindow {
  pub usage_window: UsageWindow,
}

struct UsageRangePreset {
  trailing_days: Option<i64>,
  window_label: &'static str,
}

fn get_usage_range_preset(range: UsageRangePresetId) -> UsageRangePreset {
  match range {
    UsageRangePresetId::Today => UsageRangePreset {
      trailing_days: Some(1),
      window_label: "Today",
    },
    UsageRangePresetId::Week => UsageRangePreset {
      trailing_days: Some(7),
      window_label: "Last 7 days",
    },
    UsageRangePresetId::Month => UsageRangePreset {
      trailing_days: Some(30),
      window_label: "Last 30 days",
    },
    UsageRangePresetId::All => UsageRangePreset {
      trailing_days: None,
      window_label: "All time",
    },
  }
}

fn start_of_local_day(value: DateTime<Local>) -> DateTime<Local> {
  Local
    .with_ymd_and_hms(value.year(), value.month(), value.day(), 0, 0, 0)
    .single()
    .expect("valid local day boundary")
}

pub fn create_usage_date_window(
  now: DateTime<Utc>,
  range: UsageRangePresetId,
  earliest_available_at: Option<DateTime<Utc>>,
) -> UsageDateWindow {
  let preset = get_usage_range_preset(range);
  let now_local = now.with_timezone(&Local);
  let until_local = start_of_local_day(now_local);
  let mut since_local = start_of_local_day(earliest_available_at.unwrap_or(now).with_timezone(&Local));

  if let Some(trailing_days) = preset.trailing_days {
    since_local = until_local - chrono::Duration::days(trailing_days - 1);
  }

  UsageDateWindow {
    usage_window: UsageWindow {
      label: preset.window_label.to_string(),
      since: since_local.with_timezone(&Utc).to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
      until: now.to_rfc3339_opts(chrono::SecondsFormat::Millis, true),
    },
  }
}
