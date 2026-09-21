import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import { useI18n } from "../../../shared/i18n/I18nProvider";
import type { KnowledgeSearchHit, MemoryType } from "../generated/adminV1";
import type { MemoryDocumentContext } from "../documentContext";
import { captureReadiness } from "../knowledgeModel";
import type { MemorySourceNavigationTarget } from "../sourceNavigation";
import { useContextOsSession } from "./useContextOsSession";

type Session = ReturnType<typeof useContextOsSession>;

type KnowledgeWorkspaceProps = {
  documentContext: MemoryDocumentContext | null;
  workspaceRoot: string;
  session: Session;
  onOpenSource: (target: MemorySourceNavigationTarget) => void;
};

const KNOWLEDGE_KINDS: MemoryType[] = [
  "DECISION",
  "PITFALL",
  "FACT",
  "CONSTRAINT",
  "ARCHITECTURE",
  "CONVENTION",
  "WORKAROUND",
];

export function KnowledgeWorkspace({
  documentContext,
  workspaceRoot,
  session,
  onOpenSource,
}: KnowledgeWorkspaceProps) {
  const { t } = useI18n();
  const [ownerKind, setOwnerKind] = useState<"PROJECT" | "TASK">("PROJECT");
  const [taskId, setTaskId] = useState("");
  const [kind, setKind] = useState<MemoryType>("DECISION");
  const [answer, setAnswer] = useState("");
  const [appliesWhen, setAppliesWhen] = useState("");
  const [reason, setReason] = useState("");
  const [query, setQuery] = useState("");
  const [searchTaskId, setSearchTaskId] = useState("");
  const [captured, setCaptured] = useState(false);
  const [reviewing, setReviewing] = useState<KnowledgeSearchHit | null>(null);
  const [reviewAnswer, setReviewAnswer] = useState("");
  const [reviewAppliesWhen, setReviewAppliesWhen] = useState("");
  const [reviewReason, setReviewReason] = useState("");
  const [reviewPolicy, setReviewPolicy] = useState<"CAPTURED_CONTEXT" | "COMPATIBLE_SOURCES">("CAPTURED_CONTEXT");
  const [sourceChanged, setSourceChanged] = useState(false);
  const [searchInputDirty, setSearchInputDirty] = useState(false);
  const captureAttemptRef = useRef<{
    fingerprint: string;
    requestIds: { register: string; capture: string };
  } | null>(null);
  const reviewAttemptRef = useRef<{ fingerprint: string; requestId: string } | null>(null);

  const currentDocument = documentContext?.workspaceRoot === workspaceRoot
    ? documentContext
    : null;
  const readiness = captureReadiness({
    documentContext: currentDocument,
    ownerKind,
    taskId,
    answer,
    appliesWhen,
    reason,
  });
  const selectedTask = useMemo(
    () => session.tasks.find((task) => task.id === taskId),
    [session.tasks, taskId],
  );

  useEffect(() => {
    if (!session.knowledgeSearch) {
      setReviewing(null);
      reviewAttemptRef.current = null;
    }
  }, [session.knowledgeSearch]);

  const capture = async (event: FormEvent) => {
    event.preventDefault();
    if (!currentDocument || readiness !== "READY") return;
    setCaptured(false);
    const fingerprint = JSON.stringify({
      workspaceRoot,
      document: currentDocument,
      ownerKind,
      taskId: ownerKind === "TASK" ? taskId : null,
      kind,
      answer,
      appliesWhen,
      reason,
    });
    if (captureAttemptRef.current?.fingerprint !== fingerprint) {
      captureAttemptRef.current = {
        fingerprint,
        requestIds: { register: crypto.randomUUID(), capture: crypto.randomUUID() },
      };
    }
    const card = await session.captureKnowledge({
      documentContext: currentDocument,
      ownerKind,
      ...(ownerKind === "TASK" ? { taskId } : {}),
      kind,
      answer,
      appliesWhen,
      reason,
      workingCopyPolicy: "CAPTURED_CONTEXT",
      requestIds: captureAttemptRef.current.requestIds,
    });
    if (card) {
      captureAttemptRef.current = null;
      setCaptured(true);
    }
  };

  const search = async (event?: FormEvent, preserveSourceChanged = false) => {
    event?.preventDefault();
    if (!query.trim()) return;
    if (!preserveSourceChanged) setSourceChanged(false);
    const result = await session.searchKnowledge({
      query: query.trim(),
      ...(searchTaskId ? { taskId: searchTaskId } : {}),
    });
    if (result) setSearchInputDirty(false);
  };

  const loadMore = async () => {
    const cursor = session.knowledgeSearch?.nextCursor;
    if (!cursor || searchInputDirty || !query.trim()) return;
    await session.searchKnowledge({
      query: query.trim(),
      ...(searchTaskId ? { taskId: searchTaskId } : {}),
      cursor,
    });
  };

  const openSource = async (hit: KnowledgeSearchHit) => {
    setSourceChanged(false);
    const resolved = await session.resolveKnowledgeSource(hit, searchTaskId || undefined);
    if (hit.decision === "REUSABLE" && resolved?.decision !== "REUSABLE") {
      setSourceChanged(true);
      await search(undefined, true);
      return;
    }
    const section = resolved?.observedSection ?? resolved?.approvedSection;
    if (!resolved || !section) return;
    onOpenSource({
      workspaceRoot,
      relativePath: resolved.source.relativePath,
      startLine: section.locator.startLine,
      endLine: section.locator.endLine,
      ...(section.locator.startOffset !== undefined ? { startOffset: section.locator.startOffset } : {}),
      ...(section.locator.endOffset !== undefined ? { endOffset: section.locator.endOffset } : {}),
      expectedText: section.excerpt,
    });
  };

  const beginReview = (hit: KnowledgeSearchHit) => {
    setReviewing(hit);
    setReviewAnswer(hit.card.answer);
    setReviewAppliesWhen(hit.card.appliesWhen);
    setReviewReason(hit.card.reason);
    setReviewPolicy(hit.card.applicability.workingCopyPolicy);
    reviewAttemptRef.current = null;
  };

  const confirmReview = async () => {
    if (!reviewing) return;
    const fingerprint = JSON.stringify({
      cardId: reviewing.card.id,
      revision: reviewing.card.revision,
      observedRevision: reviewing.evidence?.observedRevision,
      taskId: searchTaskId || null,
      answer: reviewAnswer,
      appliesWhen: reviewAppliesWhen,
      reason: reviewReason,
      workingCopyPolicy: reviewPolicy,
    });
    if (reviewAttemptRef.current?.fingerprint !== fingerprint) {
      reviewAttemptRef.current = { fingerprint, requestId: crypto.randomUUID() };
    }
    const reviewed = await session.reviewKnowledge({
      hit: reviewing,
      answer: reviewAnswer,
      appliesWhen: reviewAppliesWhen,
      reason: reviewReason,
      ...(searchTaskId ? { taskId: searchTaskId } : {}),
      workingCopyPolicy: reviewPolicy,
      requestId: reviewAttemptRef.current.requestId,
    });
    if (!reviewed) return;
    reviewAttemptRef.current = null;
    setReviewing(null);
    await search();
  };

  if (!session.longMemoryAvailable) {
    return <div className="context-page context-knowledge-page">
      <PageHeader title={t("context.knowledge.title")} description={t("context.knowledge.description")} />
      <p className="context-knowledge-warning">{t("context.knowledge.capabilityUnavailable")}</p>
    </div>;
  }

  return <div className="context-page context-knowledge-page" aria-busy={session.isLoading || session.isMutating}>
    <PageHeader title={t("context.knowledge.title")} description={t("context.knowledge.description")} />
    <div className="context-knowledge-grid">
      <section className="context-section context-knowledge-stack">
        <h2>{t("context.knowledge.captureTitle")}</h2>
        <p>{t("context.knowledge.captureDescription")}</p>
        <div className="context-knowledge-context">
          <label>{t("context.knowledge.owner")}<select value={ownerKind} onChange={(event) => setOwnerKind(event.target.value as typeof ownerKind)}>
            <option value="TASK">{t("context.knowledge.ownerTask")}</option>
            <option value="PROJECT">{t("context.knowledge.ownerProject")}</option>
          </select></label>
          <label>{t("context.knowledge.task")}<select value={taskId} disabled={ownerKind !== "TASK"} onChange={(event) => setTaskId(event.target.value)}>
            <option value="">{t("context.knowledge.chooseTask")}</option>
            {session.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select></label>
        </div>
        <div className="context-knowledge-source">
          <strong>{t("context.knowledge.source")}</strong>
          {currentDocument?.selection ? <>
            <small>{currentDocument.relativePath} · {t("context.knowledge.selection", {
              start: currentDocument.selection.startLine,
              end: currentDocument.selection.endLine,
            })}</small>
            <pre>{currentDocument.selection.text}</pre>
          </> : <small>{t("context.knowledge.noSource")}</small>}
        </div>
        {readiness === "DIRTY_DOCUMENT" ? <p className="context-knowledge-warning">{t("context.knowledge.unsaved")}</p> : null}
        {readiness === "NO_SELECTION" ? <p className="context-knowledge-warning">{t("context.knowledge.noSelection")}</p> : null}
        {readiness === "TASK_REQUIRED" ? <p className="context-knowledge-warning">{t("context.knowledge.noTasks")}</p> : null}
        <form className="context-knowledge-form" onSubmit={(event) => void capture(event)}>
          <label>{t("context.knowledge.kind")}<select value={kind} onChange={(event) => setKind(event.target.value as MemoryType)}>
            {KNOWLEDGE_KINDS.map((value) => <option key={value} value={value}>{value}</option>)}
          </select></label>
          <label>{t("context.knowledge.answer")}<textarea value={answer} placeholder={t("context.knowledge.answerPlaceholder")} onChange={(event) => setAnswer(event.target.value)} /></label>
          <label>{t("context.knowledge.appliesWhen")}<textarea value={appliesWhen} placeholder={t("context.knowledge.appliesWhenPlaceholder")} onChange={(event) => setAppliesWhen(event.target.value)} /></label>
          <label>{t("context.knowledge.reason")}<textarea value={reason} placeholder={t("context.knowledge.reasonPlaceholder")} onChange={(event) => setReason(event.target.value)} /></label>
          <small>{t("context.knowledge.capturePolicy")}</small>
          <button type="submit" disabled={readiness !== "READY" || session.isMutating}>
            {session.isMutating ? t("context.knowledge.capturing") : t("context.knowledge.capture")}
          </button>
        </form>
        {captured ? <p className="context-knowledge-success">{t("context.knowledge.captured")}</p> : null}
        {selectedTask ? <small>{selectedTask.objective}</small> : null}
      </section>

      <section className="context-section context-knowledge-stack">
        <h2>{t("context.knowledge.searchTitle")}</h2>
        <p>{t("context.knowledge.searchDescription")}</p>
        <form className="context-knowledge-form" onSubmit={(event) => void search(event)}>
          <label>{t("context.knowledge.task")}<select value={searchTaskId} onChange={(event) => {
            setSearchTaskId(event.target.value);
            setSearchInputDirty(true);
            session.clearKnowledgeSearch();
          }}>
            <option value="">{t("context.knowledge.ownerProject")}</option>
            {session.tasks.map((task) => <option key={task.id} value={task.id}>{task.title}</option>)}
          </select></label>
          <label>{t("context.knowledge.query")}<input value={query} placeholder={t("context.knowledge.queryPlaceholder")} onChange={(event) => {
            setQuery(event.target.value);
            setSearchInputDirty(true);
            session.clearKnowledgeSearch();
          }} /></label>
          <button type="submit" disabled={!query.trim() || session.isMutating}>
            {session.isMutating ? t("context.knowledge.searching") : t("context.knowledge.search")}
          </button>
        </form>
        {session.knowledgeSearch && !searchInputDirty ? <KnowledgeResults
          result={session.knowledgeSearch}
          onOpenSource={openSource}
          onReview={beginReview}
          onLoadMore={!searchInputDirty && session.knowledgeSearch.nextCursor
            ? () => void loadMore()
            : undefined}
          loading={session.isMutating}
        /> : null}
        {sourceChanged ? <p className="context-knowledge-warning">{t("context.knowledge.sourceChanged")}</p> : null}
      </section>
    </div>
    {reviewing ? <ReviewPanel
      hit={reviewing}
      answer={reviewAnswer}
      appliesWhen={reviewAppliesWhen}
      reason={reviewReason}
      workingCopyPolicy={reviewPolicy}
      disabled={session.isMutating}
      onAnswer={setReviewAnswer}
      onAppliesWhen={setReviewAppliesWhen}
      onReason={setReviewReason}
      onWorkingCopyPolicy={setReviewPolicy}
      onCancel={() => setReviewing(null)}
      onConfirm={() => void confirmReview()}
    /> : null}
  </div>;
}

function KnowledgeResults({
  result,
  onOpenSource,
  onReview,
  onLoadMore,
  loading,
}: {
  result: NonNullable<Session["knowledgeSearch"]>;
  onOpenSource: (hit: KnowledgeSearchHit) => void;
  onReview: (hit: KnowledgeSearchHit) => void;
  onLoadMore?: () => void;
  loading: boolean;
}) {
  const { t } = useI18n();
  const excluded = Object.entries(result.excludedCounts)
    .filter(([, count]) => (count ?? 0) > 0)
    .map(([decision, count]) => `${decision}: ${count}`)
    .join(", ");
  return <div className="context-knowledge-results">
    <strong>{t("context.knowledge.resultCount", { count: result.items.length })}</strong>
    {result.items.map((hit) => <KnowledgeCardView
      key={hit.card.id}
      hit={hit}
      onOpenSource={onOpenSource}
      onReview={onReview}
    />)}
    {result.items.length === 0 && result.reviewNotices.length === 0 ? <p>{t("context.knowledge.noResults")}</p> : null}
    {excluded ? <p className="context-knowledge-warning">{t("context.knowledge.excluded", { details: excluded })}</p> : null}
    {result.partial ? <p className="context-knowledge-warning">{t("context.knowledge.partial")}</p> : null}
    {result.reviewNotices.length > 0 ? <>
      <h3>{t("context.knowledge.reviewNotices")}</h3>
      {result.reviewNotices.map((hit) => <KnowledgeCardView
        key={`${hit.card.id}-${hit.card.revision}`}
        hit={hit}
        onOpenSource={onOpenSource}
        onReview={onReview}
      />)}
    </> : null}
    {onLoadMore ? <button type="button" disabled={loading} onClick={onLoadMore}>
      {loading ? t("context.knowledge.loadingMore") : t("context.knowledge.loadMore")}
    </button> : null}
  </div>;
}

function KnowledgeCardView({
  hit,
  onOpenSource,
  onReview,
}: {
  hit: KnowledgeSearchHit;
  onOpenSource: (hit: KnowledgeSearchHit) => void;
  onReview?: (hit: KnowledgeSearchHit) => void;
}) {
  const { t } = useI18n();
  return <article className="context-knowledge-card">
    <header><h3>{hit.card.answer}</h3><span className={`context-knowledge-badge ${hit.decision === "REUSABLE" ? "" : "review"}`}>
      {t(`context.knowledge.${decisionKey(hit.decision)}`)}
    </span></header>
    <p><strong>{t("context.knowledge.useWhen")}:</strong> {hit.card.appliesWhen}</p>
    <p><strong>{t("context.knowledge.why")}:</strong> {hit.card.reason}</p>
    <small>{t("context.knowledge.reasonCodes", { reasons: hit.reasonCodes.join(", ") })}</small>
    <div className="context-action-row">
      <button type="button" onClick={() => void onOpenSource(hit)}>{t("context.knowledge.openSource")}</button>
      {onReview && hit.evidence?.observedSection
        ? <button type="button" onClick={() => onReview(hit)}>{t("context.knowledge.review")}</button>
        : null}
    </div>
  </article>;
}

function ReviewPanel(props: {
  hit: KnowledgeSearchHit;
  answer: string;
  appliesWhen: string;
  reason: string;
  workingCopyPolicy: "CAPTURED_CONTEXT" | "COMPATIBLE_SOURCES";
  disabled: boolean;
  onAnswer: (value: string) => void;
  onAppliesWhen: (value: string) => void;
  onReason: (value: string) => void;
  onWorkingCopyPolicy: (value: "CAPTURED_CONTEXT" | "COMPATIBLE_SOURCES") => void;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();
  return <section className="context-section context-knowledge-evidence">
    <h2>{t("context.knowledge.reviewTitle")}</h2>
    <p>{t("context.knowledge.reviewDescription")}</p>
    <strong>{t("context.knowledge.currentEvidence")}</strong>
    <pre>{props.hit.evidence?.observedSection?.excerpt ?? t("context.knowledge.sourceUnavailable")}</pre>
    <strong>{t("context.knowledge.originalEvidence")}</strong>
    <pre>{props.hit.evidence?.approvedSection?.excerpt ?? "—"}</pre>
    <div className="context-knowledge-form">
      <label>{t("context.knowledge.answer")}<textarea value={props.answer} onChange={(event) => props.onAnswer(event.target.value)} /></label>
      <label>{t("context.knowledge.appliesWhen")}<textarea value={props.appliesWhen} onChange={(event) => props.onAppliesWhen(event.target.value)} /></label>
      <label>{t("context.knowledge.reason")}<textarea value={props.reason} onChange={(event) => props.onReason(event.target.value)} /></label>
      <label>{t("context.knowledge.workingCopyPolicy")}<select
        value={props.workingCopyPolicy}
        onChange={(event) => props.onWorkingCopyPolicy(
          event.target.value as "CAPTURED_CONTEXT" | "COMPATIBLE_SOURCES",
        )}
      >
        <option value="CAPTURED_CONTEXT">{t("context.knowledge.policyCaptured")}</option>
        <option value="COMPATIBLE_SOURCES">{t("context.knowledge.policyCompatible")}</option>
      </select></label>
    </div>
    <div className="context-action-row">
      <button type="button" disabled={props.disabled || !props.answer.trim() || !props.appliesWhen.trim() || !props.reason.trim()} onClick={props.onConfirm}>
        {props.disabled ? t("context.knowledge.reviewing") : t("context.knowledge.confirmReview")}
      </button>
      <button type="button" disabled={props.disabled} onClick={props.onCancel}>{t("context.knowledge.cancelReview")}</button>
    </div>
  </section>;
}

function PageHeader({ title, description }: { title: string; description: string }) {
  return <header className="context-page-header"><h1>{title}</h1><p>{description}</p></header>;
}

function decisionKey(decision: KnowledgeSearchHit["decision"]): string {
  if (decision === "REUSABLE") return "reusable";
  if (decision === "NEEDS_REVIEW") return "needsReview";
  return "validationPending";
}
