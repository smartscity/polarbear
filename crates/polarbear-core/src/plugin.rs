#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum PluginCapability {
    MarkdownRenderer,
    DiagramRenderer,
    RepositorySync,
    Exporter,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PluginMetadata {
    pub id: &'static str,
    pub description: &'static str,
    pub capabilities: &'static [PluginCapability],
}

#[derive(Debug, Clone)]
pub struct PluginRegistry {
    plugins: Vec<PluginMetadata>,
}

impl PluginRegistry {
    pub fn built_in() -> Self {
        Self {
            plugins: vec![
                PluginMetadata {
                    id: "markdown-preview",
                    description: "Provides Markdown preview rendering.",
                    capabilities: &[PluginCapability::MarkdownRenderer],
                },
                PluginMetadata {
                    id: "mermaid-renderer",
                    description: "Renders Mermaid diagrams and enables zoomable diagram viewing.",
                    capabilities: &[
                        PluginCapability::DiagramRenderer,
                        PluginCapability::Exporter,
                    ],
                },
                PluginMetadata {
                    id: "github-sync",
                    description: "Connects Polarbear with GitHub repositories.",
                    capabilities: &[PluginCapability::RepositorySync],
                },
            ],
        }
    }

    pub fn all(&self) -> &[PluginMetadata] {
        &self.plugins
    }

    pub fn with_capability(&self, capability: PluginCapability) -> Vec<&PluginMetadata> {
        self.plugins
            .iter()
            .filter(|plugin| plugin.capabilities.contains(&capability))
            .collect()
    }
}

#[cfg(test)]
mod tests {
    use super::{PluginCapability, PluginRegistry};

    #[test]
    fn built_in_registry_contains_github_sync_plugin() {
        let registry = PluginRegistry::built_in();
        let sync_plugins = registry.with_capability(PluginCapability::RepositorySync);

        assert_eq!(sync_plugins.len(), 1);
        assert_eq!(sync_plugins[0].id, "github-sync");
    }
}
