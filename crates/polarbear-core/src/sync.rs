use crate::secret::{SecretError, SecretStore};
use crate::settings::RepositorySettings;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GitHubSyncRequest {
    pub repository: RepositorySettings,
    pub file_path: String,
    pub markdown_source: String,
    pub commit_message: String,
}

impl GitHubSyncRequest {
    pub fn new(
        repository: RepositorySettings,
        file_path: impl Into<String>,
        markdown_source: impl Into<String>,
    ) -> Self {
        let file_path = file_path.into();
        Self {
            repository,
            commit_message: format!("docs: update {file_path}"),
            file_path,
            markdown_source: markdown_source.into(),
        }
    }
}

#[derive(Debug, Clone)]
pub struct GitHubSyncService<S> {
    secret_store: S,
}

impl<S> GitHubSyncService<S>
where
    S: SecretStore,
{
    pub fn new(secret_store: S) -> Self {
        Self { secret_store }
    }

    pub fn read_github_token(&self) -> Result<String, SecretError> {
        self.secret_store.read_secret("github_token")
    }
}

#[cfg(test)]
mod tests {
    use super::GitHubSyncRequest;
    use crate::settings::RepositorySettings;

    #[test]
    fn sync_request_uses_document_update_commit_message() {
        let repository = RepositorySettings {
            owner: "polarbear".to_owned(),
            name: "polarbear".to_owned(),
            branch: "main".to_owned(),
        };

        let request = GitHubSyncRequest::new(repository, "docs/guide.md", "# Guide");

        assert_eq!(request.commit_message, "docs: update docs/guide.md");
    }
}
