#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RepositorySettings {
    pub owner: String,
    pub name: String,
    pub branch: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PolarbearSettings {
    pub repository: Option<RepositorySettings>,
}

impl PolarbearSettings {
    pub fn empty() -> Self {
        Self { repository: None }
    }
}
