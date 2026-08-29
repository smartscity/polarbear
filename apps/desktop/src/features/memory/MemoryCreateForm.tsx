import { useState } from "react";
import type { EntityKind, MemoryType, RecordMemoryRequest } from "./generated/adminV1";

const MEMORY_TYPES: MemoryType[] = ["DECISION", "PITFALL", "FACT", "CONSTRAINT", "ARCHITECTURE", "CONVENTION", "TASK_STATE", "TODO", "WORKAROUND"];
const ENTITY_KINDS: EntityKind[] = ["MODULE", "FILE", "SYMBOL", "SERVICE", "API", "DATABASE_TABLE", "DEPENDENCY", "ISSUE", "CONCEPT"];

type Props = {
  busy: boolean;
  labels: { title: string; summary: string; content: string; files: string; validFrom: string; validTo: string; entity: string; evidenceIds: string; create: string };
  onCreate(input: RecordMemoryRequest): Promise<boolean>;
};

function commaSeparated(value: string): string[] | undefined {
  const items = value.split(",").map((item) => item.trim()).filter(Boolean);
  return items.length > 0 ? items : undefined;
}

export function MemoryCreateForm({ busy, labels, onCreate }: Props) {
  const [type, setType] = useState<MemoryType>("FACT");
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");
  const [files, setFiles] = useState("");
  const [validFrom, setValidFrom] = useState("");
  const [validTo, setValidTo] = useState("");
  const [evidenceIds, setEvidenceIds] = useState("");
  const [entityKind, setEntityKind] = useState<EntityKind>("MODULE");
  const [entityKey, setEntityKey] = useState("");
  const [entityName, setEntityName] = useState("");

  const submit = async () => {
    const linkedFiles = commaSeparated(files);
    const linkedEvidence = commaSeparated(evidenceIds);
    const created = await onCreate({
      type,
      summary: summary.trim(),
      ...(content.trim() ? { content: content.trim() } : {}),
      ...(linkedFiles ? { files: linkedFiles } : {}),
      ...(validFrom ? { validFrom: new Date(validFrom).toISOString() } : {}),
      ...(validTo ? { validTo: new Date(validTo).toISOString() } : {}),
      ...(linkedEvidence ? { evidenceIds: linkedEvidence } : {}),
      ...(entityKey.trim() && entityName.trim() ? { entities: [{ kind: entityKind, canonicalKey: entityKey.trim(), displayName: entityName.trim() }] } : {}),
    });
    if (created) {
      setSummary("");
      setContent("");
      setFiles("");
      setEvidenceIds("");
      setEntityKey("");
      setEntityName("");
    }
  };

  return <details className="memory-create">
    <summary>{labels.title}</summary>
    <div className="memory-form-grid">
      <select value={type} onChange={(event) => setType(event.target.value as MemoryType)}>{MEMORY_TYPES.map((item) => <option key={item}>{item}</option>)}</select>
      <input value={summary} onChange={(event) => setSummary(event.target.value)} placeholder={labels.summary} />
      <textarea value={content} onChange={(event) => setContent(event.target.value)} placeholder={labels.content} />
      <input value={files} onChange={(event) => setFiles(event.target.value)} placeholder={labels.files} />
      <label>{labels.validFrom}<input type="datetime-local" value={validFrom} onChange={(event) => setValidFrom(event.target.value)} /></label>
      <label>{labels.validTo}<input type="datetime-local" value={validTo} onChange={(event) => setValidTo(event.target.value)} /></label>
      <div className="memory-inline-fields"><select value={entityKind} onChange={(event) => setEntityKind(event.target.value as EntityKind)}>{ENTITY_KINDS.map((item) => <option key={item}>{item}</option>)}</select><input value={entityKey} onChange={(event) => setEntityKey(event.target.value)} placeholder={`${labels.entity} key`} /><input value={entityName} onChange={(event) => setEntityName(event.target.value)} placeholder={`${labels.entity} name`} /></div>
      <input value={evidenceIds} onChange={(event) => setEvidenceIds(event.target.value)} placeholder={labels.evidenceIds} />
      <button type="button" disabled={busy || !summary.trim()} onClick={() => void submit()}>{labels.create}</button>
    </div>
  </details>;
}
