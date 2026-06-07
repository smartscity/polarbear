#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SecretError {
    MissingSecret { key: String },
    StoreUnavailable { reason: String },
}

pub trait SecretStore {
    fn read_secret(&self, key: &str) -> Result<String, SecretError>;
}

#[derive(Debug, Default, Clone)]
pub struct InMemorySecretStore {
    github_token: Option<String>,
}

impl InMemorySecretStore {
    pub fn with_github_token(github_token: impl Into<String>) -> Self {
        Self {
            github_token: Some(github_token.into()),
        }
    }
}

impl SecretStore for InMemorySecretStore {
    fn read_secret(&self, key: &str) -> Result<String, SecretError> {
        match (key, self.github_token.as_ref()) {
            ("github_token", Some(token)) => Ok(token.clone()),
            _ => Err(SecretError::MissingSecret {
                key: key.to_owned(),
            }),
        }
    }
}
