import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../../shared/i18n/I18nProvider";
import { errorMessage } from "../../shared/tauri/invokeTauri";
import type {
  BackupInspection,
  BackupRestorePreview,
  ContextExplainResponse,
  DiagnosticsResponse,
  LifecycleStatus,
  MaintenancePlan,
  MemoryCapability,
  MemoryRelationType,
  MemoryPurgePreview,
  MemoryRecord,
  MemoryRevision,
  MemoryType,
  ProjectStatusResponse,
  ProjectMemoryConfig,
  PromotePreviewResponse,
  RecordMemoryRequest,
  TokenSavingsStats,
} from "./generated/adminV1";
import { MemoryCreateForm } from "./MemoryCreateForm";
import { MemoryKnowledgeDetails } from "./MemoryKnowledgeDetails";
import { memoryApi } from "./memoryApi";
import { negotiateMemoryCapabilities } from "./memoryCapabilities";
import { TokenSavingsPanel } from "./TokenSavingsPanel";

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
  const [memoryType, setMemoryType] = useState<MemoryType | "">("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [reason, setReason] = useState("");
  const [relationTarget, setRelationTarget] = useState("");
  const [relationType, setRelationType] = useState<MemoryRelationType>("SUPERSEDES");
  const [task, setTask] = useState("");
  const [explanation, setExplanation] = useState<ContextExplainResponse | null>(null);
  const [promotion, setPromotion] = useState<PromotePreviewResponse | null>(null);
  const [diagnostics, setDiagnostics] = useState<DiagnosticsResponse | null>(null);
  const [maintenance, setMaintenance] = useState<MaintenancePlan | null>(null);
  const [backups, setBackups] = useState<BackupInspection[]>([]);
  const [config, setConfig] = useState<ProjectMemoryConfig | null>(null);
  const [restorePreview, setRestorePreview] = useState<BackupRestorePreview | null>(null);
  const [restoreConfirmation, setRestoreConfirmation] = useState("");
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState("");
  const [editContent, setEditContent] = useState("");
  const [purgePreview, setPurgePreview] = useState<MemoryPurgePreview | null>(null);
  const [purgeConfirmation, setPurgeConfirmation] = useState("");
  const [serviceRunning, setServiceRunning] = useState(false);
  const [engineVersion, setEngineVersion] = useState("");
  const [tokenSavings, setTokenSavings] = useState<TokenSavingsStats | null>(null);

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
      await memoryApi.bindWorkspace(workspaceRoot);
      const hello = await memoryApi.hello(workspaceRoot);
      setEngineVersion(hello.engineVersion);
      setServiceRunning((await memoryApi.serviceStatus()).running);
      const negotiated = negotiateMemoryCapabilities(hello.apiVersion, hello.capabilities);
      if (!negotiated.compatible) throw new Error(`${t("memory.incompatible")} ${negotiated.missingCore.join(", ")}`);
      const [nextStatus, list, savings] = await Promise.all([
        memoryApi.status(workspaceRoot),
        memoryApi.list(workspaceRoot, { ...(debouncedQuery ? { query: debouncedQuery } : {}), ...(lifecycle ? { status: lifecycle } : {}), ...(memoryType ? { type: memoryType } : {}), limit: 100 }),
        negotiated.available.has("usage.token_savings") ? memoryApi.tokenSavings(workspaceRoot) : Promise.resolve(null),
      ]);
      if (generation !== requestGeneration.current) return;
      setCapabilities(negotiated.available);
      setStatus(nextStatus);
      setItems(list.items);
      setTokenSavings(savings);
      setSelected((current) => current ? list.items.find((item) => item.id === current.id) ?? null : null);
    } catch (loadError) {
      if (generation === requestGeneration.current) setError(errorMessage(loadError));
    } finally {
      if (generation === requestGeneration.current) setBusy(false);
    }
  }, [debouncedQuery, lifecycle, memoryType, t, workspaceRoot]);

  useEffect(() => { void load(); }, [load]);

  const counts = useMemo(() => status?.counts ?? {}, [status]);

  const selectMemory = async (item: MemoryRecord) => {
    setSelected(item);
    setHistory([]);
    setPromotion(null);
    setEditing(false);
    setPurgePreview(null);
    setPurgeConfirmation("");
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

  const beginEdit = () => {
    if (!selected) return;
    setEditSummary(selected.summary);
    setEditContent(selected.content);
    setEditing(true);
    setPurgePreview(null);
  };

  const saveEdit = async () => {
    if (!selected || !editSummary.trim() || !editContent.trim() || !reason.trim()) return;
    await mutate(
      () => memoryApi.update(workspaceRoot, selected.id, editSummary.trim(), editContent.trim(), reason.trim()),
      t("memory.edited"),
    );
    setEditing(false);
  };

  const createMemory = async (input: RecordMemoryRequest) => {
    setBusy(true);
    setError("");
    try {
      const created = await memoryApi.record(workspaceRoot, input);
      setNotice(t("memory.created"));
      await load();
      await selectMemory(created);
      return true;
    } catch (actionError) { setError(errorMessage(actionError)); return false; }
    finally { setBusy(false); }
  };

  const resetSavings = async () => {
    setBusy(true);
    setError("");
    try {
      setTokenSavings(await memoryApi.resetTokenSavings(workspaceRoot, "RESET"));
      setNotice(t("memory.savingsReset"));
      return true;
    } catch (actionError) { setError(errorMessage(actionError)); return false; }
    finally { setBusy(false); }
  };

  const previewPurge = async () => {
    if (!selected) return;
    setBusy(true);
    setError("");
    try {
      setPurgePreview(await memoryApi.purgePreview(workspaceRoot, selected.id));
      setPurgeConfirmation("");
      setEditing(false);
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const purge = async () => {
    if (!selected || !purgePreview || purgeConfirmation !== purgePreview.confirmation || !reason.trim()) return;
    setBusy(true);
    setError("");
    try {
      await memoryApi.purge(workspaceRoot, selected.id, purgeConfirmation, reason.trim());
      setNotice(t("memory.purged"));
      setSelected(null);
      setHistory([]);
      setPurgePreview(null);
      setPurgeConfirmation("");
      setReason("");
      await load();
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
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
    try {
      setExplanation(await memoryApi.explain(workspaceRoot, task.trim()));
      if (supports("usage.token_savings")) setTokenSavings(await memoryApi.tokenSavings(workspaceRoot));
    }
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

  const restoreDatabase = async () => {
    if (!restorePreview || restoreConfirmation !== restorePreview.confirmation) return;
    setBusy(true);
    try {
      const result = await memoryApi.restoreBackup(workspaceRoot, restorePreview.backup.fileName, restoreConfirmation);
      setNotice(`${t("memory.databaseRestored")}: ${result.restored.fileName}`);
      setRestorePreview(null);
      setRestoreConfirmation("");
      await load();
      setBackups((await memoryApi.backups(workspaceRoot)).items);
    } catch (actionError) { setError(errorMessage(actionError)); }
    finally { setBusy(false); }
  };

  const setService = async (running: boolean) => {
    setBusy(true);
    setError("");
    try {
      if (running) {
        await memoryApi.startService();
        setServiceRunning(true);
        await load();
      } else {
        await memoryApi.stopService(workspaceRoot);
        setServiceRunning(false);
        setNotice(t("memory.serviceStopped"));
      }
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
              <select value={memoryType} onChange={(event) => setMemoryType(event.target.value as MemoryType | "")}><option value="">{t("memory.allTypes")}</option>{(["DECISION", "PITFALL", "FACT", "CONSTRAINT", "ARCHITECTURE", "CONVENTION", "TASK_STATE", "TODO", "WORKAROUND"] as MemoryType[]).map((type) => <option key={type}>{type}</option>)}</select>
            </div>
            {supports("memories.record") ? <MemoryCreateForm busy={busy} onCreate={createMemory} labels={{ title: t("memory.create"), summary: t("memory.editSummary"), content: t("memory.editContent"), files: t("memory.createFiles"), validFrom: t("memory.validFrom"), validTo: t("memory.validTo"), entity: t("memory.entities"), evidenceIds: t("memory.evidenceIds"), create: t("memory.createAction") }} /> : null}
            <div className="memory-list" aria-busy={busy}>
              {items.map((item) => <button type="button" key={item.id} className={selected?.id === item.id ? "active" : ""} onClick={() => void selectMemory(item)}><span className="memory-list-meta">{item.type} · {item.lifecycleStatus} · {new Date(item.updatedAt).toLocaleDateString()}</span><strong>{item.summary}</strong></button>)}
              {!busy && items.length === 0 ? <p className="memory-state">{t("memory.empty")}</p> : null}
            </div>
          </aside>
          <article className="memory-detail">
            {selected ? <>
              <div className="memory-detail-meta">{selected.type} · {selected.verificationState} · {selected.correctnessRisk} · {selected.sourceType}</div>
              {editing ? <div className="memory-editor"><input value={editSummary} onChange={(event) => setEditSummary(event.target.value)} aria-label={t("memory.editSummary")} /><textarea value={editContent} onChange={(event) => setEditContent(event.target.value)} aria-label={t("memory.editContent")} /></div> : <><h3>{selected.summary}</h3><pre>{selected.content}</pre></>}
              <MemoryKnowledgeDetails memory={selected} labels={{ files: t("memory.files"), anchors: t("memory.anchors"), evidence: t("memory.evidence"), entities: t("memory.entities"), relations: t("memory.relations"), validity: t("memory.validity") }} />
              {history.length > 0 ? <details><summary>{t("memory.history")} ({history.length})</summary>{history.map((revision) => <div className="memory-revision" key={revision.revision}><strong>#{revision.revision} · {revision.actor}</strong><span>{revision.reason} · {new Date(revision.createdAt).toLocaleString()}</span></div>)}</details> : null}
              <input className="memory-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t("memory.reason")} />
              <div className="memory-actions">
                {supports("memories.update") ? editing ? <><button disabled={busy || !reason.trim() || !editSummary.trim() || !editContent.trim()} type="button" onClick={() => void saveEdit()}>{t("memory.saveEdit")}</button><button disabled={busy} type="button" onClick={() => setEditing(false)}>{t("memory.cancelEdit")}</button></> : <button disabled={busy} type="button" onClick={beginEdit}>{t("memory.edit")}</button> : null}
                {supports("memories.verify") ? <><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.verify(workspaceRoot, selected.id, "VERIFIED", reason), t("memory.verified"))}>{t("memory.verify")}</button><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.verify(workspaceRoot, selected.id, "DISPUTED", reason), t("memory.disputed"))}>{t("memory.dispute")}</button></> : null}
                {selected.lifecycleStatus === "ARCHIVED" && supports("memories.restore") ? <button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.restore(workspaceRoot, selected.id, reason), t("memory.restored"))}>{t("memory.restore")}</button> : supports("memories.archive") ? <button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.archive(workspaceRoot, selected.id, reason), t("memory.archived"))}>{t("memory.archive")}</button> : null}
                {(selected.type === "TODO" || selected.type === "TASK_STATE") && selected.completionState === "OPEN" && supports("memories.complete") ? <><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.complete(workspaceRoot, selected.id, "COMPLETED", reason), t("memory.completed"))}>{t("memory.complete")}</button><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.complete(workspaceRoot, selected.id, "CANCELLED", reason), t("memory.cancelled"))}>{t("memory.cancelTask")}</button></> : null}
                {supports("memories.feedback") ? <><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.feedback(workspaceRoot, selected.id, true, reason), t("memory.feedbackRecorded"))}>{t("memory.useful")}</button><button disabled={busy || !reason.trim()} type="button" onClick={() => void mutate(() => memoryApi.feedback(workspaceRoot, selected.id, false, reason), t("memory.feedbackRecorded"))}>{t("memory.notUseful")}</button></> : null}
                {supports("knowledge.promote_preview") && supports("knowledge.promote") ? <button disabled={busy} type="button" onClick={() => void promote()}>{promotion ? t("memory.confirmPromote") : t("memory.promote")}</button> : null}
                {supports("memories.purge_preview") && supports("memories.purge") ? <button className="memory-danger-button" disabled={busy} type="button" onClick={() => void previewPurge()}>{t("memory.purge")}</button> : null}
              </div>
              {supports("memories.relate") ? <div className="memory-relation-editor"><select value={relationType} onChange={(event) => setRelationType(event.target.value as MemoryRelationType)}>{(["SUPERSEDES", "CONTRADICTS", "EXTENDS", "DERIVES", "DEPENDS_ON", "RELATED_TO"] as MemoryRelationType[]).map((type) => <option key={type}>{type}</option>)}</select><input value={relationTarget} onChange={(event) => setRelationTarget(event.target.value)} placeholder={t("memory.targetId")} /><button disabled={busy || !reason.trim() || !relationTarget.trim()} onClick={() => void relate()} type="button">{t("memory.addRelation")}</button></div> : null}
              {promotion ? <section className="memory-promotion-preview"><strong>{t("memory.preview")}: {promotion.path}</strong><pre>{promotion.content}</pre></section> : null}
              {purgePreview ? <section className="memory-danger-zone"><strong>{purgePreview.warning}</strong><code>{purgePreview.confirmation}</code><input value={purgeConfirmation} onChange={(event) => setPurgeConfirmation(event.target.value)} placeholder={purgePreview.confirmation} /><button className="memory-danger-button" type="button" disabled={busy || !reason.trim() || purgeConfirmation !== purgePreview.confirmation} onClick={() => void purge()}>{t("memory.confirmPurge")}</button></section> : null}
            </> : <p className="memory-state">{t("memory.select")}</p>}
            {supports("contexts.explain") ? <section className="memory-context-explain"><h3>{t("memory.contextExplain")}</h3><div><input value={task} onChange={(event) => setTask(event.target.value)} placeholder={t("memory.taskPlaceholder")} /><button disabled={busy || !task.trim()} type="button" onClick={() => void explain()}>{t("memory.explain")}</button></div>{explanation ? <><p>{t("memory.selectedCount").replace("{count}", String(explanation.selected))} · ~{explanation.estimatedTokens} tokens</p><p>Selected: {explanation.selectedMemoryIds.join(", ") || "—"}<br />Warnings: {explanation.warningMemoryIds.join(", ") || "—"}</p><pre>{explanation.markdown}</pre></> : null}</section> : null}
            {supports("usage.token_savings") ? <TokenSavingsPanel busy={busy} stats={tokenSavings} onReset={resetSavings} labels={{ title: t("memory.tokenSavings"), saved: t("memory.tokensSaved"), rate: t("memory.savingRate"), baseline: t("memory.baselineTokens"), delivered: t("memory.contextTokens"), packs: t("memory.contextPacks"), since: t("memory.measurementSince"), reset: t("memory.resetSavings"), confirm: t("memory.resetSavingsConfirm") }} /> : null}
            <section className="memory-admin-tools"><h3>{t("memory.adminTools")}</h3><div className="memory-engine-status"><span>{t("memory.engineVersion")}: {engineVersion || "—"}</span><span>{t("memory.service")}: {serviceRunning ? t("memory.running") : t("memory.stopped")}</span><small>{t("memory.upgradePolicy")}</small></div><div className="memory-actions"><button type="button" disabled={busy || serviceRunning} onClick={() => void setService(true)}>{t("memory.startService")}</button><button type="button" disabled={busy || !serviceRunning} onClick={() => void setService(false)}>{t("memory.stopService")}</button><button type="button" disabled={busy || !serviceRunning} onClick={() => void loadAdmin()}>{t("memory.diagnostics")}</button>{supports("maintenance.preview") && supports("maintenance.run") ? <button type="button" disabled={busy || !serviceRunning} onClick={() => void maintain()}>{maintenance?.dryRun ? t("memory.confirmMaintenance") : t("memory.previewMaintenance")}</button> : null}{supports("backups.create") ? <button type="button" disabled={busy || !serviceRunning} onClick={() => void createBackup()}>{t("memory.createBackup")}</button> : null}</div>
              {diagnostics ? <pre>{JSON.stringify(diagnostics, null, 2)}</pre> : null}
              {config && supports("projects.config_update") ? <div className="memory-config"><label>{t("memory.captureMode")}<select value={config.captureMode} onChange={(event) => setConfig({ ...config, captureMode: event.target.value as ProjectMemoryConfig["captureMode"] })}><option value="off">off</option><option value="manual">manual</option><option value="summary">summary</option></select></label><label>{t("memory.retentionDays")}<input type="number" min="0" max="30" value={config.rawEventRetentionDays} onChange={(event) => setConfig({ ...config, rawEventRetentionDays: Number(event.target.value) })} /></label><button type="button" disabled={busy || config.rawEventRetentionDays < 0 || config.rawEventRetentionDays > 30} onClick={() => void saveConfig()}>{t("memory.saveConfig")}</button></div> : null}
              {maintenance ? <pre>{JSON.stringify(maintenance, null, 2)}</pre> : null}
              {backups.length > 0 ? <div className="memory-backups">{backups.map((backup) => <div key={backup.fileName}><button type="button" onClick={() => void memoryApi.verifyBackup(workspaceRoot, backup.fileName).then(() => setNotice(`${t("memory.backupVerified")}: ${backup.fileName}`)).catch((verifyError) => setError(errorMessage(verifyError)))}><strong>{backup.fileName}</strong><span>{backup.bytes} bytes · schema {backup.schemaVersion}</span></button>{supports("backups.restore_preview") && supports("backups.restore") ? <button type="button" onClick={() => void memoryApi.restoreBackupPreview(workspaceRoot, backup.fileName).then((preview) => { setRestorePreview(preview); setRestoreConfirmation(""); }).catch((restoreError) => setError(errorMessage(restoreError)))}>{t("memory.restoreDatabase")}</button> : null}</div>)}</div> : null}
              {restorePreview ? <div className="memory-danger-zone"><strong>{restorePreview.warning}</strong><code>{restorePreview.confirmation}</code><input value={restoreConfirmation} onChange={(event) => setRestoreConfirmation(event.target.value)} placeholder={restorePreview.confirmation} /><button type="button" disabled={busy || restoreConfirmation !== restorePreview.confirmation} onClick={() => void restoreDatabase()}>{t("memory.confirmRestoreDatabase")}</button></div> : null}
            </section>
          </article>
        </div> : null}
      </section>
    </div>
  );
}
