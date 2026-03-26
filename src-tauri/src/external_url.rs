use std::collections::HashSet;

pub fn assert_allowed_external_url(value: &str) -> Result<String, String> {
  let url = url::Url::parse(value).map_err(|error| error.to_string())?;
  let allowed_hosts = HashSet::from([
    "chatgpt.com",
    "platform.openai.com",
    "status.openai.com",
    "cursor.com",
    "www.cursor.com",
    "status.cursor.com",
  ]);

  if url.scheme() != "https" {
    return Err("Blocked external URL.".to_string());
  }

  let Some(host) = url.host_str() else {
    return Err("Blocked external URL.".to_string());
  };

  if !allowed_hosts.contains(host) {
    return Err("Blocked external URL.".to_string());
  }

  Ok(url.to_string())
}
