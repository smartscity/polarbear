export function codeFenceTemplate(language: string): string {
  if (language === "mermaid") {
    return "\n```mermaid\ngraph TD\n  A[Start] --> B[End]\n```\n";
  }
  if (language === "plantuml") {
    return "\n```plantuml\n@startuml\nAlice -> Bob: Hello\n@enduml\n```\n";
  }
  return `\n\`\`\`${language}\n\n\`\`\`\n`;
}
