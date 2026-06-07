#[derive(Debug, Clone, PartialEq, Eq)]
pub struct MarkdownDocument {
    file_path: String,
    source: String,
    has_unsaved_changes: bool,
}

impl MarkdownDocument {
    pub fn new(file_path: impl Into<String>, source: impl Into<String>) -> Self {
        Self {
            file_path: file_path.into(),
            source: source.into(),
            has_unsaved_changes: false,
        }
    }

    pub fn file_path(&self) -> &str {
        &self.file_path
    }

    pub fn source(&self) -> &str {
        &self.source
    }

    pub fn has_unsaved_changes(&self) -> bool {
        self.has_unsaved_changes
    }

    pub fn update_source(&mut self, source: impl Into<String>) {
        self.source = source.into();
        self.has_unsaved_changes = true;
    }
}

#[cfg(test)]
mod tests {
    use super::MarkdownDocument;

    #[test]
    fn document_tracks_unsaved_changes_after_edit() {
        let mut document = MarkdownDocument::new("README.md", "# Polarbear");

        document.update_source("# Polarbear\n\nLocal-first Markdown editing.");

        assert!(document.has_unsaved_changes());
    }
}
