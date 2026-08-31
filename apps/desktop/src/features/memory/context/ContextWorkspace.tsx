import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import type {
  ContextExplanation,
  ContextPacket,
  ExecutionRun,
  MemoryRecord,
  MemoryType,
  TaskCheckpoint,
  TaskPhase,
  TaskRunContext,
  TaskStatus,
} from "../generated/adminV1";
import {
  CONTEXT_SECTIONS,
  contextOverviewData,
  matchesMemoryStatus,
  needsAttention,
  tokenImpact,
  type ContextSection,
  type MemoryStatusFilter,
} from "./contextOsModel";
import { useContextOsSession } from "./useContextOsSession";

const MEMORY_TYPES: MemoryType[] = [
  "DECISION",
  "CONSTRAINT",
  "ARCHITECTURE",
  "FACT",
  "PITFALL",
];

const TASK_PHASES: TaskPhase[] = [
  "DISCOVERY",
  "DESIGN",
  "IMPLEMENTATION",
  "DEBUGGING",
  "VERIFICATION",
  "REVIEW",
  "DOCUMENTATION",
];

const TASK_STATUSES: TaskStatus[] = [
  "PLANNED",
  "ACTIVE",
  "BLOCKED",
  "VERIFYING",
  "DONE",
  "CANCELLED",
];

type ContextWorkspaceProps = {
  workspaceRoot: string;
  onOpenWorkspace: () => void;
};

type TaskActivity = {
  checkpoints: TaskCheckpoint[];
  runs: ExecutionRun[];
};

type TaskRunInspection = {
  context: TaskRunContext;
  explanation: ContextExplanation | null;
};

export function ContextWorkspace({ workspaceRoot, onOpenWorkspace }: ContextWorkspaceProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<ContextSection>("overview");
  const session = useContextOsSession(workspaceRoot);

  return (
    <main className="context-workspace">
      <aside className="context-secondary-nav">
        <div className="context-secondary-nav-heading">
          <span>{t("context.surface")}</span>
          <button
            type="button"
            className="context-refresh-button"
            title={t("context.refresh")}
            aria-label={t("context.refresh")}
            disabled={!workspaceRoot || session.isLoading}
            onClick={() => void session.refresh()}
          >
            <RefreshIcon />
          </button>
        </div>
        <nav aria-label={t("context.navigation")}>
          {CONTEXT_SECTIONS.map((item) => (
            <button
              type="button"
              key={item}
              className={section === item ? "active" : ""}
              aria-current={section === item ? "page" : undefined}
              onClick={() => setSection(item)}
            >
              {t(`context.nav.${item}`)}
            </button>
          ))}
        </nav>
      </aside>
      <section className="context-main-content">
        {workspaceRoot && session.hello && session.error ? <div className="context-inline-error" role="alert">{session.error}</div> : null}
        {workspaceRoot && session.hello ? <ContextWorkspaceIdentity
          name={session.status?.project.name ?? workspaceRoot.split(/[\\/]/u).filter(Boolean).at(-1) ?? workspaceRoot}
          path={workspaceRoot}
        /> : null}
        {!workspaceRoot ? (
          <ContextEmptyState onOpenWorkspace={onOpenWorkspace} />
        ) : session.error && !session.hello ? (
          <ContextError error={session.error} onRetry={() => void session.refresh()} />
        ) : section === "overview" ? (
          <ContextOverview session={session} />
        ) : section === "memory" ? (
          <ContextMemory session={session} />
        ) : section === "tasks" ? (
          <ContextTasks session={session} />
        ) : (
          <ContextSettings session={session} />
        )}
      </section>
    </main>
  );
}

function ContextWorkspaceIdentity({ name, path }: { name: string; path: string }) {
  const { t } = useI18n();
  return <header className="context-workspace-identity">
    <h1>{t("context.surface")}</h1>
    <strong>{name}</strong>
    <span title={path}>{path}</span>
  </header>;
}

type Session = ReturnType<typeof useContextOsSession>;

function ContextEmptyState({ onOpenWorkspace }: { onOpenWorkspace: () => void }) {
  const { t } = useI18n();
  return <section className="context-empty-state">
    <h1>{t("context.emptyTitle")}</h1>
    <p>{t("context.emptyDescription")}</p>
    <button type="button" onClick={onOpenWorkspace}>{t("context.openWorkspace")}</button>
  </section>;
}

function ContextError({ error, onRetry }: { error: string; onRetry: () => void }) {
  const { t } = useI18n();
  return <section className="context-empty-state context-error-state">
    <h1>{t("context.unavailableTitle")}</h1>
    <p>{error}</p>
    <button type="button" onClick={onRetry}>{t("context.retry")}</button>
  </section>;
}

function ContextOverview({ session }: { session: Session }) {
  const { t } = useI18n();
  const overview = contextOverviewData(session.tasks, session.memories, session.metrics);
  const packet = session.lastPacket;
  const recent = [...session.memories, ...session.tasks]
    .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))
    .slice(0, 6);
  const metrics = session.metrics;
  const impact = session.tokenSavings
    ? tokenImpact(session.tokenSavings.baselineTokens, session.tokenSavings.contextTokens)
    : null;

  return <div className="context-page context-overview-page" aria-busy={session.isLoading}>
    <PageHeader title={t("context.overview.title")} description={t("context.overview.description")} />
    <section className="context-overview-primary">
      <ContextSection title={t("context.overview.activeTask")}>
        {overview.activeTask ? <>
          <h2>{overview.activeTask.title}</h2>
          <p className="context-emphasis">{overview.activeTask.status} · {overview.activeTask.phase}</p>
          <p>{overview.activeTask.objective}</p>
          <span>{overview.activeTask.lastCheckpointId
            ? t("context.overview.checkpointId", { id: overview.activeTask.lastCheckpointId })
            : t("context.overview.noCheckpoint")}</span>
        </> : <p>{t("context.overview.noActiveTask")}</p>}
      </ContextSection>
      <ContextSection title={t("context.overview.currentContext")}>
        {packet ? <>
          <strong>{packet.estimatedTokens.toLocaleString()} / {packet.maxTokens.toLocaleString()} {t("context.tokens")}</strong>
          <p>{t("context.overview.packetItems", { count: packet.items.length })}</p>
          <span>{t("context.overview.packetSessionOnly")}</span>
        </> : <>
          <strong>— / {session.config?.defaultContextBudget.toLocaleString() ?? "—"} {t("context.tokens")}</strong>
          <p>{t("context.overview.noPacket")}</p>
          <span>{t("context.overview.defaultBudget")}</span>
        </>}
      </ContextSection>
      <ContextSection title={t("context.overview.health")}>
        <strong>{overview.needsAttentionCount === 0 ? t("context.overview.healthClear") : t("context.overview.healthAttention")}</strong>
        <p>{overview.needsAttentionCount === 0
          ? t("context.overview.noAttention")
          : t("context.overview.needsAttention", { count: overview.needsAttentionCount })}</p>
        <span>{t("context.overview.conflicts", { count: overview.conflictCount })}</span>
      </ContextSection>
    </section>
    <section className="context-metric-row" aria-label={t("context.overview.coreMetrics")}>
      <Metric
        label={impact?.kind === "impact" ? t("context.overview.tokenImpact") : t("context.overview.tokenSavings")}
        value={impact ? `${percent(impact.ratio)}${impact.kind === "impact" ? ` ${t("context.overview.more")}` : ""}` : "—"}
        hint={t("context.overview.estimatedMetric")}
      />
      <Metric label={t("context.overview.memoryReuse")} value={metrics ? percent(metrics.memoryHitRate) : "—"} hint={t("context.overview.derivedMetric")} />
      <Metric label={t("context.overview.contextDelivered")} value={session.tokenSavings ? session.tokenSavings.contextTokens.toLocaleString() : "—"} hint={t("context.overview.estimatedMetric")} />
    </section>
    <ContextSection title={t("context.overview.recentActivity")} className="context-recent-activity">
      {recent.length > 0 ? <ul>
        {recent.map((item) => <li key={item.id}>
          <strong>{"summary" in item ? item.type : item.status}</strong>
          <span>{"summary" in item ? item.summary : item.title}</span>
          <time dateTime={item.updatedAt}>{new Date(item.updatedAt).toLocaleString()}</time>
        </li>)}
      </ul> : <p>{t("context.overview.noRecentActivity")}</p>}
    </ContextSection>
  </div>;
}

function ContextMemory({ session }: { session: Session }) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [type, setType] = useState<MemoryType | "all">("all");
  const [status, setStatus] = useState<MemoryStatusFilter>("all");
  const [selected, setSelected] = useState<MemoryRecord | null>(null);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");

  const items = useMemo(() => session.memories.filter((memory) => {
    const haystack = `${memory.summary}\n${memory.content}`.toLocaleLowerCase();
    return (type === "all" || memory.type === type)
      && matchesMemoryStatus(memory, status)
      && haystack.includes(query.trim().toLocaleLowerCase());
  }), [query, session.memories, status, type]);

  useEffect(() => {
    if (selected && !session.memories.some((memory) => memory.id === selected.id)) {
      setSelected(null);
    }
  }, [selected, session.memories]);

  const select = (memory: MemoryRecord, edit = false) => {
    setSelected(memory);
    setEditing(edit);
    setSummary(memory.summary);
    setContent(memory.content);
  };

  const save = async () => {
    if (!selected || !summary.trim() || !content.trim()) return;
    const updated = await session.updateMemory(
      selected.id,
      summary.trim(),
      content.trim(),
      "Edited from Polarbear Desktop.",
    );
    if (updated) setSelected(updated);
    setEditing(false);
  };

  const confirm = async () => {
    if (!selected) return;
    const updated = await session.verifyMemory(selected.id, "VERIFIED", "Confirmed from Polarbear Desktop.");
    if (updated) setSelected(updated);
  };

  const archive = async (reason = "Archived from Polarbear Desktop.") => {
    if (!selected) return;
    const updated = await session.archiveMemory(selected.id, reason);
    if (updated) setSelected(updated);
  };

  return <div className="context-page context-memory-page" aria-busy={session.isLoading || session.isMutating}>
    <PageHeader title={t("context.memory.title")} description={t("context.memory.description")} />
    <div className="context-memory-layout">
      <aside className="context-memory-filters">
        <label>{t("context.memory.search")}<input value={query} onChange={(event) => setQuery(event.target.value)} /></label>
        <label>{t("context.memory.type")}<select value={type} onChange={(event) => setType(event.target.value as MemoryType | "all")}>
          <option value="all">{t("context.memory.allTypes")}</option>
          {MEMORY_TYPES.map((item) => <option value={item} key={item}>{item}</option>)}
        </select></label>
        <label>{t("context.memory.status")}<select value={status} onChange={(event) => setStatus(event.target.value as MemoryStatusFilter)}>
          <option value="all">{t("context.memory.allStates")}</option>
          <option value="active">{t("context.memory.active")}</option>
          <option value="needsAttention">{t("context.memory.needsAttention")}</option>
          <option value="stale">{t("context.memory.stale")}</option>
          <option value="superseded">{t("context.memory.superseded")}</option>
        </select></label>
      </aside>
      <div className="context-memory-list" role="list" aria-label={t("context.memory.list")}>
        {items.map((memory) => <button type="button" role="listitem" key={memory.id} className={selected?.id === memory.id ? "active" : ""} onClick={() => select(memory)} onDoubleClick={() => select(memory, true)}>
          <span>{memory.type} · {memory.lifecycleStatus}</span><strong>{memory.summary}</strong><small>{needsAttention(memory) ? t("context.memory.needsAttention") : t("context.memory.active")} · {new Date(memory.updatedAt).toLocaleString()}</small>
        </button>)}
        {items.length === 0 && !session.isLoading ? <p>{t("context.memory.empty")}</p> : null}
      </div>
      <article className="context-memory-detail">
        {selected ? <>
          <header><span>{selected.type} · {selected.lifecycleStatus}</span><h2>{editing ? t("context.memory.edit") : selected.summary}</h2></header>
          {editing ? <div className="context-memory-editor"><input value={summary} onChange={(event) => setSummary(event.target.value)} /><textarea value={content} onChange={(event) => setContent(event.target.value)} /></div> : <pre>{selected.content}</pre>}
          <dl className="context-detail-grid">
            <dt>{t("context.memory.confidence")}</dt><dd>{selected.confidence}</dd>
            <dt>{t("context.memory.created")}</dt><dd>{new Date(selected.createdAt).toLocaleString()}</dd>
            <dt>{t("context.memory.updated")}</dt><dd>{new Date(selected.updatedAt).toLocaleString()}</dd>
            <dt>{t("context.memory.lastVerified")}</dt><dd>{selected.lastAssessedAt ? new Date(selected.lastAssessedAt).toLocaleString() : "—"}</dd>
            <dt>{t("context.memory.usage")}</dt><dd>{t("context.memory.usedInRuns", { count: selected.usage.selectedCount })}</dd>
          </dl>
          <details open><summary>{t("context.memory.provenance")}</summary><div className="context-detail-list">
            <span>{t("context.memory.sourceType")}: {selected.sourceType}</span>
            {selected.commitSha ? <span>{t("context.memory.commit")}: {selected.commitSha}</span> : null}
            {selected.files.map((file) => <span key={file}>{t("context.memory.file")}: {file}</span>)}
            {selected.evidence.map(({ evidence }) => <span key={evidence.id}>{evidence.type}: {evidence.sourceRef ?? evidence.id}</span>)}
          </div></details>
          <details open><summary>{t("context.memory.related")}</summary><div className="context-detail-list">
            {selected.relations.length > 0 ? selected.relations.map((relation) => <span key={`${relation.type}-${relation.targetMemoryId}`}>{relation.type} {relation.targetMemoryId}</span>) : <span>{t("context.memory.noRelations")}</span>}
            {selected.entities.map(({ entity }) => <span key={entity.id}>{entity.kind}: {entity.displayName}</span>)}
          </div></details>
          <div className="context-action-row">
            {editing ? <>
              <button type="button" disabled={session.isMutating || !summary.trim() || !content.trim()} onClick={() => void save()}>{t("context.memory.save")}</button>
              <button type="button" disabled={session.isMutating} onClick={() => setEditing(false)}>{t("common.cancel")}</button>
            </> : needsAttention(selected) ? <>
              <button type="button" disabled={session.isMutating} onClick={() => void confirm()}>{t("context.memory.confirm")}</button>
              <button type="button" disabled={session.isMutating} onClick={() => void archive("Rejected from Polarbear Desktop after attention review.")}>{t("context.memory.reject")}</button>
            </> : selected.lifecycleStatus === "ACTIVE" ? <details className="context-memory-actions-menu">
              <summary title={t("context.memory.moreActions")} aria-label={t("context.memory.moreActions")}>•••</summary>
              <button type="button" disabled={session.isMutating} onClick={() => void archive()}>{t("context.memory.archive")}</button>
            </details> : null}
          </div>
        </> : <p>{t("context.memory.select")}</p>}
      </article>
    </div>
  </div>;
}

function ContextTasks({ session }: { session: Session }) {
  const { t } = useI18n();
  const { inspectTaskRun, loadTaskActivity } = session;
  const [selectedId, setSelectedId] = useState("");
  const [title, setTitle] = useState("");
  const [objective, setObjective] = useState("");
  const [initialPhase, setInitialPhase] = useState<TaskPhase>("IMPLEMENTATION");
  const [checkpointSummary, setCheckpointSummary] = useState("");
  const [nextSteps, setNextSteps] = useState("");
  const [status, setStatus] = useState<TaskStatus>("ACTIVE");
  const [phase, setPhase] = useState<TaskPhase>("IMPLEMENTATION");
  const [contextRequest, setContextRequest] = useState("");
  const [activity, setActivity] = useState<TaskActivity | null>(null);
  const [runInspection, setRunInspection] = useState<TaskRunInspection | null>(null);
  const selected = session.tasks.find((task) => task.id === selectedId) ?? null;
  const constraints = session.memories.filter((memory) => memory.type === "CONSTRAINT" && memory.lifecycleStatus === "ACTIVE").slice(0, 5);

  useEffect(() => {
    if (!selectedId && session.tasks[0]) setSelectedId(session.tasks[0].id);
  }, [selectedId, session.tasks]);

  useEffect(() => {
    if (selected) {
      setStatus(selected.status);
      setPhase(selected.phase);
    }
  }, [selected]);

  useEffect(() => {
    let cancelled = false;
    setRunInspection(null);
    if (!selected) {
      setActivity(null);
      return () => {
        cancelled = true;
      };
    }

    void loadTaskActivity(selected.id).then((nextActivity) => {
      if (!cancelled && nextActivity) setActivity(nextActivity);
    });
    return () => {
      cancelled = true;
    };
  }, [loadTaskActivity, selected]);

  const create = async () => {
    if (!title.trim() || !objective.trim()) return;
    const task = await session.createTask({ title: title.trim(), objective: objective.trim(), phase: initialPhase });
    if (task) {
      setTitle("");
      setObjective("");
      setSelectedId(task.id);
    }
  };

  const checkpoint = async () => {
    if (!selected || !checkpointSummary.trim()) return;
    const saved = await session.saveCheckpoint({
      taskId: selected.id,
      status,
      phase,
      summary: checkpointSummary.trim(),
      nextSteps: nextSteps.split("\n").map((item) => item.trim()).filter(Boolean),
    });
    if (saved) {
      setCheckpointSummary("");
      setNextSteps("");
      const nextActivity = await loadTaskActivity(selected.id);
      if (nextActivity) setActivity(nextActivity);
    }
  };

  const inspectRun = async (run: ExecutionRun) => {
    if (!selected) return;
    const inspection = await inspectTaskRun(selected.id, run.id);
    if (inspection) setRunInspection(inspection);
  };

  const latestCheckpoint = activity?.checkpoints[0]
    ?? (session.lastCheckpoint?.taskId === selected?.id ? session.lastCheckpoint : null);

  return <div className="context-page context-tasks-page" aria-busy={session.isLoading || session.isMutating}>
    <PageHeader title={t("context.tasks.title")} description={t("context.tasks.description")} />
    <div className="context-tasks-layout">
      <aside className="context-task-list">
        <div className="context-create-task">
          <input value={title} placeholder={t("context.tasks.newTitle")} onChange={(event) => setTitle(event.target.value)} />
          <textarea value={objective} placeholder={t("context.tasks.newObjective")} onChange={(event) => setObjective(event.target.value)} />
          <select value={initialPhase} onChange={(event) => setInitialPhase(event.target.value as TaskPhase)}>{TASK_PHASES.map((item) => <option key={item}>{item}</option>)}</select>
          <button type="button" disabled={session.isMutating || !title.trim() || !objective.trim()} onClick={() => void create()}>{t("context.tasks.create")}</button>
        </div>
        {session.tasks.map((task) => <button type="button" key={task.id} className={task.id === selectedId ? "active" : ""} onClick={() => setSelectedId(task.id)}><span>{task.status} · {task.phase}</span><strong>{task.title}</strong></button>)}
      </aside>
      <article className="context-task-detail">
        {selected ? <>
          <header><span>{selected.status} · {selected.phase}</span><h2>{selected.title}</h2></header>
          <ContextDetail title={t("context.tasks.goal")}><p>{selected.objective}</p></ContextDetail>
          <ContextDetail title={t("context.tasks.currentState")}><p>{t("context.tasks.lastUpdated", { date: new Date(selected.updatedAt).toLocaleString() })}</p><p>{latestCheckpoint ? t("context.tasks.checkpointId", { id: latestCheckpoint.id }) : t("context.tasks.noCheckpoint")}</p></ContextDetail>
          <ContextDetail title={t("context.tasks.constraints")}><ul>{constraints.length > 0 ? constraints.map((constraint) => <li key={constraint.id}>{constraint.summary}</li>) : <li>{t("context.tasks.noConstraints")}</li>}</ul></ContextDetail>
          <ContextDetail title={t("context.tasks.checkpoint")}><div className="context-checkpoint-editor"><select value={status} onChange={(event) => setStatus(event.target.value as TaskStatus)}>{TASK_STATUSES.map((item) => <option key={item}>{item}</option>)}</select><select value={phase} onChange={(event) => setPhase(event.target.value as TaskPhase)}>{TASK_PHASES.map((item) => <option key={item}>{item}</option>)}</select><textarea value={checkpointSummary} placeholder={t("context.tasks.checkpointSummary")} onChange={(event) => setCheckpointSummary(event.target.value)} /><textarea value={nextSteps} placeholder={t("context.tasks.nextSteps")} onChange={(event) => setNextSteps(event.target.value)} /><button type="button" disabled={session.isMutating || !checkpointSummary.trim()} onClick={() => void checkpoint()}>{t("context.tasks.saveCheckpoint")}</button></div></ContextDetail>
          <ContextDetail title={t("context.tasks.checkpointHistory")}><ActivityList items={activity?.checkpoints ?? []} emptyLabel={t("context.tasks.noCheckpointHistory")} getItemKey={(checkpoint) => checkpoint.id} renderItem={(checkpoint) => <><strong>{checkpoint.status} · {checkpoint.phase}</strong><span>{checkpoint.summary}</span><time dateTime={checkpoint.createdAt}>{new Date(checkpoint.createdAt).toLocaleString()}</time></>} /></ContextDetail>
          <ContextDetail title={t("context.tasks.contextInspection")}><textarea value={contextRequest} placeholder={t("context.tasks.contextRequest")} onChange={(event) => setContextRequest(event.target.value)} /><button type="button" disabled={session.isMutating || !contextRequest.trim()} onClick={() => void session.inspectPacket({ currentRequest: contextRequest.trim(), taskId: selected.id, ...(session.config?.contextBudgetMode === "custom" ? { maxTokens: session.config.defaultContextBudget } : {}) })}>{t("context.tasks.inspectContext")}</button><PacketInspector packet={session.lastPacket} explanation={session.packetExplanation} /></ContextDetail>
          <ContextDetail title={t("context.tasks.recentRuns")}><ActivityList items={activity?.runs ?? []} emptyLabel={t("context.tasks.noRuns")} getItemKey={(run) => run.id} renderItem={(run) => <button type="button" onClick={() => void inspectRun(run)}><strong>{run.provider} · {run.status}</strong><span>{run.phase}{run.model ? ` · ${run.model}` : ""}</span><time dateTime={run.startedAt}>{new Date(run.startedAt).toLocaleString()}</time></button>} /></ContextDetail>
          {runInspection ? <ContextDetail title={t("context.tasks.runContext")}><PacketInspector packet={runInspection.context.packet ?? null} explanation={runInspection.explanation} emptyLabel={t("context.tasks.noRunContext")} /></ContextDetail> : null}
        </> : <p>{t("context.tasks.select")}</p>}
      </article>
    </div>
  </div>;
}

function ContextSettings({ session }: { session: Session }) {
  const { t } = useI18n();
  const [captureMode, setCaptureMode] = useState<"off" | "manual" | "summary">("manual");
  const [retentionDays, setRetentionDays] = useState(30);
  const [budgetMode, setBudgetMode] = useState<"auto" | "custom">("auto");
  const [customBudget, setCustomBudget] = useState(2_000);

  useEffect(() => {
    if (session.config) {
      setCaptureMode(session.config.captureMode);
      setRetentionDays(session.config.rawEventRetentionDays);
      setBudgetMode(session.config.contextBudgetMode);
      setCustomBudget(session.config.defaultContextBudget);
    }
  }, [session.config]);

  return <div className="context-page context-settings-page" aria-busy={session.isLoading || session.isMutating}>
    <PageHeader title={t("context.settings.title")} description={t("context.settings.description")} />
    <div className="context-settings-content">
      <ContextSection title={t("context.settings.connections")}>
        <div className="context-integration-list">{session.integrations.map((integration) => <div className="context-integration-row" key={integration.id}>
          <strong>{integration.name}</strong>
          <span>{integration.status === "CONNECTED" ? t("context.settings.connected") : t("context.settings.needsAttention")}</span>
          {integration.status === "NEEDS_ATTENTION" ? <button type="button" disabled={session.isMutating} onClick={() => void session.repairIntegration(integration.id)}>{t("context.settings.repair")}</button> : null}
        </div>)}</div>
      </ContextSection>
      <ContextSection title={t("context.settings.storage")}><p>{t("context.settings.storageManaged")}</p><span>{t("context.settings.storagePrivacy")}</span></ContextSection>
      <ContextSection title={t("context.settings.memoryBehavior")}>
        <div className="context-settings-form">
          <label>{t("context.settings.contextBudgetMode")}<select value={budgetMode} onChange={(event) => setBudgetMode(event.target.value as typeof budgetMode)}><option value="auto">{t("context.settings.contextBudgetAuto")}</option><option value="custom">{t("context.settings.contextBudgetCustom")}</option></select></label>
          {budgetMode === "custom" ? <label>{t("context.settings.customBudget")}<input type="number" min="400" max="12000" value={customBudget} onChange={(event) => setCustomBudget(Number(event.target.value))} /></label> : null}
          <label>{t("context.settings.captureMode")}<select value={captureMode} onChange={(event) => setCaptureMode(event.target.value as typeof captureMode)}><option value="off">{t("context.settings.captureOff")}</option><option value="manual">{t("context.settings.captureManual")}</option><option value="summary">{t("context.settings.captureSummary")}</option></select></label>
          <label>{t("context.settings.retentionDays")}<input type="number" min="0" max="30" value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value))} /><small>{t("context.settings.rawEventsHint")}</small></label>
          <p>{t("context.settings.durableMemoryHint")}</p>
          <button type="button" disabled={session.isMutating || retentionDays < 0 || retentionDays > 30 || customBudget < 400 || customBudget > 12_000} onClick={() => void session.updateConfig({ captureMode, rawEventRetentionDays: retentionDays, contextBudgetMode: budgetMode, defaultContextBudget: customBudget })}>{t("context.settings.save")}</button>
        </div>
      </ContextSection>
    </div>
  </div>;
}

function ActivityList<T>({
  items,
  emptyLabel,
  getItemKey,
  renderItem,
}: {
  items: readonly T[];
  emptyLabel: string;
  getItemKey: (item: T) => string;
  renderItem: (item: T) => ReactNode;
}) {
  if (items.length === 0) return <p className="context-subtle">{emptyLabel}</p>;
  return <div className="context-activity-list">{items.map((item) => <div className="context-activity-item" key={getItemKey(item)}>{renderItem(item)}</div>)}</div>;
}

function PacketInspector({
  packet,
  explanation,
  emptyLabel,
}: {
  packet: ContextPacket | null;
  explanation: ContextExplanation | null;
  emptyLabel?: string;
}) {
  const { t } = useI18n();
  if (!packet) return <p className="context-subtle">{emptyLabel ?? t("context.tasks.noPacket")}</p>;
  return <details className="context-packet-inspector" open><summary>{t("context.tasks.packetSummary", { tokens: packet.estimatedTokens, budget: packet.maxTokens })}</summary><dl className="context-detail-grid"><dt>{t("context.tasks.packetItems")}</dt><dd>{packet.items.length}</dd><dt>{t("context.tasks.packetHash")}</dt><dd>{packet.packetHash}</dd></dl><ul>{packet.items.map((item) => <li key={`${item.sourceId}-${item.rank}`}><strong>{item.category}</strong> {item.estimatedTokens} {t("context.tokens")} · {item.reason}</li>)}</ul>{explanation ? <details><summary>{t("context.tasks.excluded")}</summary><ul>{explanation.excluded.map((item) => <li key={`${item.sourceId}-${item.category}`}>{item.category} · {item.reason}</li>)}</ul></details> : null}<details><summary>{t("context.tasks.renderedContext")}</summary><pre>{packet.rendered}</pre></details></details>;
}

function ContextSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`context-section ${className}`}><h2>{title}</h2>{children}</section>;
}

function ContextDetail({ title, children }: { title: string; children: ReactNode }) {
  return <section className="context-detail-section"><h3>{title}</h3>{children}</section>;
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return <header className="context-page-header"><h1>{title}</h1><p>{description}</p></header>;
}

function Metric({ label, value, hint }: { label: string; value: string; hint: string }) {
  return <section className="context-metric"><span>{label}</span><strong>{value}</strong><small>{hint}</small></section>;
}

function RefreshIcon() {
  return <svg aria-hidden="true" viewBox="0 0 18 18"><path d="M14.5 8.25A5.75 5.75 0 1 0 14 11.5" /><path d="M14.5 4.5v3.75h-3.75" /></svg>;
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}
