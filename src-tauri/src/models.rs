use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderId {
    Codex,
    Cursor,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProviderStatus {
    Fresh,
    Warning,
    Stale,
    Error,
    Empty,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum LoadingState {
    Idle,
    Loading,
    Refreshing,
    Switching,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum SectionAvailability {
    Available,
    Stale,
    Unsupported,
    ManualRequired,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TopLabelType {
    Model,
    Provider,
    Source,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum QuotaDisplayMode {
    Used,
    Remaining,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum UsageRangePresetId {
    Today,
    Week,
    Month,
    All,
}

impl UsageRangePresetId {
    pub fn parse(value: &str) -> Result<Self, String> {
        match value {
            "today" => Ok(Self::Today),
            "week" => Ok(Self::Week),
            "month" => Ok(Self::Month),
            "all" => Ok(Self::All),
            _ => Err(format!("Unsupported usage range \"{value}\".")),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct UsageWindow {
    pub label: String,
    pub since: String,
    pub until: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct QuotaMeter {
    pub id: String,
    pub label: String,
    pub kind: String,
    pub used: f64,
    pub limit: Option<f64>,
    pub display_mode: Option<QuotaDisplayMode>,
    pub currency_code: Option<String>,
    pub unit_label: Option<String>,
    pub reset_at: Option<String>,
    pub period_seconds: Option<i64>,
    pub availability: SectionAvailability,
    pub source_label: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ProviderSnapshot {
    pub id: ProviderId,
    pub display_name: String,
    pub status: ProviderStatus,
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
    pub activity_label: String,
    pub warnings: Vec<String>,
    pub last_refreshed_at: Option<String>,
    pub stale_since: Option<String>,
    pub provenance: Vec<String>,
    pub detail_message: Option<String>,
    pub quota_status: SectionAvailability,
    pub quota_status_message: Option<String>,
    pub quota_last_refreshed_at: Option<String>,
    pub cost_status: SectionAvailability,
    pub cost_status_message: Option<String>,
    pub cost_last_refreshed_at: Option<String>,
    pub quota_meters: Vec<QuotaMeter>,
}

impl ProviderSnapshot {
    pub fn is_loaded(&self) -> bool {
        !matches!(self.status, ProviderStatus::Error | ProviderStatus::Empty)
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSummary {
    pub estimated_cost: f64,
    pub total_tokens: i64,
    pub provider_count: usize,
    pub loaded_provider_count: usize,
    pub usage_window: UsageWindow,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardNotice {
    pub level: String,
    pub message: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DashboardSnapshot {
    pub summary: DashboardSummary,
    pub providers: Vec<ProviderSnapshot>,
    pub notices: Vec<DashboardNotice>,
    pub last_refreshed_at: Option<String>,
    pub provenance: Vec<String>,
    pub loading_state: LoadingState,
    pub selected_usage_range: UsageRangePresetId,
}
