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

#[cfg(test)]
mod tests {
    use super::assert_allowed_external_url;

    #[test]
    fn allows_expected_https_hosts() {
        let url = assert_allowed_external_url("https://chatgpt.com/backend-api/wham/usage")
            .expect("allowed");
        assert_eq!(url, "https://chatgpt.com/backend-api/wham/usage");
    }

    #[test]
    fn blocks_non_https_urls() {
        assert!(assert_allowed_external_url("http://chatgpt.com").is_err());
    }

    #[test]
    fn blocks_unapproved_hosts() {
        assert!(assert_allowed_external_url("https://example.com").is_err());
    }
}
