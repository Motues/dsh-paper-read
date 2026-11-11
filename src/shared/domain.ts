/**
 * Domain model shared by both halves of the plugin.
 *
 * These are the wire shapes: the host serialises them to JSON and the browser
 * consumes them. Storage-only fields (`fileHash`, `filePathIsCopy`, …) live on
 * `PaperRecord` and never reach the client; list endpoints return `Paper`
 * (a card), detail endpoints return `PaperDetail`.
 */

export type Status = 'todo' | 'reading' | 'done'
export type SourceKind = 'pdf' | 'link'
export type HighlightColor = 'yellow' | 'blue' | 'rose' | 'green' | 'purple' | 'orange'
/**
 * How two papers are related.
 *
 * `cites` is decided by deterministic reference matching; the rest are written
 * by the model, with `same-problem` covering "different route, same question"
 * and `uses` covering "borrowed the method, applied it elsewhere".
 */
export type EdgeKind =
  | 'cites'
  | 'builds-on'
  | 'same-method'
  | 'same-problem'
  | 'uses'
  | 'contradicts'
/** `suggested` edges are below the confirmation bar; `rejected` hides a pair. */
export type EdgeStatus = 'confirmed' | 'suggested' | 'rejected'
/** Why a metadata-only record has no PDF yet. */
export type PdfUnavailable = 'auth' | 'missing'

export interface ReadingPosition {
  page: number
  scrollTop: number
  at: string
}

/** One entry from a provider's reference list. */
export interface ReferenceEntry {
  title?: string
  authors?: string[]
  year?: number
  venue?: string
  doi?: string
  pmid?: string
  url?: string
  raw?: string
}

/** One paper as it appears on a card / in a list. */
export interface Paper {
  id: string
  title: string
  authors: string[]
  /** `authors` joined for display; derived by the host. */
  authorLine: string
  year?: number
  venue?: string
  pmid?: string
  tags: string[]
  folder: string | null
  status: Status
  progress: number
  source: SourceKind
  pageCount?: number
  addedAt: string
  updatedAt: string
  tldr?: string
  hasFullText: boolean
  hasSummary: boolean
  missing?: boolean
  /** Present when metadata was imported but the PDF could not be fetched. */
  pdfUnavailable?: PdfUnavailable
  lastReadAt?: string | null
  lastReadPage?: number | null
  /** Set when the paper sits in the recycle bin; absent means it is live. */
  deletedAt?: string
}

/** The durable record in `library.json`. */
export interface PaperRecord extends Omit<Paper, 'authorLine' | 'lastReadAt' | 'lastReadPage'> {
  abstract?: string
  doi?: string
  arxivId?: string
  filePath?: string
  filePathIsCopy?: boolean
  sourceUrl?: string
  fileHash?: string
  lastRead?: ReadingPosition
  /** DSH session hosting this paper's conversation; `pr-<paperId>` when unset. */
  sessionId?: string
  /** Model this paper's conversation runs on; absent means "follow the default". */
  chatModel?: ChatRoute
  /**
   * Sessions this paper used before a context reset.
   *
   * The logs stay on disk (and archived, when the sidebar group is off) but are
   * still listed as this paper's conversation history.
   */
  retiredSessions?: string[]
  /** User-given conversation titles, keyed by session id. */
  conversationTitles?: Record<string, string>
  /** Conversations hidden from this paper's history (logs stay on disk). */
  archivedConversations?: string[]
  /**
   * Version of `pages.json` written by the PDF parser. Older papers are
   * re-parsed once when their geometry is first needed, because translated
   * text is typeset from per-line metrics that v1 extraction discarded.
   */
  parseVersion?: number
  /** v1 migration leftovers; deleted on load. */
  collections?: string[]
}

/** The editable bibliographic fields of an existing record. */
export interface PaperMetadataPatch {
  title?: string
  authors?: string[]
  year?: number | null
  venue?: string | null
  abstract?: string | null
  doi?: string | null
  arxivId?: string | null
  pmid?: string | null
}

export interface Folder {
  id: string
  name: string
  /** Parent folder id; `null` (or absent, on old records) means top level. */
  parentId?: string | null
  createdAt?: string
  count: number
}

export interface SummaryRelated {
  paperId: string
  reason: string
  weight: number
}

export interface SummaryRefined {
  title?: string
  authors?: string[]
  year?: number
  venue?: string
}

export interface Summary {
  paperId: string
  tldr: string
  problem: string
  method: string
  findings: string[]
  limitations: string[]
  reusable: string[]
  related: SummaryRelated[]
  refined?: SummaryRefined
  model: string
  createdAt: string
  /** Set when the reader saved a manual edit; regeneration clears it. */
  editedAt?: string
}

/** The fields the guide panel can edit without touching generation metadata. */
export interface SummaryEdit {
  tldr?: string
  problem?: string
  method?: string
  findings?: string[]
  limitations?: string[]
  reusable?: string[]
}

export type BlockKind = 'title' | 'para' | 'caption' | 'equation' | 'ref'

/**
 * One typeset line of a block, in page points with a top-left origin.
 *
 * The reader paints translated text back into the original paragraph box, so
 * it needs more than the box: the original leading tells it how tall a line
 * should be, and the per-line boxes keep the white mask on the glyphs instead
 * of on empty column gutters.
 */
export interface BlockLine {
  /** Line box: [x, top, width, height]. */
  box: [number, number, number, number]
  /** Baseline y (top-left origin). */
  baseline: number
}

export interface Block {
  id: string
  bbox: [number, number, number, number]
  text: string
  kind: BlockKind
  size?: number
  /** Median baseline-to-baseline distance inside the block (pt). */
  leading?: number
  /** First-line inset from `bbox[0]` (pt). */
  indent?: number
  /** How the lines sit inside the block box. */
  align?: 'left' | 'center' | 'right'
  /** Per-line boxes; absent on pages parsed before v2. */
  lines?: BlockLine[]
}

export interface PageText {
  page: number
  width: number
  height: number
  blocks: Block[]
}

/** Why a block is deliberately left in the source language. */
export type TranslationSkip = 'ref' | 'equation' | 'meta' | 'visual' | 'cjk'

/** A non-text page region (figure, table, formula), preserved as a crop. */
export interface VisualRegion {
  bbox: [number, number, number, number]
  kind: 'figure' | 'table' | 'equation' | 'drawing'
  /** Caption text when the region could be matched to one. */
  caption?: string
}

export type TranslationPageStatus = 'done' | 'failed' | 'partial' | 'pending'

/** One translated page: per-block Chinese text, keyed by `Block.id`. */
export interface TranslationPage {
  page: number
  status: 'done' | 'failed' | 'partial'
  /** Hash of the source block texts; kept for cache diagnostics. */
  sourceHash: string
  blocks: Record<string, string>
  /**
   * `Block.id -> sha1(normalized source text)`. Translation is reused by source
   * text, so re-parsing a PDF (which renumbers blocks) does not pay twice.
   */
  sources?: Record<string, string>
  model: string
  at: string
  error?: string
}

/** One bilingual term pinned by the glossary, e.g. `attention -> 注意力`. */
export interface GlossaryEntry {
  en: string
  zh: string
}

/** `papers/<id>/translation.json`: durable full-text translation cache. */
export interface TranslationFile {
  version?: number
  paperId: string
  targetLang: string
  model: string
  totalPages: number
  createdAt: string
  updatedAt: string
  pages: Record<string, TranslationPage>
  /**
   * Terms extracted once from the title and abstract, injected into the system
   * prompt so a long paper keeps one rendering per term. Absent until a run
   * has had a chance to build it.
   */
  glossary?: GlossaryEntry[]
  /** Counts cached at run time so a status poll never re-plans the paper. */
  counts?: {
    totalPages: number
    totalBlocks: number
    translatedBlocks: number
    skippedBlocks: number
    reusedBlocks?: number
  }
}

/** Where a translation run gets its text from. */
export type TranslationSource = 'dsh' | 'local' | 'api' | 'browser' | 'native'

/** How an engine is driven: an LLM conversation, or a plain machine translator. */
export type TranslationMode = 'llm' | 'mt'

/**
 * Which switch a translation source obeys.
 *
 * `dsh` and `tokens` are model calls the AI master switch stops; `characters`,
 * `local` and `free` keep working because they do not spend harness tokens.
 */
export type TranslationBilling = 'dsh' | 'tokens' | 'characters' | 'local' | 'free'

export type TranslationApiKind = 'openai' | 'deepl' | 'google' | 'azure' | 'libretranslate'

export type TranslationLocalKind = 'llm' | 'libretranslate'

export type TranslationNativeProvider = 'bing' | 'google'

export interface TranslationLocalSettings {
  /** Local general-purpose model, or a dedicated local translation server. */
  kind: TranslationLocalKind
  baseUrl: string
  /** OpenAI-compatible model id; unused for LibreTranslate. */
  model: string
  concurrency: number
  maxTokens: number
}

export interface TranslationApiSettings {
  kind: TranslationApiKind
  baseUrl: string
  /** OpenAI-compatible model id; unused for the dedicated translation APIs. */
  model: string
  /** Azure Translator resource region. */
  region: string
}

export interface TranslationSettings {
  source: TranslationSource
  local: TranslationLocalSettings
  api: TranslationApiSettings
  browser: { sourceLanguage: string }
  native: { provider: TranslationNativeProvider }
}

/** One resolved engine, as the settings page and the reader see it. */
export interface TranslationEngineInfo {
  id: string
  label: string
  mode: TranslationMode
  billing: TranslationBilling
  available: boolean
  /** Why the engine cannot run, when `available` is false. */
  error?: string
}

/** Everything the translation settings page needs in one round-trip. */
export interface TranslationRuntime {
  source: TranslationSource
  settings: TranslationSettings
  engine: TranslationEngineInfo
  /** Which API keys are already stored in the harness credential store. */
  keys: Partial<Record<TranslationApiKind | 'local', boolean>>
  aiEnabled: boolean
  /** False when the AI master switch stops this source. */
  allowed: boolean
}

/** What `GET /papers/:id/translation` reports to the reader. */
export interface TranslationStatus {
  available: boolean
  targetLang: string
  model: string
  /** Effective source for the *next* run; cached pages keep their own model label. */
  source?: TranslationSource
  sourceLabel?: string
  mode?: TranslationMode
  /** False when the AI master switch stops this source. */
  allowed?: boolean
  /** Source language the current engine expects (MT sources). */
  sourceLanguage?: string
  totalPages: number
  donePages: number
  failedPages: number
  partialPages?: number
  translatedBlocks?: number
  totalBlocks?: number
  skippedBlocks?: number
  /** Blocks answered from the content cache during the current/last run. */
  reusedBlocks?: number
  running: boolean
  /** Page currently being translated, when a run is in flight. */
  runningPage?: number
  updatedAt?: string
  error?: string
  /** Per-page completion state, keyed by page number. */
  pages: Record<string, TranslationPageStatus>
}

/** Geometry + translation for one page, in one round-trip. */
export interface TranslationPagePayload {
  page: PageText
  status: TranslationPageStatus
  blocks: Record<string, string>
  /** Blocks deliberately left in the source language, with the reason. */
  skipped?: Record<string, TranslationSkip>
  /** Reading order of every block id on the page. */
  order?: string[]
  /** Non-text regions (figures, tables, formulas) to keep as images. */
  visuals?: VisualRegion[]
  model?: string
  error?: string
}

/** The whole paper, as the continuous reflowed view needs it. */
export interface TranslationDocument {
  paperId: string
  title: string
  authors: string[]
  venue?: string
  year?: number
  targetLang: string
  model: string
  referencePages: number[]
  pages: TranslationPagePayload[]
}

/** Commit of one page's translations produced in the browser. */
export interface TranslationBlockInput {
  id: string
  /** Translation with `⟦n⟧` placeholders still in place; the host restores them. */
  t: string
}

export interface TranslationCommitResult {
  status: TranslationStatus
  accepted: string[]
  rejected: string[]
}

/** One engine probe from the settings page. */
export interface TranslationTestResult {
  ok: boolean
  ms: number
  engine: string
  output?: string
  error?: string
}

export interface TranslationModelList {
  models: Array<{ id: string; name: string }>
  error?: string
}

export interface Annotation {
  id: string
  paperId: string
  page: number
  rects: number[][]
  quote: string
  prefix: string
  suffix: string
  color: HighlightColor
  note?: string
  noteId?: string
  createdAt: string
  updatedAt: string
}

export interface Note {
  id: string
  paperId: string
  page?: number
  body: string
  origin: 'user' | 'ai'
  createdAt: string
}

/** Which reader gesture produced a conversation turn. */
export type ChatMode = 'ask' | 'explain'

/**
 * The provider/model/reasoning route one conversation runs on.
 *
 * DSH's own model selector records this per session; PaperReader keeps a copy on
 * the paper record so the choice survives before the session exists and is
 * visible to the panel without starting one.
 */
export interface ChatRoute {
  provider: string
  model: string
  /** Adapter-owned effort name; absent means "use the model default". */
  reasoningEffort?: string
}

/**
 * One rendered turn of a paper conversation.
 *
 * The durable copy lives in the DSH session log (one session per paper); this is
 * the display projection the browser gets from `GET /papers/:id/chat`, carrying
 * the page/quote metadata that DSH's own transcript does not render.
 */
export interface ChatMessage {
  id: string
  role: 'user' | 'assistant'
  text: string
  mode?: ChatMode
  page?: number
  quote?: string
  /** Pages this answer cited; only present on assistant turns. */
  citations?: number[]
  /** A compaction checkpoint: render as a muted summary block, not a bubble. */
  summary?: boolean
  /**
   * Model-facing context that was injected ahead of a question. Rendered as a
   * collapsed block at its position in the transcript, never as a user bubble.
   */
  injected?: 'digest' | 'retrieval'
  /** Pages a `retrieval` block covers. */
  pages?: number[]
}

/** How full the paper session's context window is. */
export interface ChatContextUsage {
  tokens: number
  window: number
  percent: number
  /** True when a compaction summary currently shadows older turns. */
  compacted: boolean
}

export interface ChatHistoryPayload {
  sessionId: string
  messages: ChatMessage[]
  /** `null` until the session is live (context is only measured for live agents). */
  context: ChatContextUsage | null
  /** The route this conversation currently runs on; `null` without a model. */
  route: ChatRoute | null
}

/** One model this profile can route to, with the efforts its adapter supports. */
export interface ChatModelOption {
  provider: string
  providerName: string
  model: string
  name: string
  description?: string
  efforts: Array<{ id: string; name: string; description?: string }>
  defaultEffort?: string
}

/** What the panel's model switch offers. */
export interface ChatModelCatalog {
  available: boolean
  options: ChatModelOption[]
  current: ChatRoute | null
}

/** What `POST /papers/:id/compact` reports back to the panel. */
export interface CompactResult {
  removed: number
  freedTokens: number
}

/** What `POST /papers/:id/reset` reports: the fresh session and the retired one. */
export interface ChatResetResult {
  sessionId: string
  retired: string
}

/** One conversation in a paper's history: the active session or an older one. */
export interface ChatConversation {
  id: string
  title: string
  /** The session later turns will be appended to. */
  active: boolean
  /** Hidden from the normal list; the log still exists and can be restored. */
  archived: boolean
  createdAt?: string
  /** Number of rendered turns (user + assistant), when the log was readable. */
  messageCount?: number
}

/** `GET /papers/:id/conversations`: active first, then history (newest first). */
export interface ChatConversationList {
  paperId: string
  activeId: string
  conversations: ChatConversation[]
}

/** A paper plus everything the reader needs in one round-trip. */
export interface PaperDetail extends Paper {
  abstract?: string
  doi?: string
  arxivId?: string
  references?: ReferenceEntry[]
  sourceUrl?: string
  filePath?: string
  fileUrl: string | null
  summary: Summary | null
  annotations: Annotation[]
  notes: Note[]
  lastRead?: ReadingPosition
}

export type JobState = 'queued' | 'running' | 'done' | 'failed'
export type JobStepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped'

export interface JobStep {
  key: string
  label: string
  state: JobStepState
  detail?: string
  at?: string
}

export interface JobSource {
  kind: 'file' | 'url' | 'relations'
  filePath?: string
  url?: string
  /** When set, the job fills in the PDF for this metadata-only paper. */
  paperId?: string
  /** Folder the new paper is filed into as soon as it is created. */
  folder?: string
  /** Rebuild scope (`'all'` or one paper id); only for `kind: 'relations'`. */
  scope?: string
}

export interface Job {
  id: string
  kind: string
  state: JobState
  source: JobSource
  sourceLabel: string
  paperId: string | null
  steps: JobStep[]
  warnings?: string[]
  duplicate?: boolean
  error?: string
  createdAt: string
  updatedAt: string
  startedAt?: string
  finishedAt?: string
}

/** Everything the task list can show, running or archived. */
export type TaskKind = 'import' | 'relations' | 'translation' | 'chat' | 'summary'
export type TaskState = 'queued' | 'running' | 'done' | 'failed' | 'canceled'

/** One task's lifetime, timing and model spend. */
export interface TaskRecord {
  id: string
  kind: TaskKind
  /** Paper title for per-paper work, or the import/relations label. */
  title: string
  detail?: string
  /** Set when the task belongs to one paper; clicking the row opens it. */
  paperId?: string
  state: TaskState
  startedAt: string
  finishedAt?: string
  updatedAt: string
  progress?: { done: number; total: number }
  /** Exact tokens attributed to this task's model calls. */
  usage?: UsageTotals
  /** Provider/model labels seen during the task, de-duplicated. */
  models?: string[]
  error?: string
  /** Only translation runs expose a cancel action today. */
  cancelable?: boolean
}

export interface TaskKindCount {
  kind: TaskKind
  count: number
}

export interface TasksPayload {
  /** Active tasks, running first (old field name kept for compatibility). */
  tasks: TaskRecord[]
  /** Archived tasks, newest first, after applying the request filters. */
  history: TaskRecord[]
  /** Number of archived tasks matching the filters. */
  total: number
  /** Per-kind counts over the whole archive, independent of filters. */
  counts: TaskKindCount[]
  /** Bounds of the whole archive. */
  firstAt: string | null
  lastAt: string | null
}

/** Backward-compatible aliases for code that still speaks the old names. */
export type ActiveTaskKind = TaskKind
export type ActiveTask = TaskRecord


export interface SearchHit {
  paperId: string
  title: string
  year?: number
  page: number
  quote: string
  kind?: string
  score?: number
  reason: string
}

/** One exact match in the paper that is currently open, in reading order. */
export interface PaperSearchHit {
  page: number
  /** Text block that holds the match, so the page can flash its paragraph. */
  blockId: string
  /** `[x, y, w, h]` in PDF points, the same space annotations use. */
  bbox: [number, number, number, number]
  /** Whitespace-collapsed snippet with a little context around the match. */
  quote: string
  /** Match offsets inside `quote`, for the highlighted `<mark>`. */
  quoteStart: number
  quoteLength: number
}

export interface PaperSearchPayload {
  query: string
  /** Every occurrence, even when `hits` is capped by `limit`. */
  total: number
  hits: PaperSearchHit[]
  /** The paper has no parsed text layer, so there is nothing to search. */
  noText?: boolean
}

/** Where a library-wide query matched one paper. */
export type LibrarySearchField =
  | 'title'
  | 'author'
  | 'tag'
  | 'summary'
  | 'abstract'
  | 'venue'
  | 'identifier'
  | 'note'
  | 'fulltext'

/** One paper that matched a library-wide query, with the best snippet. */
export interface LibrarySearchMatch {
  paperId: string
  fields: LibrarySearchField[]
  /** Page of the best note / full-text hit; absent for metadata-only matches. */
  page?: number
  /** Short snippet for the best note / full-text hit. */
  quote?: string
}

export interface LibrarySearchPayload {
  query: string
  matches: LibrarySearchMatch[]
  total: number
}

/** One per-signal score behind an edge; every value is normalised to 0–1. */
export interface RelationSignals {
  ref?: number
  concept?: number
  claim?: number
  lexical?: number
  external?: number
}

/** Human-readable proof for an edge, rendered as chips in the UI. */
export interface RelationEvidence {
  sharedConcepts?: string[]
  sharedRefs?: string[]
  /** Index into the citing paper's `references` array (cites only). */
  refIndex?: number
  /** Which side the model's direction points at (`a2b` = from → to). */
  direction?: 'a2b' | 'b2a'
  /** One short quote/paraphrase from each side, written by the model. */
  noteA?: string
  noteB?: string
}

export interface EdgeView {
  id: string
  paperId: string
  title: string
  year?: number
  kind: EdgeKind
  reason: string
  direction: 'in' | 'out'
  origin: 'auto' | 'user'
  confidence: number
  status?: EdgeStatus
  signals?: RelationSignals
  evidence?: RelationEvidence
}

export interface GlobalEdge {
  id: string
  from: { id: string; title: string }
  to: { id: string; title: string }
  kind: EdgeKind
  reason: string
  origin: 'auto' | 'user'
  confidence: number
  status?: EdgeStatus
  signals?: RelationSignals
  evidence?: RelationEvidence
}

/** An edge as persisted in `relations.json`. */
export interface RelationEdge {
  from: string
  to: string
  kind: EdgeKind
  reason: string
  origin: 'auto' | 'user'
  confidence: number
  /** Absent on edges written before v2 of the relations page: treat as confirmed. */
  status?: EdgeStatus
  signals?: RelationSignals
  evidence?: RelationEvidence
  /** `provider/model` that wrote the reason, when it came from the model. */
  model?: string
  at?: string
}

/**
 * The structured half of a paper's summary that the relation engine uses.
 *
 * Generated once per paper (cheap call) and reused for scoring, the graph's
 * explanation chips, and the AI insight. `fingerprint` is a self-description
 * phrased so that a second paper about the same thing overlaps lexically: it
 * stands in for an embedding until the host exposes one.
 */
export interface PaperProfile {
  paperId: string
  question: string
  method: string
  approach: string
  claims: string[]
  concepts: string[]
  tasks: string[]
  limitations: string[]
  fingerprint: string
  /** Hash of the source material; a mismatch means the profile is stale. */
  contentHash: string
  model: string
  createdAt: string
}

export interface RelationGraphNode {
  id: string
  title: string
  year?: number
  venue?: string
  tldr?: string
  tags: string[]
  /** Cluster id (`c1`, `c2`, …) or `solo` for an unconnected paper. */
  cluster: string
  degree: number
  /** Sum of edge confidences. */
  weight: number
  isolated: boolean
  missing?: boolean
  hasProfile: boolean
  /** Another live paper whose normalised title is nearly identical. */
  duplicateOf?: string
}

export interface RelationGraphEdge {
  id: string
  from: string
  to: string
  kind: EdgeKind
  reason: string
  confidence: number
  status: EdgeStatus
  direction?: 'a2b' | 'b2a'
  signals?: RelationSignals
  evidence?: RelationEvidence
  origin: 'auto' | 'user'
}

export interface RelationCluster {
  id: string
  label: string
  paperIds: string[]
  /** Palette slot 0–5. */
  color: number
  aiNamed: boolean
}

export interface RelationStats {
  papers: number
  /** Papers omitted from the payload because `limit` was reached. */
  hidden: number
  edges: number
  confirmed: number
  suggested: number
  isolated: number
  /** Share of papers with at least one confirmed edge, 0–1. */
  coverage: number
  /**
   * Deterministic layers are always on; `ai` is false when the model is
   * unavailable, so the UI can say why reasons/insights are missing.
   */
  ai: boolean
  /** The relations page's model switch is off (distinct from "no model configured"). */
  aiDisabled?: boolean
}

export interface RelationGraph {
  generatedAt: string
  nodes: RelationGraphNode[]
  edges: RelationGraphEdge[]
  clusters: RelationCluster[]
  stats: RelationStats
}

/** The cached, model-written paragraph above the related list. */
export interface RelationInsight {
  paperId: string
  text: string
  bullets: string[]
  model: string
  createdAt: string
  stale: boolean
  /** Host-only cache key; opaque to the browser. */
  signature?: string
}

export type RelationFeedbackAction = 'accept' | 'reject' | 'pin' | 'delete'

/** What a PaperReader model call was for; shown as the usage breakdown. */
export type UsagePurpose =
  | 'summary'
  | 'profile'
  | 'relation'
  | 'cluster'
  | 'insight'
  | 'search'
  | 'chat'
  | 'ask'
  | 'translate'
  | 'other'

export interface UsageTotals {
  input: number
  output: number
  cacheRead: number
  cacheWrite: number
  reasoning: number
  total: number
  calls: number
}

export interface UsageDay extends UsageTotals {
  /** Local calendar day, `YYYY-MM-DD`. */
  date: string
}

export interface UsageModel extends UsageTotals {
  provider: string
  model: string
}

export interface UsageSource extends UsageTotals {
  source: UsagePurpose
}

/** Daily token ledger projection used by 设置 → 用量. */
export interface UsagePayload {
  /** Inclusive local dates, `YYYY-MM-DD`. */
  from: string
  to: string
  total: UsageTotals
  /** Only days with at least one recorded call; the client fills gaps. */
  days: UsageDay[]
  models: UsageModel[]
  sources: UsageSource[]
  /** Bounds of the whole ledger, not just the requested range. */
  firstAt: string | null
  lastAt: string | null
}

export interface AppConfig {
  version?: number
  watchFolders: string[]
  provider: string
  model: string
  autoSummarize: boolean
  summarizeBudgetChars?: number
  maxImportBytes: number
  /**
   * Master switch for every token-consuming feature.
   *
   * `false` blocks summaries, relations AI, search reranking, chat, explanation,
   * translation and compaction. Absent on old configs means "on".
   */
  aiEnabled?: boolean
  /** Show the per-paper DSH sessions in the harness sidebar (own workspace group). */
  paperSessionInSidebar: boolean
  /**
   * Whether the relations page may call the model.
   *
   * `false` keeps the deterministic citation/text signals but skips AI profiles,
   * pair judging, theme naming and the per-paper insight. Absent on old configs
   * means "on", so upgrading never silently disables the feature.
   */
  relationsUseModel?: boolean
  /**
   * Experimental: keep the full-text translation entry in the reader toolbar.
   *
   * Off by default: experimental features must be turned on explicitly. The
   * setting only hides the entry; cached translations and the per-tab
   * translation view are kept for when it is turned back on.
   */
  experimentalFullTextTranslation?: boolean
  /**
   * Experimental: let the user pick a custom translation source.
   *
   * Off by default. While off the translation section is hidden and every
   * translation falls back to the DSH model, but the saved choice survives so
   * turning it back on restores the user's configuration.
   */
  experimentalTranslationSources?: boolean
  /** Translation source configuration; ignored while the experiment is off. */
  translation?: TranslationSettings
  /** Response-only: which API keys the credential store already holds. */
  translationKeys?: Partial<Record<TranslationApiKind | 'local', boolean>>
  /**
   * Experimental: show the current-task page in the plugin sidebar.
   *
   * Off by default because it depends on host-side activity endpoints that are
   * still being shaped.
   */
  experimentalTaskCenter?: boolean
  /** Default layout of the library and recent pages: `list` table, `grid` cards. */
  libraryDefaultView?: 'list' | 'grid'
  /** How many papers the recent page lists. */
  recentLimit?: number
  /** Response-only: whether this profile can host DSH sessions at all. */
  sessionsAvailable?: boolean
  inbox?: string
  home?: string
  available?: boolean
  route?: { provider: string; model: string } | null
}

export interface ModelCatalog {
  available: boolean
  providers: Array<{
    id: string
    name: string
    models: Array<{ id: string; name: string }>
    error?: string
  }>
  default: { provider: string; model: string } | null
  current: { provider: string; model: string } | null
}

export interface LibraryPayload {
  papers: Paper[]
  folders: Folder[]
  /** Soft-deleted papers, newest deletion first. */
  trash: Paper[]
  unfiled: number
  tags: Array<{ tag: string; count: number }>
  counts: {
    all: number
    todo: number
    reading: number
    done: number
    recent: number
    trash: number
  }
}

export interface SearchPayload {
  query: string
  hits: SearchHit[]
  reranked: boolean
}

export interface ImportPdfPayload {
  jobId: string
  fileName: string
  filePath: string
}

export interface ImportUrlPayload {
  jobId: string
  url: string
}

export interface ImportFilePayload {
  jobId: string
  filePath: string
}

export interface ScanPayload {
  scanned: number
  added: number
  jobs: string[]
}
