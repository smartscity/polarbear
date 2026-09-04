import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import type { MemoryRecord, MemoryRevision } from "../generated/adminV1";
import {
  CONTEXT_SECTIONS,
  contextOverviewData,
  memoryDisplayState,
  matchesMemoryStatus,
  needsAttention,
  summarizeContextSources,
  tokenImpact,
  type ContextSection,
  type MemoryStatusFilter,
} from "./contextOsModel";
import { useContextOsSession } from "./useContextOsSession";

type ContextWorkspaceProps = {
  workspaceRoot: string;
  onOpenWorkspace: () => void;
};

export function ContextWorkspace({ workspaceRoot, onOpenWorkspace }: ContextWorkspaceProps) {
  const { t } = useI18n();
  const [section, setSection] = useState<ContextSection>("overview");
  const [memoryStatus, setMemoryStatus] = useState<MemoryStatusFilter>("all");
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
          <ContextOverview session={session} onReview={() => {
            setMemoryStatus("needsAttention");
            setSection("memory");
          }} />
        ) : section === "memory" ? (
          <ContextMemory session={session} status={memoryStatus} onStatusChange={setMemoryStatus} />
        ) : (
          <ContextSettings session={session} />
        )}
      </section>
    </main>
  );
}

function ContextWorkspaceIdentity({ name, path }: { name: string; path: string }) {
  const { t } = useI18n();
  const [copied, setCopied] = useState(false);
  const copyPath = async () => {
    try {
      await navigator.clipboard.writeText(path);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1_500);
    } catch {
      setCopied(false);
    }
  };
  return <header className="context-workspace-identity">
    <h1>{t("context.surface")}</h1>
    <strong>{name}</strong>
    <button type="button" title={t("context.copyProjectPath")} onClick={() => void copyPath()}>
      <code>{path}</code>
      <span>{copied ? t("context.pathCopied") : t("context.copyProjectPath")}</span>
    </button>
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

function ContextOverview({ session, onReview }: { session: Session; onReview: () => void }) {
  const { t } = useI18n();
  const overview = contextOverviewData(session.memories, session.metrics);
  const packet = session.lastPacket;
  const sources = summarizeContextSources(packet);
  const reusedMemories = packet?.items.filter((item) => item.sourceType === "MEMORY").length ?? 0;
  const impact = session.tokenSavings
    ? tokenImpact(session.tokenSavings.baselineTokens, session.tokenSavings.contextTokens)
    : null;
  const configuredBudget = session.config?.defaultContextBudget;
  const budgetMode = session.config?.contextBudgetMode === "custom"
    ? t("context.overview.customBudget")
    : t("context.overview.autoBudget");

  return <div className="context-page context-overview-page" aria-busy={session.isLoading}>
    <section className="context-metric-row" aria-label={t("context.overview.coreMetrics")}>
      <Metric
        label={t("context.overview.currentContext")}
        value={packet
          ? `${packet.estimatedTokens.toLocaleString()} / ${packet.maxTokens.toLocaleString()}`
          : `— / ${configuredBudget?.toLocaleString() ?? "—"}`}
        hint={`${t("context.overview.memoryCount", { count: reusedMemories })} · ${budgetMode}`}
      />
      <Metric
        label={t("context.overview.memoryReuse")}
        value={reusedMemories.toLocaleString()}
        hint={t("context.overview.thisContext")}
      />
      <Metric
        label={impact?.kind === "impact" ? t("context.overview.tokenImpact") : t("context.overview.tokenSavings")}
        value={impact
          ? `${percent(impact.ratio)} ${impact.kind === "impact" ? t("context.overview.more") : t("context.overview.saved")}`
          : "—"}
        hint={t("context.overview.comparedBaseline")}
      />
    </section>
    <ContextSection title={t("context.overview.activation")} className="context-source-summary">
      <ul>
        <li>
          <span>{t("context.overview.activeTask")}</span>
          <strong>{session.activeTaskTitle || t("context.overview.noActiveTask")}</strong>
        </li>
        <li>
          <span>{t("context.overview.delivery")}</span>
          <strong>{session.contextReceipt
            ? t(`context.overview.delivery.${session.contextReceipt.status.toLocaleLowerCase()}`)
            : t("context.overview.delivery.none")}</strong>
        </li>
        <li>
          <span>{t("context.overview.sessionBoundary")}</span>
          <strong>{session.safeToReplaceSession
            ? t("context.overview.safeToReplace")
            : t("context.overview.notSafeToReplace")}</strong>
        </li>
      </ul>
      {session.latestCheckpointId
        ? <p>{t("context.overview.checkpointId", { id: session.latestCheckpointId })}</p>
        : <p>{t("context.overview.noCheckpoint")}</p>}
    </ContextSection>
    <ContextSection title={t("context.overview.sources")} className="context-source-summary">
      {sources.length > 0 ? <ul>{sources.map((source) => <li key={source.category}>
        <span>{t(`context.source.${source.category.toLocaleLowerCase()}`)}</span>
        <strong>{source.tokens.toLocaleString()} {t("context.tokens")}</strong>
      </li>)}</ul> : <p>{t("context.overview.noSources")}</p>}
    </ContextSection>
    <ContextSection
      title={overview.needsAttentionCount === 0 ? t("context.overview.health") : t("context.overview.attention")}
      className={overview.needsAttentionCount === 0 ? "context-health-summary healthy" : "context-health-summary attention"}
    >
      <strong>{overview.needsAttentionCount === 0 ? `✓ ${t("context.overview.healthClear")}` : `! ${t("context.overview.healthAttention")}`}</strong>
      <p>{overview.needsAttentionCount === 0
        ? t("context.overview.noAttention")
        : t("context.overview.needsAttention", { count: overview.needsAttentionCount })}</p>
      {overview.needsAttentionCount > 0 ? <button type="button" onClick={onReview}>{t("context.overview.review")}</button> : null}
    </ContextSection>
  </div>;
}

function ContextMemory({
  session,
  status,
  onStatusChange,
}: {
  session: Session;
  status: MemoryStatusFilter;
  onStatusChange: (status: MemoryStatusFilter) => void;
}) {
  const { t } = useI18n();
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MemoryRecord | null>(null);
  const [history, setHistory] = useState<MemoryRevision[]>([]);
  const [editing, setEditing] = useState(false);
  const [summary, setSummary] = useState("");
  const [content, setContent] = useState("");

  const items = useMemo(() => session.memories.filter((memory) => {
    const haystack = `${memory.summary}\n${memory.content}`.toLocaleLowerCase();
    return matchesMemoryStatus(memory, status)
      && haystack.includes(query.trim().toLocaleLowerCase());
  }), [query, session.memories, status]);

  useEffect(() => {
    if (!selected) return;
    const current = session.memories.find((memory) => memory.id === selected.id);
    setSelected(current ?? null);
  }, [selected, session.memories]);

  const select = async (memory: MemoryRecord, edit = false) => {
    setSelected(memory);
    setEditing(edit);
    setSummary(memory.summary);
    setContent(memory.content);
    const loaded = await session.loadMemoryHistory(memory.id);
    if (loaded) setHistory(loaded.items);
  };

  const save = async () => {
    if (!selected || !summary.trim() || !content.trim()) return;
    const updated = await session.updateMemory(
      selected.id,
      summary.trim(),
      content.trim(),
      "Edited from Polarbear Desktop.",
    );
    if (updated) {
      setSelected(updated);
      const loaded = await session.loadMemoryHistory(updated.id);
      if (loaded) setHistory(loaded.items);
    }
    setEditing(false);
  };

  const confirm = async () => {
    if (!selected) return;
    const updated = await session.verifyMemory(selected.id, "VERIFIED", "Confirmed from Polarbear Desktop.");
    if (updated) {
      setSelected(updated);
      const loaded = await session.loadMemoryHistory(updated.id);
      if (loaded) setHistory(loaded.items);
    }
  };

  const archive = async (reason = "Archived from Polarbear Desktop.") => {
    if (!selected) return;
    const updated = await session.archiveMemory(selected.id, reason);
    if (updated) {
      setSelected(updated);
      const loaded = await session.loadMemoryHistory(updated.id);
      if (loaded) setHistory(loaded.items);
    }
  };

  const reject = async () => {
    if (!selected) return;
    const updated = await session.rejectMemory(selected.id, "Rejected from Polarbear Desktop after attention review.");
    if (updated) {
      setSelected(updated);
      const loaded = await session.loadMemoryHistory(updated.id);
      if (loaded) setHistory(loaded.items);
    }
  };

  return <div className="context-page context-memory-page" aria-busy={session.isLoading || session.isMutating}>
    <PageHeader title={t("context.memory.title")} description={t("context.memory.description")} />
    <div className="context-memory-layout">
      <aside className="context-memory-filters">
        <label>{t("context.memory.search")}<input value={query} placeholder={t("context.memory.searchPlaceholder")} onChange={(event) => setQuery(event.target.value)} /></label>
        <div className="context-memory-filter-tabs" role="tablist" aria-label={t("context.memory.status")}>
          {(["all", "needsAttention", "archived"] as const).map((filter) => <button
            type="button"
            role="tab"
            aria-selected={status === filter}
            className={status === filter ? "active" : ""}
            key={filter}
            onClick={() => onStatusChange(filter)}
          >{t(`context.memory.filter.${filter}`)}</button>)}
        </div>
      </aside>
      <div className="context-memory-list" role="list" aria-label={t("context.memory.list")}>
        {items.map((memory) => <button type="button" role="listitem" key={memory.id} className={selected?.id === memory.id ? "active" : ""} onClick={() => void select(memory)} onDoubleClick={() => void select(memory, true)}>
          <span>{memory.type}</span><strong>{memory.summary}</strong><small>{t(`context.memory.state.${memoryDisplayState(memory)}`)} · {t("context.memory.usedShort", { count: memory.usage.selectedCount })} · {new Date(memory.updatedAt).toLocaleDateString()}</small>
        </button>)}
        {items.length === 0 && !session.isLoading ? <p>{t("context.memory.empty")}</p> : null}
      </div>
      <article className="context-memory-detail">
        {selected ? <>
          <header><span>{selected.type} · {t(`context.memory.state.${memoryDisplayState(selected)}`)}</span><h2>{editing ? t("context.memory.edit") : selected.summary}</h2></header>
          {!editing && selected.latestAssessment?.reasonCodes.includes("HUMAN_VERIFIED_CURRENT_SOURCE") ? <p className="context-confirmed-state">✓ {t("context.memory.confirmedByYou")} · {new Date(selected.latestAssessment.assessedAt).toLocaleString()}</p> : null}
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
          <details open><summary>{t("context.memory.history")}</summary><div className="context-detail-list">
            {history.length > 0 ? history.map((revision) => <span key={revision.revision}>{t("context.memory.revision", { revision: revision.revision })} · {new Date(revision.createdAt).toLocaleString()} · {revision.reason}</span>) : <span>{t("context.memory.noHistory")}</span>}
          </div></details>
          <div className="context-action-row">
            {editing ? <>
              <button type="button" disabled={session.isMutating || !summary.trim() || !content.trim()} onClick={() => void save()}>{t("context.memory.save")}</button>
              <button type="button" disabled={session.isMutating} onClick={() => setEditing(false)}>{t("common.cancel")}</button>
            </> : needsAttention(selected) ? <>
              <button type="button" disabled={session.isMutating} onClick={() => void confirm()}>{t("context.memory.confirm")}</button>
              <button type="button" disabled={session.isMutating} onClick={() => void reject()}>{t("context.memory.reject")}</button>
              <MemoryActions disabled={session.isMutating} onArchive={() => void archive()} />
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

function ContextSettings({ session }: { session: Session }) {
  const { t } = useI18n();
  const { refreshIntegrations } = session;
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

  useEffect(() => {
    void refreshIntegrations();
  }, [refreshIntegrations]);

  return <div className="context-page context-settings-page" aria-busy={session.isLoading || session.isMutating}>
    <PageHeader title={t("context.settings.title")} description={t("context.settings.description")} />
    <div className="context-settings-content">
      <ContextSection title={t("context.settings.context")}>
        <div className="context-settings-form">
          <fieldset className="context-budget-options"><legend>{t("context.settings.contextBudgetMode")}</legend>
            <label><input type="radio" name="context-budget" value="auto" checked={budgetMode === "auto"} onChange={() => setBudgetMode("auto")} />{t("context.settings.contextBudgetRecommended")}</label>
            <label><input type="radio" name="context-budget" value="custom" checked={budgetMode === "custom"} onChange={() => setBudgetMode("custom")} />{t("context.settings.contextBudgetCustom")}</label>
          </fieldset>
          {budgetMode === "custom" ? <label>{t("context.settings.customBudget")}<input type="number" min="400" max="12000" value={customBudget} onChange={(event) => setCustomBudget(Number(event.target.value))} /></label> : null}
        </div>
      </ContextSection>
      <ContextSection title={t("context.settings.memory")}>
        <div className="context-settings-form">
          <label>{t("context.settings.captureMode")}<select value={captureMode} onChange={(event) => setCaptureMode(event.target.value as typeof captureMode)}><option value="summary">{t("context.settings.captureAutomatic")}</option><option value="manual">{t("context.settings.captureManual")}</option><option value="off">{t("context.settings.captureOff")}</option></select></label>
          <div className="context-setting-summary"><span>{t("context.settings.rawHistory")}</span><strong>{t("context.settings.days", { count: retentionDays })}</strong></div>
          <p>{t("context.settings.durableMemoryHint")}</p>
          <button type="button" disabled={session.isMutating || (budgetMode === "custom" && (customBudget < 400 || customBudget > 12_000))} onClick={() => void session.updateConfig({ captureMode, rawEventRetentionDays: retentionDays, contextBudgetMode: budgetMode, defaultContextBudget: customBudget })}>{t("context.settings.save")}</button>
        </div>
      </ContextSection>
      <ContextSection title={t("context.settings.connections")}>
        <div className="context-integration-list">{session.integrations.map((integration) => <details className="context-integration-row" key={integration.id}>
          <summary><strong>{integration.name}</strong><span>{integration.status === "CONNECTED" ? t("context.settings.connected") : t("context.settings.needsAttention")}</span></summary>
          <dl className="context-detail-grid">
            <dt>{t("context.settings.mcp")}</dt><dd>{t(`context.settings.integration.${integration.mcp.toLocaleLowerCase()}`)}</dd>
            <dt>{t("context.settings.runtime")}</dt><dd>{t(`context.settings.integration.${integration.runtime.toLocaleLowerCase()}`)}</dd>
            <dt>{t("context.settings.handshake")}</dt><dd>{t(`context.settings.integration.${integration.handshake.toLocaleLowerCase()}`)}</dd>
          </dl>
          {integration.detail ? <p>{t(`context.settings.integration.detail.${integration.detail.toLocaleLowerCase()}`)}</p> : null}
          {integration.status === "NEEDS_ATTENTION" ? <div className="context-action-row">
            <button type="button" disabled={session.isMutating} onClick={() => void session.refresh()}>{t("context.retry")}</button>
            <button type="button" disabled={session.isMutating} onClick={() => void session.repairIntegration(integration.id)}>{t("context.settings.repair")}</button>
            <button type="button" disabled={session.isMutating} onClick={() => void session.runDiagnostics()}>{t("context.settings.runDiagnostics")}</button>
          </div> : null}
        </details>)}</div>
        {session.diagnostics ? <p className="context-subtle">{t("context.settings.diagnosticsResult", { engine: session.diagnostics.engineVersion, api: session.diagnostics.apiVersion })}</p> : null}
      </ContextSection>
      <details className="context-settings-advanced"><summary>{t("context.settings.advanced")}</summary>
        <label>{t("context.settings.retentionDays")}<input type="number" min="0" max="30" value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value))} /><small>{t("context.settings.rawEventsHint")}</small></label>
        <p>{t("context.settings.storageManaged")}</p>
        <p>{t("context.settings.storagePrivacy")}</p>
      </details>
    </div>
  </div>;
}

function MemoryActions({ disabled, onArchive }: { disabled: boolean; onArchive: () => void }) {
  const { t } = useI18n();
  return <details className="context-memory-actions-menu">
    <summary title={t("context.memory.moreActions")} aria-label={t("context.memory.moreActions")}>•••</summary>
    <button type="button" disabled={disabled} onClick={onArchive}>{t("context.memory.archive")}</button>
  </details>;
}

function ContextSection({ title, children, className = "" }: { title: string; children: ReactNode; className?: string }) {
  return <section className={`context-section ${className}`}><h2>{title}</h2>{children}</section>;
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
