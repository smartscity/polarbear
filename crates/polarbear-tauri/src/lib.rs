use polarbear_core::{PluginMetadata, PluginRegistry};

#[derive(Debug, Clone)]
pub struct PolarbearApp {
    plugin_registry: PluginRegistry,
}

impl PolarbearApp {
    pub fn new() -> Self {
        Self {
            plugin_registry: PluginRegistry::built_in(),
        }
    }

    pub fn built_in_plugins(&self) -> &[PluginMetadata] {
        self.plugin_registry.all()
    }
}

impl Default for PolarbearApp {
    fn default() -> Self {
        Self::new()
    }
}
