import type { MemoryRecord } from "./generated/adminV1";

type Props = { memory: MemoryRecord; labels: { files: string; anchors: string; evidence: string; entities: string; relations: string; validity: string } };

export function MemoryKnowledgeDetails({ memory, labels }: Props) {
  return <>
    <dl className="memory-evidence">
      {memory.commitSha ? <><dt>Commit</dt><dd>{memory.commitSha}</dd></> : null}
      {memory.branchName ? <><dt>Branch</dt><dd>{memory.branchName}</dd></> : null}
      <dt>{labels.files}</dt><dd>{memory.files.join(", ") || "—"}</dd>
      <dt>{labels.validity}</dt><dd>{memory.validFrom ?? "—"} → {memory.validTo ?? "∞"}</dd>
      {memory.latestAssessment ? <><dt>Assessment</dt><dd>{memory.latestAssessment.reasonCodes.join(", ")} · {memory.latestAssessment.policyVersion}</dd></> : null}
    </dl>
    {memory.fileAnchors.length > 0 ? <details><summary>{labels.anchors}</summary><pre>{JSON.stringify(memory.fileAnchors, null, 2)}</pre></details> : null}
    {memory.evidence.length > 0 ? <details><summary>{labels.evidence}</summary><pre>{JSON.stringify(memory.evidence, null, 2)}</pre></details> : null}
    {memory.entities.length > 0 ? <details><summary>{labels.entities}</summary><pre>{JSON.stringify(memory.entities, null, 2)}</pre></details> : null}
    {memory.relations.length > 0 ? <details><summary>{labels.relations}</summary><pre>{JSON.stringify(memory.relations, null, 2)}</pre></details> : null}
  </>;
}
