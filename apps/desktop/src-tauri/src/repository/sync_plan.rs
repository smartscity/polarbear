use std::collections::{BTreeMap, BTreeSet};

pub(super) type Manifest = BTreeMap<String, String>;

#[derive(Debug, PartialEq, Eq)]
pub(super) enum Action {
    Converged,
    Download,
    Upload,
    Conflict,
}

/// Absence is a versioned state, not an empty file. Decisions never read mutable IO.
pub(super) fn plan(
    baseline: &Manifest,
    local: &Manifest,
    remote: &Manifest,
) -> BTreeMap<String, Action> {
    baseline
        .keys()
        .chain(local.keys())
        .chain(remote.keys())
        .collect::<BTreeSet<_>>()
        .into_iter()
        .map(|path| {
            let (b, l, r) = (baseline.get(path), local.get(path), remote.get(path));
            let action = if l == r {
                Action::Converged
            } else if l == b {
                Action::Download
            } else if r == b {
                Action::Upload
            } else {
                Action::Conflict
            };
            (path.clone(), action)
        })
        .collect()
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test]
    fn three_way_plan_covers_content_and_existence_without_a_preferred_side() {
        let cases = [
            (Some("B"), Some("L"), Some("B"), Action::Upload),
            (Some("B"), Some("B"), Some("R"), Action::Download),
            (Some("B"), Some("L"), Some("L"), Action::Converged),
            (Some("B"), Some("L"), Some("R"), Action::Conflict),
            (None, Some("L"), Some("R"), Action::Conflict),
            (Some("B"), None, Some("R"), Action::Conflict),
            (Some("B"), Some("L"), None, Action::Conflict),
            (Some("B"), None, None, Action::Converged),
            (Some("B"), None, Some("B"), Action::Upload),
            (Some("B"), Some("B"), None, Action::Download),
            (None, None, Some("R"), Action::Download),
            (None, Some("L"), None, Action::Upload),
        ];
        let manifest = |value: Option<&str>| {
            value
                .map(|v| BTreeMap::from([("note.md".into(), v.into())]))
                .unwrap_or_default()
        };
        for (b, l, r, expected) in cases {
            assert_eq!(
                plan(&manifest(b), &manifest(l), &manifest(r)).get("note.md"),
                Some(&expected)
            );
        }
    }
}
