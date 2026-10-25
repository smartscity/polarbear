use reqwest::blocking::Response;
use serde::de::DeserializeOwned;
use std::io::Read;

pub(super) const FILE_BYTES: usize = 64 * 1024 * 1024;
pub(super) const JSON_BYTES: usize = 16 * 1024 * 1024;
// Base64 plus JSON line escapes and metadata for a file at the decoded limit.
pub(super) const CONTENT_JSON_BYTES: usize = 96 * 1024 * 1024;
pub(super) const ERROR_BYTES: usize = 64 * 1024;
const ENUMERATION_BYTES: usize = 64 * 1024 * 1024;
const ENUMERATION_ENTRIES: usize = 10_000;
const ENUMERATION_PAGES: usize = 100;

pub(super) fn bytes(response: Response, limit: usize) -> Result<Vec<u8>, String> {
    if response
        .content_length()
        .is_some_and(|length| length > limit as u64)
    {
        return Err(format!(
            "Provider response exceeds the size limit ({limit} bytes)."
        ));
    }
    let mut body = Vec::new();
    response
        .take(limit as u64 + 1)
        .read_to_end(&mut body)
        .map_err(|error| format!("Could not read provider response: {error}"))?;
    if body.len() > limit {
        return Err(format!(
            "Provider response exceeds the size limit ({limit} bytes)."
        ));
    }
    Ok(body)
}

pub(super) fn json<T: DeserializeOwned>(response: Response, limit: usize) -> Result<T, String> {
    serde_json::from_slice(&bytes(response, limit)?).map_err(|error| error.to_string())
}

/// Bounds retained metadata across pages, including responses that contain no syncable files.
#[derive(Default)]
pub(super) struct EnumerationBudget {
    bytes: usize,
    entries: usize,
    pages: usize,
}

impl EnumerationBudget {
    pub(super) fn read_page<T: DeserializeOwned>(
        &mut self,
        response: Response,
    ) -> Result<T, String> {
        if self.pages == ENUMERATION_PAGES {
            return Err(
                "Provider enumeration exceeds the page limit; no partial tree was accepted.".into(),
            );
        }
        self.pages += 1;
        let body = bytes(response, JSON_BYTES.min(ENUMERATION_BYTES - self.bytes))?;
        self.bytes += body.len();
        serde_json::from_slice(&body).map_err(|error| error.to_string())
    }

    pub(super) fn admit_entries(&mut self, count: usize) -> Result<(), String> {
        if count > ENUMERATION_ENTRIES - self.entries {
            return Err(
                "Provider enumeration exceeds the entry limit; no partial tree was accepted."
                    .into(),
            );
        }
        self.entries += count;
        Ok(())
    }
}

pub(super) fn next_page(current: usize, next: &str) -> Result<Option<usize>, String> {
    if next.is_empty() {
        return Ok(None);
    }
    let page = next
        .parse::<usize>()
        .map_err(|_| "Invalid provider pagination.".to_owned())?;
    if page <= current {
        return Err("Provider pagination did not advance; no partial tree was accepted.".into());
    }
    Ok(Some(page))
}
