export type PluginDescriptor = {
  id: string;
  label: string;
  status: "enabled" | "planned";
};

export const builtInPlugins: PluginDescriptor[] = [
  {
    id: "markdown-preview",
    label: "Markdown preview",
    status: "enabled"
  },
  {
    id: "mermaid-renderer",
    label: "Mermaid renderer",
    status: "enabled"
  },
  {
    id: "cloud-sync",
    label: "Cloud sync",
    status: "enabled"
  }
];
