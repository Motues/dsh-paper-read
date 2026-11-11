/**
 * The paper library's slice of the DSH sidebar: one root workspace, one child
 * folder per paper and the archive state of every paper conversation.
 *
 * Session workspace membership is validated by DSH against the session's
 * original header cwd, so every paper session is created inside
 * `workspace/<paperId>` (see chat.ts) and only those sessions can attach to the
 * matching child folder.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'
import type { PaperRecord } from '../../shared/domain.js'
import type { Store } from '../library/store.js'
import type { SessionPersistenceLike, WorkspaceLike, WorkspaceRegistryLike } from './chat-contract.js'
import { PAPER_WORKSPACE_TITLE } from './chat-contract.js'
import { truncate } from '../util/util.js'

/** Longest workspace title shown in the harness sidebar. */
const WORKSPACE_TITLE_MAX = 48

/** Canonical paper directory under the shared library root: `workspace/<paperId>` is both the paper workspace and the cwd of its sessions. */
export function paperWorkspaceDir(root: string, paperId: string): string {
  return path.join(root, paperId)
}

export interface PaperWorkspaceDeps {
  store: Store
  log: (message: string, error?: unknown) => void
  registry: () => WorkspaceRegistryLike | undefined
  persistence: () => SessionPersistenceLike | undefined
  sessionIdsOf: (paper: PaperRecord) => string[]
  archivedSet: (paper: PaperRecord) => Set<string>
  /** Dispose a live agent before its session is archived or reset. */
  forget: (sessionId: string) => Promise<void>
}

export interface PaperWorkspaces {
  setArchived(sessionId: string, archived: boolean): Promise<void>
  syncSidebar(enabled: boolean): Promise<void>
  joinGroup(sessionId: string, paper: PaperRecord): Promise<void>
  dropWorkspace(paperId: string): Promise<void>
}

export function createPaperWorkspaces(deps: PaperWorkspaceDeps): PaperWorkspaces {
  const { store, log, sessionIdsOf, archivedSet, forget } = deps
  const getRegistry = deps.registry
  const getPersistence = deps.persistence

  // ── sidebar visibility ───────────────────────────────────────────────────
  /**
   * The harness refuses to open a step on an *archived* session
   * (`archived-session-gate` rejects it as `blocked`). Hiding paper sessions is
   * an archive, so a hidden session is unarchived for the duration of a turn and
   * archived again once the turn settles.
   */
  async function setArchived(sessionId: string, archived: boolean): Promise<void> {
    const registry = getRegistry()
    if (!registry) return
    try {
      if (archived) await registry.archiveSession(sessionId)
      else await registry.unarchiveSession(sessionId)
    } catch (error) {
      log(`${archived ? 'archive' : 'unarchive'} failed: ${sessionId}`, error)
    }
  }

  function workspaceTitle(paper: PaperRecord): string {
    const title = paper.title.replace(/\s+/g, ' ').trim()
    return truncate(title || `论文 ${paper.id.slice(0, 8)}`, WORKSPACE_TITLE_MAX)
  }

  /** Register the container group; paper folders nest under it in tree view. */
  async function ensureRootGroup(registry: WorkspaceRegistryLike): Promise<WorkspaceLike | undefined> {
    try {
      await fs.mkdir(store.workspaceDir, { recursive: true })
      return await registry.create(store.workspaceDir, PAPER_WORKSPACE_TITLE)
    } catch (error) {
      log('workspace root create failed', error)
      return undefined
    }
  }

  async function deleteWorkspaceAt(dir: string): Promise<void> {
    const registry = getRegistry()
    if (!registry) return
    try {
      const found = await registry.resolveByPath(dir)
      if (found) await registry.delete(found.id)
    } catch (error) {
      log(`workspace delete failed: ${dir}`, error)
    }
  }

  /** Compare directory identities, following junctions/symlinks like DSH does. */
  async function canonicalDir(dir: string): Promise<string> {
    try {
      return await fs.realpath(dir)
    } catch {
      return path.resolve(dir)
    }
  }

  async function sessionCwd(sessionId: string): Promise<string | undefined> {
    try {
      const stat = await getPersistence()?.stat?.(sessionId)
      return stat?.header?.cwd
    } catch {
      return undefined
    }
  }

  /** Sessions created before per-paper cwds: their header still points at the root. */
  async function legacySessionIds(paper: PaperRecord): Promise<string[]> {
    const root = await canonicalDir(store.workspaceDir)
    const legacy: string[] = []
    for (const id of sessionIdsOf(paper)) {
      const cwd = await sessionCwd(id)
      if (!cwd) continue
      if ((await canonicalDir(cwd)) === root) legacy.push(id)
    }
    return legacy
  }

  /**
   * DSH validates workspace membership against the session's original header
   * cwd and offers no way to rewrite it, so a conversation created before the
   * per-paper directories can never move into its paper folder. This is a test
   * build: drop those conversations from the paper record and archive the log
   * (kept on disk, never deleted) instead of leaving them in "Ungrouped".
   */
  async function clearLegacySessions(paper: PaperRecord): Promise<void> {
    const legacy = await legacySessionIds(paper)
    if (legacy.length === 0) return
    const gone = new Set(legacy)
    for (const id of legacy) await forget(id)
    // A legacy group may still own the session from the old single-folder
    // design; detach it so "show archived" cannot resurface it either.
    const root = await getRegistry()?.resolveByPath(store.workspaceDir).catch(() => undefined)
    for (const id of legacy) {
      try {
        await getRegistry()?.archiveSession(id, { stopActivity: true })
      } catch (error) {
        log(`legacy archive failed: ${id}`, error)
      }
      try {
        await root?.detachSession?.(id)
      } catch (error) {
        log(`legacy detach failed: ${id}`, error)
      }
    }

    const retiredSessions = (paper.retiredSessions ?? []).filter((id) => !gone.has(id))
    const conversationTitles = { ...(paper.conversationTitles ?? {}) }
    for (const id of legacy) delete conversationTitles[id]
    const archivedConversations = (paper.archivedConversations ?? []).filter((id) => !gone.has(id))
    const active = store.sessionIdFor(paper)
    await store.updatePaper(paper.id, {
      ...(gone.has(active) ? { sessionId: `pr-${paper.id}-${randomUUID().slice(0, 8)}` } : {}),
      retiredSessions,
      conversationTitles,
      archivedConversations,
    })
    log(`legacy conversations cleared: ${paper.id} (${legacy.length})`)
  }

  async function syncSidebar(enabled: boolean): Promise<void> {
    const registry = getRegistry()
    if (!registry) return
    const papers = store.activePapers()

    if (!enabled) {
      for (const paper of papers) {
        if (!paper.sessionId && (paper.retiredSessions?.length ?? 0) === 0) continue
        for (const id of sessionIdsOf(paper)) {
          try {
            await registry.archiveSession(id)
          } catch (error) {
            // A session with a running turn refuses to be archived; the next
            // sync (after the turn ends) picks it up.
            log(`archive skipped: ${id}`, error)
          }
        }
      }
      for (const paper of papers) await deleteWorkspaceAt(paperWorkspaceDir(store.workspaceDir, paper.id))
      await deleteWorkspaceAt(store.workspaceDir)
      return
    }

    // Old conversations cannot be re-homed; clear them once so the sidebar
    // starts from paper directories instead of a pile of ungrouped sessions.
    for (const paper of papers) {
      try {
        await clearLegacySessions(paper)
      } catch (error) {
        log(`legacy cleanup failed: ${paper.id}`, error)
      }
    }

    await ensureRootGroup(registry)
    // Root and current paper folders are the only registrations this plugin
    // owns; the cleanup below removes stale children of deleted papers.
    const wanted = new Set<string>([path.resolve(store.workspaceDir)])
    for (const paper of store.activePapers()) {
      const ids = sessionIdsOf(paper)
      if (ids.length === 0) continue
      const dir = paperWorkspaceDir(store.workspaceDir, paper.id)
      const dirKey = await canonicalDir(dir)
      // Only sessions whose header cwd is this paper's directory can belong to
      // its workspace; anything else is a legacy conversation cleaned above.
      const own: string[] = []
      for (const id of ids) {
        const cwd = await sessionCwd(id)
        if (cwd && (await canonicalDir(cwd)) === dirKey) own.push(id)
      }
      if (own.length === 0) continue
      wanted.add(path.resolve(dir))
      try {
        await fs.mkdir(dir, { recursive: true })
      } catch (error) {
        log(`paper workspace create failed: ${dir}`, error)
        continue
      }
      let group: WorkspaceLike | undefined
      try {
        group = await registry.create(dir, workspaceTitle(paper))
      } catch (error) {
        log('workspace create failed', error)
      }
      const archived = archivedSet(paper)
      for (const id of own) {
        // Membership is recorded, not derived: a session made outside the API
        // session controller stays in "Ungrouped" until it is attached.
        try {
          await group?.attachSession?.(id)
        } catch (error) {
          log(`workspace attach failed: ${id}`, error)
        }
        try {
          if (archived.has(id)) await registry.archiveSession(id)
          else await registry.unarchiveSession(id)
        } catch (error) {
          log(`workspace visibility failed: ${id}`, error)
        }
      }
    }

    // Groups whose paper is gone (deleted while the sidebar was off, or a stale
    // per-paper directory) would otherwise linger as empty entries.
    try {
      for (const entry of registry.list?.() ?? []) {
        const entryPath = entry.path
        if (typeof entryPath !== 'string') continue
        const resolved = path.resolve(entryPath)
        const relative = path.relative(path.resolve(store.workspaceDir), resolved)
        const inside = relative !== '' && !relative.startsWith('..') && !path.isAbsolute(relative)
        if (!inside || wanted.has(resolved)) continue
        for (const id of entry.sessionIds ?? []) {
          try {
            await registry.archiveSession(id, { stopActivity: true })
          } catch (error) {
            log(`stale session archive failed: ${id}`, error)
          }
        }
        await registry.delete(entry.id)
      }
    } catch (error) {
      log('workspace list failed', error)
    }
  }

  /** Put a session in its paper's workspace group, when the sidebar is on. */
  async function joinGroup(sessionId: string, paper: PaperRecord): Promise<void> {
    if (store.config.paperSessionInSidebar !== true) return
    const registry = getRegistry()
    if (!registry) return
    await ensureRootGroup(registry)
    const dir = paperWorkspaceDir(store.workspaceDir, paper.id)
    try {
      await fs.mkdir(dir, { recursive: true })
      const group = await registry.create(dir, workspaceTitle(paper))
      await group.attachSession?.(sessionId)
      if (archivedSet(paper).has(sessionId)) await registry.archiveSession(sessionId)
      else await registry.unarchiveSession(sessionId)
    } catch (error) {
      log('workspace join failed', error)
    }
  }

  async function dropWorkspace(paperId: string): Promise<void> {
    const registry = getRegistry()
    if (!registry) return
    const paper = store.getPaper(paperId)
    const prefix = `pr-${paperId}`
    const ids = new Set<string>(paper ? sessionIdsOf(paper) : [])
    const root = await registry.resolveByPath(store.workspaceDir).catch(() => undefined)
    const group = await registry.resolveByPath(paperWorkspaceDir(store.workspaceDir, paperId)).catch(() => undefined)
    // The paper record may already be gone when this runs; recover the ids
    // from the two groups it could still be registered in.
    for (const candidate of [root, group]) {
      for (const id of candidate?.sessionIds ?? []) {
        if (id === prefix || id.startsWith(`${prefix}-`)) ids.add(id)
      }
    }
    for (const id of ids) {
      await forget(id)
      try {
        await registry.archiveSession(id, { stopActivity: true })
      } catch (error) {
        log(`archive on delete failed: ${id}`, error)
      }
      try {
        await group?.detachSession?.(id)
      } catch (error) {
        log(`paper workspace detach failed: ${id}`, error)
      }
      try {
        await root?.detachSession?.(id)
      } catch (error) {
        log(`root workspace detach failed: ${id}`, error)
      }
    }
    await deleteWorkspaceAt(paperWorkspaceDir(store.workspaceDir, paperId))
  }


  return { setArchived, syncSidebar, joinGroup, dropWorkspace }
}
