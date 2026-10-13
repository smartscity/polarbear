export const flowchartFixtures = [
  { name: "EventId deduplication", source: `flowchart TD
    A["Receive event<br/>EventId = id"] --> B{"EventId already seen?"}
    B -->|Yes| C["Skip duplicate"]
    B -->|No| D{"age &lt; 300s and retry &gt; 0?"}
    D --> E["Store EventId"]
    style B fill:#fef3c7,stroke:#b45309
    style E fill:#d1fae5,stroke:#047857` },
  { name: "Kafka consumption", source: `flowchart TB
    subgraph Kafka["Kafka consumers"]
      direction TB
      subgraph Queues["Partitions"]
        Q1["Partition 1"]
        Q2["Partition 2"]
        Q3["Partition 3"]
      end
      Q1 & Q2 & Q3 --> W["Worker<br/>offset &lt; end"]
      W <-.->|health| M["Monitor &gt; threshold"]
    end
    W --> S["Storage"]
    style W fill:#dbeafe,stroke:#1d4ed8` },
  { name: "Kafka replay dashboard", source: `flowchart LR
    subgraph Metrics["Replay metrics"]
      direction TB
      L["Consumer lag<br/>$quantile = 0.95"]
      R["Replay rate"]
    end
    subgraph Dashboard["Monitoring dashboard"]
      direction LR
      P["Latency panel"] --> A["Alert policy"]
    end
    L --> P
    R --> P
    A -.-> L` },
] as const;
export const additionalDiagramFixtures = [
  { name: "state", source: "stateDiagram-v2\n[*] --> Reading\nReading --> Saved: save\nSaved --> [*]" },
  { name: "entity relationship", source: 'erDiagram\nORDER ||--o{ ITEM : contains\nORDER {\n int id PK\n string state\n}' },
  { name: "sequence", source: "sequenceDiagram\nReader->>Editor: Open document\nEditor-->>Reader: Ready" },
  { name: "gantt", source: "gantt\n title Release plan\n dateFormat YYYY-MM-DD\n section Quality\n Verify :a1, 2026-10-01, 3d\n Ship :after a1, 2d" },
  { name: "pie", source: 'pie title 风险问题分布\n "Low" : 6\n "High" : 2' },
  { name: "class", source: "classDiagram\nDocument <|-- Markdown\nDocument : +save()" },
  { name: "mindmap", source: "mindmap\n  root((Knowledge))\n    Reading\n    Writing" },
] as const;
export const diagramDocument = "# Broker refactoring\n\nIntroduction.\n\n| Component | Status |\n|---|---|\n| Kafka | Ready |\n\n"
  + flowchartFixtures.map((fixture, index) => `## ${fixture.name}\n\n\`\`\`mermaid\n${fixture.source}\n\`\`\`\n\nParagraph ${index + 1}.`).join("\n\n") + "\n\nAfter";
