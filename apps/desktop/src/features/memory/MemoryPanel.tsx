import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { errorMessage } from "../../shared/tauri/invokeTauri";
import type {
  BackupInspection,
  ContextExplainResponse,
  DiagnosticsResponse,
  LifecycleStatus,
  MaintenancePlan,
  MemoryCapability,
  MemoryRecord,
  MemoryRevision,
  ProjectStatusResponse,
  ProjectMemoryConfig,
  PromotePreviewResponse,
} from "./generated/adminV1";
import { memoryApi } from "./memoryApi";
import { negotiateMemoryCapabilities } from "./memoryCapabilities";

type MemoryPanelProps = { workspaceRoot: string; onClose: () => void };

export function MemoryPanel({ workspaceRoot, onClose }: MemoryPanelProps) {
  const { t } = useI18n();
  const requestGeneration = useRef(0);
  const [status, setStatus] = useState<ProjectStatusResponse | null>(null);
  const [capabilities, setCapabilities] = useState<Set<string>>(new Set());
  const [items, setItems] = useState<MemoryRecord[]>([]);
  const [selected, setSelected] = useState<MemoryRecord | null>(null);
  const [history, setHistory] = useState<MemoryRevision[]>([]);
  const [query, setQuery] = useState("");
  const [debouncedQuery, setDebouncedQuery] = useState("");
  const [lifecycle, setLifecycle] = useState<LifecycleStatus | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [relationTarget, setRelationTarget] = useState("");
  const [relationType, setRelationType] = useState<"SUPERSEDES" | "CONTRADICTS">("SUPERSEDES");
  const [task, setTask] = useState("");
  const [explanation, setExplanation] = useState<ContextExplainResponse | null>(null);
  const [promotion, setPromotion] = useState<PromotePreviewResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenancePlan | null>(null);
  const [backups, setBackups] = useState<BackupInspection[]>([]);
  const [config, setConfig] = useState<ProjectMemoryConfig | null>(null);

  const supports = useCallback((capability: MemoryCapability) => capabilities.has(capability), [capabilities]);

  useEffect(() => {
    const timeout = window.setTimeout(() => setDebouncedQuery(query.trim()), 250);
    return () => window.clearTimeout(timeout);
  }, [query]);

  const load = useCallback(async () => {
    if (!workspaceRoot) return;
    const generation = ++requestGeneration.current;
    setBusy(true);
    setError("");
    try {
      const hello = await memoryApi.hello(workspaceRoot);
      const negotiated = negotiateMemoryCapabilities(hello.apiVersion, hello.capabilities);
      if (!negotiated.compatible) throw new Error(`${t("memory.incompatible")} ${negotiated.missingCore.join(", ")}`);
      const [nextStatus, list] = await Promise.all([
        memoryApi.status(workspaceRoot),
        memoryApi.list(workspaceRoot, { ...(debouncedQuery ? { query: debouncedQuery } : {}), ...(lifecycle ? { status: lifecycle } : {}), limit: 100 }),
      ]);
      if (generation !== requestGeneration.current) return;
      setCapabilities(negotiated.available);
      setStatus(nextStatus);
      setItems(list.items);
      setSelected((current) => current ? list.items.find((item) => item.id === current.id) ?? null : null);
    } catch (loadError) {
      if (generation === requestGeneration.current) setError(errorMessage(loadError));
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }, [debouncedQuery, lifecycle, t, workspaceRoot]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => status?.counts ?? {}, [status]);

  const selectMemory = async (item: MemoryRecord) => {
    setSelected(item);
    setHistory([]);
    setPromotion(null);
    setError("");
    try {
      const [detail, revisions] = await Promise.all([
        memoryApi.get(workspaceRoot, item.id),
        supports("memories.history") ? memoryApi.history(workspaceRoot, item.id) : Promise.resolve({ items: [] }),
      ]);
      setSelected((current) => current?.id === item.id ? detail : current);
      setHistory(revisions.items);
    } catch (detailError) {
      setError(errorMessage(detailError));
    }
  };

  const mutate = async (action: () => Promise<MemoryRecord>, message: string) => {
    setBusy(true);
    setError("");
    try {
      const updated = await action();
      setSelected(updated);
      setNotice(message);
      setReason("");
      await load();
      if (supports("memories.history")) setHistory((await memoryApi.history(workspaceRoot, updated.id)).items);
    } catch (actionError) {
      setError(errorMessage(actionError));
    } finally {
      setBusy(false);
    }
  };

  const relate = async () => {
    if (!selected || !relationTarget.trim() || !reason.trim()) return;
    setBusy(true);
    try {
      await memoryApi.relate(workspaceRoot, selected.id, relationTarget.trim(), relationType, reason.trim());
      setNotice(t("memory.related"));
      setRelationTarget("");
      setReason("");
      await selectMemory(selected);
      await load();
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const explain = async () => {
    if (!task.trim()) return;
    setBusy(true);
    setError("");
    try { setExplanation(await memoryApi.explain(workspaceRoot, task.trim())); }
    catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const promote = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      if (!promotion) setPromotion(await memoryApi.promotePreview(workspaceRoot, selected.id));
      else {
        const result = await memoryApi.promote(workspaceRoot, selected.id, promotion.sha256);
        setNotice(`${t("memory.promoted")}: ${result.path}`);
        setPromotion(null);
      }
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const loadAdmin = async () => {
    setBusy(true);
    setError("");
    try {
      const [nextDiagnostics, nextBackups, nextConfig] = await Promise.all([
        supports("projects.diagnostics") ? memoryApi.diagnostics(workspaceRoot) : Promise.resolve(null),
        supports("backups.list") ? memoryApi.backups(workspaceRoot) : Promise.resolve({ items: [] }),
        supports("projects.config") ? memoryApi.config(workspaceRoot) : Promise.resolve(null),
      ]);
      setDiagnostics(nextDiagnostics);
      setBackups(nextBackups.items);
      setConfig(nextConfig);
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const maintain = async () => {
    setBusy(true);
    setError("");
    try {
      if (!maintenance || !maintenance.dryRun) setMaintenance(await memoryApi.maintenancePreview(workspaceRoot));
      else {
        const result = await memoryApi.maintenanceRun(workspaceRoot);
        setMaintenance(result);
        setNotice(t("memory.maintained"));
        await load();
      }
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const createBackup = async () => {
    setBusy(true);
    try {
      const created = await memoryApi.createBackup(workspaceRoot);
      setNotice(`${t("memory.backupCreated")}: ${created.fileName}`);
      setBackups((await memoryApi.backups(workspaceRoot)).items);
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const saveConfig = async () => {
    if (!config) return;
    setBusy(true);
    try {
      setConfig(await memoryApi.updateConfig(workspaceRoot, config.captureMode, config.rawEventRetentionDays));
      setNotice(t("memory.configSaved"));
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  return (
    <div className="memory-panel-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
      <section className="memory-panel" role="dialog" aria-modal="true" aria-label={t("memory.title")}>
        <header className="memory-panel-header">
          <div><h2>{t("memory.title")}</h2><span>{status?.project.name ?? t("memory.localEngine")}</span></div>
          <button type="button" onClick={onClose} aria-label={t("memory.close")}>×</button>
        </header>
        {!workspaceRoot ? <p className="memory-state">{t("memory.openWorkspace")}</p> : null}
        {error ? <p className="memory-error" role="alert">{error}</p> : null}
        {notice ? <p className="memory-notice">{notice}</p> : null}
        {workspaceRoot ? <div className="memory-panel-body">
          <aside className="memory-list-column">
            <div className="memory-overview">
              <span><strong>{counts.total ?? 0}</strong>{t("memory.total")}</span>
              <span><strong>{counts.active ?? 0}</strong>{t("memory.active")}</span>
              <span><strong>{counts.high_risk ?? 0}</strong>{t("memory.review")}</span>
            </div>
            <div className="memory-filters">
              <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={t("memory.search")} />
              <select value={lifecycle} onChange={(event) => setLifecycle(event.target.value as LifecycleStatus | "")}>
                <option value="">{t("memory.allStates")}</option><option value="ACTIVE">ACTIVE</option><option value="ARCHIVED">ARCHIVED</option><option value="SUPERSEDED">SUPERSEDED</option><option value="REJECTED">REJECTED</option>
              </select>
            </div>
            <div className="memory-list" aria-busy={busy}>
              {items.map((item) => <button type="button" key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => void selectMemory(item)}><span className="memory-list-meta">{item.type} · {item.lifecycleStatus} · {new Date(item.updatedAt).toLocaleDateString()}</span><strong>{item.summary}</strong></button>)}
              {!busy && items.length === 0 ? <p className="memory-state">{t("memory.empty")}</p> : null}
            </div>
          </aside>
          <article className="memory-detail">
            {selected ? <>
              <div className="memory-detail-meta">{selected.type} · {selected.verificationState} · {selected.correctnessRisk} · {selected.sourceType}</div>
              <h3>{selected.summary}</h3><pre>{selected.content}</pre>
              <dl className="memory-evidence">
                {selected.commitSha ? <><dt>Commit</dt><dd>{selected.commitSha}</dd></> : null}
                {selected.branchName ? <><dt>Branch</dt><dd>{selected.branchName}</dd></> : null}
                <dt>{t("memory.files")}</dt><dd>{selected.files.join(", ") || "—"}</dd>
                {selected.latestAssessment ? <><dt>Assessment</dt><dd>{selected.latestAssessment.reasonCodes.join(", ")} · {selected.latestAssessment.policyVersion}</dd></> : null}
              </dl>
              {selected.fileAnchors.length > 0 ? <details><summary>{t("memory.evidence")}</summary><pre>{JSON.stringify(selected.fileAnchors, null, 2)}</pre></details> : null}
              {selected.relations.length > 0 ? <details><summary>{t("memory.relations")}</summary><pre>{JSON.stringify(selected.relations, null, 2)}</pre></details> : null}
              {history.length > 0 ? <details><summary>{t("memory.history")} ({history.length})</summary>{history.map((revision) => <div className="memory-revision" key={revision.revision}><strong>#{revision.revision} · {revision.actor}</strong><span>{revision.reason} · {new Date(revision.createdAt).toLocaleString()}</span></div>)}</details> : null}
              <input className="memory-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("memory.reason")} />
              <div className="memory-actions">
                {supports("memories.verify") ? <><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.verify(workspaceRoot, selected.id, "VERIFIED", reason), t("memory.verified"))}>{t("memory.verify")}</button><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.verify(workspaceRoot, selected.id, "DISPUTED", reason), t("memory.disputed"))}>{t("memory.dispute")}</button></> : null}
                {selected.lifecycleStatus === "ARCHIVED" && supports("memories.restore") ? <button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.restore(workspaceRoot, selected.id, reason), t("memory.restored"))}>{t("memory.restore")}</button> : supports("memories.archive") ? <button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.archive(workspaceRoot, selected.id, reason), t("memory.archived"))}>{t("memory.archive")}</button> : null}
                {supports("knowledge.promote_preview") && supports("knowledge.promote") ? <button disabled={busy} type="button" onClick={() => void promote()}>{promotion ? t("memory.confirmPromote") : t("memory.promote")}</button> : null}
              </div>
              {supports("memories.relate") ? <div className="memory-relation-editor"><select value={relationType} onChange={(event) => setRelationType(event.target.value as "SUPERSEDES" | "CONTRADICTS")}><option value="SUPERSEDES">SUPERSEDES</option><option value="CONTRADICTS">CONTRADICTS</option></select><input value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)} placeholder={t("memory.targetId")} /><button disabled={busy || !reason.trim() || !relationTarget.trim()} onClick={() => void relate()} type="button">{t("memory.addRelation")}</button></div> : null}
              {promotion ? <section className="memory-promotion-preview"><strong>{t("memory.preview")}: {promotion.path}</strong><pre>{promotion.content}</pre></section> : null}
            </> : <p className="memory-state">{t("memory.select")}</p>}
            {supports("contexts.explain") ? <section className="memory-context-explain"><h3>{t("memory.contextExplain")}</h3><div><input value={task} onChange={(event) => setTask(event.target.value)} placeholder={t("memory.taskPlaceholder")} /><button disabled={busy || !task.trim()} type="button" onClick={() => void explain()}>{t("memory.explain")}</button></div>{explanation ? <><p>{t("memory.selectedCount").replace("{count}", String(explanation.selected))} · ~{explanation.estimatedTokens} tokens</p><p>Selected: {explanation.selectedMemoryIds.join(", ") || "—"}<br />Warnings: {explanation.warningMemoryIds.join(", ") || "—"}</p><pre>{explanation.markdown}</pre></> : null}</section> : null}
            <section className="memory-admin-tools"><h3>{t("memory.adminTools")}</h3><div className="memory-actions"><button type="button" disabled={busy} onClick={() => void loadAdmin()}>{t("memory.diagnostics")}</button>{supports("maintenance.preview") && supports("maintenance.run") ? <button type="button" disabled={busy} onClick={() => void maintain()}>{maintenance?.dryRun ? t("memory.confirmMaintenance") : t("memory.previewMaintenance")}</button> : null}{supports("backups.create") ? <button type="button" disabled={busy} onClick={() => void createBackup()}>{t("memory.createBackup")}</button> : null}</div>
              {diagnostics ? <pre>{JSON.stringify(diagnostics, null, 2)}</pre> : null}
              {config && supports("projects.config_update") ? <div className="memory-config"><label>{t("memory.captureMode")}<select value={config.captureMode} onChange={(event) => setConfig({ ...config, captureMode: event.target.value as ProjectMemoryConfig["captureMode"] })}><option value="off">off</option><option value="manual">manual</option><option value="summary">summary</option></select></label><label>{t("memory.retentionDays")}<input type="number" min="0" max="30" value={config.rawEventRetentionDays} onChange={(event) => setConfig({ ...config, rawEventRetentionDays: Number(event.target.value) })} /></label><button type="button" disabled={busy || config.rawEventRetentionDays < 0 || config.rawEventRetentionDays > 30} onClick={() => void saveConfig()}>{t("memory.saveConfig")}</button></div> : null}
              {maintenance ? <pre>{JSON.stringify(maintenance, null, 2)}</pre> : null}
              {backups.length > 0 ? <div className="memory-backups">{backups.map((backup) => <button type="button" key={backup.fileName} onClick={() => void memoryApi.verifyBackup(workspaceRoot, backup.fileName).then(() => setNotice(`${t("memory.backupVerified")}: ${backup.fileName}`)).catch((verifyError) => setError(errorMessage(verifyError)))}><strong>{backup.fileName}</strong><span>{backup.bytes} bytes · schema {backup.schemaVersion}</span></button>)}</div> : null}
            </section>
          </article>
        </div> : null}
      </section>
    </div>
  );
}
