/**
 * The task list's single endpoint: active work plus durable history.
 *
 * The host task center already aggregates jobs, translation, summary runs and
 * live chat turns, and attributes token usage to each one. This route only
 * validates the filters and projects the result.
 */

import type { TaskKind, TaskState } from '../../../shared/domain.js'
import type { HostApp } from '../../app.js'
import { sendJson } from '../http.js'
import type { Route } from '../types.js'

const KINDS: TaskKind[] = ['import', 'relations', 'summary', 'translation', 'chat']
const STATES: TaskState[] = ['queued', 'running', 'done', 'failed', 'canceled']

function oneOf<T extends string>(value: string | null, allowed: T[]): T | 'all' {
  return allowed.includes(value as T) ? (value as T) : 'all'
}

function day(value: string | null): string | undefined {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : undefined
}

export function registerTasks(routes: Route[], app: HostApp): void {
  routes.push(['GET', /^tasks\/?$/, async (ctx) => {
    const { searchParams } = ctx.url
    const limit = Math.min(200, Math.max(1, Number(searchParams.get('limit')) || 50))
    const offset = Math.max(0, Number(searchParams.get('offset')) || 0)
    sendJson(ctx.res, 200, app.tasks.snapshot({
      kind: oneOf(searchParams.get('kind'), KINDS),
      state: oneOf(searchParams.get('state'), STATES),
      q: searchParams.get('q') ?? '',
      ...(day(searchParams.get('from')) ? { from: day(searchParams.get('from')) } : {}),
      ...(day(searchParams.get('to')) ? { to: day(searchParams.get('to')) } : {}),
      limit,
      offset,
    }))
  }])
}
