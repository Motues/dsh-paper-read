/**
 * PaperReader — host half.
 *
 * Mounts the library service and its HTTP surface on the harness web server.
 * Everything durable lives under `$DSH_HOME/paperreader/`.
 */

import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createApp } from './app.js'
import type { ChatBridge } from './ai/chat.js'
import type { CredentialsLike } from './ai/engines/registry.js'
import type { NativeTranslatorService } from './ai/engines/mt.js'
import type { LlmService, ModelRoute } from './ai/summoner.js'
import { installImportRunner } from './ingest/pipeline.js'
import { createHandler, ROUTE_PATH } from './http/handler.js'

export const name = 'dsh-paper-read'
/**
 * `webServer` is the only *required* service: the library, the reader and the
 * one-shot fallback must keep working in a profile without agents.
 *
 * Everything the session-backed conversation needs (`agents`, `agentPresets`,
 * `sessions`, `sessionPersistence`, `sessionQuery`, `tokenMeter`, `compaction`,
 * `workspaceRegistry`, `sessionTitle`) is read through `ctx.get()` on use, so a
 * profile that mounts them later — or never — changes behaviour, not loading.
 */
export const inject = ['webServer']

interface HostContext {
  get(name: string): unknown
  on?(name: string, listener: (payload: any) => void): () => void
  effect(run: () => void | (() => void)): void
  webServer: {
    register(options: {
      kind: 'prefix'
      path: string
      handler: (req: IncomingMessage, res: ServerResponse) => Promise<void> | void
    }): () => void
  }
  logger?: {
    warn?(message: string): void
    debug?(message: string): void
  }
}

function resolveHome(): string {
  const fromEnv = process.env.DSH_HOME
  if (fromEnv && fromEnv.trim() !== '') return fromEnv
  return path.join(process.env.USERPROFILE ?? os.homedir(), '.dsh')
}

/** `dist/host/index.js` → `dist/vendor/pdf.worker.min.mjs`. */
function resolveWorker(): string {
  return fileURLToPath(new URL('../vendor/pdf.worker.min.mjs', import.meta.url))
}

/** `dist/host/index.js` → `dist/vendor/` (KaTeX CSS and fonts). */
function resolveVendor(): string {
  return fileURLToPath(new URL('../vendor', import.meta.url))
}

/**
 * Adapt the Cordis context into the two closures the chat service needs.
 *
 * A missing service is `undefined`, never an exception: `ctx.get` is the
 * optional-read form and the only thing that has to be true is `webServer`.
 */
function createBridge(ctx: HostContext): ChatBridge {
  return {
    service(name) {
      try {
        return ctx.get(name) ?? undefined
      } catch {
        return undefined
      }
    },
    on(name, listener) {
      try {
        const disposer = ctx.on?.(name, listener)
        return typeof disposer === 'function' ? disposer : () => {}
      } catch {
        return () => {}
      }
    },
  }
}

export function apply(ctx: HostContext): void {
  const log = (message: string, error?: unknown): void => {
    const detail = error instanceof Error ? error.message : error
    if (detail !== undefined) ctx.logger?.warn?.(`[dsh-paper-read] ${message}: ${String(detail)}`)
    else ctx.logger?.debug?.(`[dsh-paper-read] ${message}`)
  }

  let inner: ((req: IncomingMessage, res: ServerResponse) => Promise<void>) | null = null
  const ready = (async () => {
    const app = await createApp({
      home: resolveHome(),
      getLlm: () => (ctx.get('llm') as LlmService | undefined) ?? undefined,
      getCredentials: () => {
        try {
          return (ctx.get('credentials') as CredentialsLike | undefined) ?? undefined
        } catch {
          return undefined
        }
      },
      getTranslator: () => {
        try {
          return (ctx.get('translator') as NativeTranslatorService | undefined) ?? undefined
        } catch {
          return undefined
        }
      },
      getSelection: () => {
        try {
          const model = ctx.get('agentDefaultModel') as { currentSelection?(): ModelRoute } | undefined
          return model?.currentSelection?.()
        } catch {
          return undefined
        }
      },
      bridge: createBridge(ctx),
      log,
    })
    installImportRunner(app)
    inner = createHandler(app, { workerPath: resolveWorker(), vendorPath: resolveVendor() })
    app.log('ready')
    // Apply the sidebar preference to sessions that already exist, on every
    // start: the setting is durable, but the archive/workspace state it implies
    // must survive a restart too.
    void app.chat.syncSidebar(app.store.config.paperSessionInSidebar).catch(
      (error) => app.log('sidebar sync failed', error),
    )
    void app.scanWatchFolders().then(
      (result) => {
        if (result.jobs.length > 0) app.log(`scan enqueued ${result.jobs.length} import(s)`)
      },
      (error) => app.log('initial scan failed', error),
    )
    return app
  })()

  ready.catch((error) => log('initialization failed', error))

  // Live agents hold session write handles; release them with the plugin and
  // flush the debounced token ledger before the process goes away.
  ctx.effect(() => () => {
    ready.then((app) => {
      app.translation.dispose()
      return Promise.all([app.chat.disposeAll(), app.usage.flush(), app.tasks.flush()])
    }).catch(() => {})
  })

  const handler = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    try {
      await ready
    } catch (error) {
      res.writeHead(503, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' })
      res.end(JSON.stringify({
        error: {
          code: 'INIT_FAILED',
          message: `文献库初始化失败：${error instanceof Error ? error.message : String(error)}`,
        },
      }))
      return
    }
    return inner ? inner(req, res) : undefined
  }

  ctx.effect(() => ctx.webServer.register({ kind: 'prefix', path: ROUTE_PATH, handler }))
}
