/**
 * Per-file write queue for jobs plus the in-process job runner.
 *
 * A single import runs at a time: PDF parsing is CPU-bound and the UI only
 * shows progress, so concurrency buys nothing and makes ordering confusing.
 */

import path from 'node:path'
import type { Job, JobSource, JobStepState } from '../../shared/domain.js'
import type { Store } from '../library/store.js'
import { nowIso } from '../util/util.js'
import { createJob, type StepSpec } from './job.js'

type JobListener = (job: Job) => void
type JobRunner = (job: Job) => Promise<void> | void

export interface JobQueue {
  saveJob(job: Job): Promise<void>
  setStep(job: Job, key: string, state: JobStepState, detail?: string): Promise<void>
  enqueue(source: JobSource): Job
  enqueueTask(task: { kind: string; source: JobSource; sourceLabel: string; steps: StepSpec[] }): Job
  onJobRunner(fn: JobRunner): void
  waitIdle(): Promise<void>
  /** Jobs that are running or waiting, running first; memory-only. */
  active(): Job[]
  subscribeJob(jobId: string, listener: JobListener): () => void
}

export function createJobQueue({
  store,
  log,
}: {
  store: Store
  log: (message: string, error?: unknown) => void
}): JobQueue {
  const listeners = new Map<string, Set<JobListener>>()
  const queue: Job[] = []
  let running = false
  let current: Job | null = null
  let runner: JobRunner | null = null

  const emit = (job: Job): void => {
    for (const listener of listeners.get(job.id) ?? []) listener(job)
  }

  const saveJob = async (job: Job): Promise<void> => {
    job.updatedAt = nowIso()
    await store.writeJob(job)
    emit(job)
  }

  const setStep = async (
    job: Job,
    key: string,
    state: JobStepState,
    detail?: string,
  ): Promise<void> => {
    const step = job.steps.find((item) => item.key === key)
    if (step) {
      step.state = state
      step.detail = detail
      step.at = nowIso()
    }
    await saveJob(job)
  }

  async function kickQueue(): Promise<void> {
    if (running) return
    running = true
    try {
      while (queue.length > 0) {
        const job = queue.shift() as Job
        current = job
        try {
          await runner?.(job)
        } catch (error) {
          log('job runner crashed', error)
        } finally {
          current = null
        }
      }
    } finally {
      running = false
    }
  }

  function enqueueTask({ kind, source, sourceLabel, steps }: { kind: string; source: JobSource; sourceLabel: string; steps: StepSpec[] }): Job {
    const job = createJob(kind, { source, sourceLabel, paperId: null }, steps)
    queue.push(job)
    void store.writeJob(job)
    void kickQueue()
    return job
  }

  function enqueue(source: JobSource): Job {
    const job = createJob('import', {
      source,
      sourceLabel: source.kind === 'file' ? path.basename(source.filePath ?? '') : source.url ?? '',
      paperId: null,
    })
    queue.push(job)
    void store.writeJob(job)
    void kickQueue()
    return job
  }

  function onJobRunner(fn: JobRunner): void {
    runner = fn
  }

  async function waitIdle(): Promise<void> {
    while (running || queue.length > 0) await new Promise((resolve) => setTimeout(resolve, 40))
  }

  /** Memory-only truth for the task page; disk can hold a stale `running`. */
  function active(): Job[] {
    return current ? [current, ...queue] : [...queue]
  }

  function subscribeJob(jobId: string, listener: JobListener): () => void {
    const set = listeners.get(jobId) ?? new Set<JobListener>()
    set.add(listener)
    listeners.set(jobId, set)
    return () => {
      set.delete(listener)
      if (set.size === 0) listeners.delete(jobId)
    }
  }

  return { saveJob, setStep, enqueue, enqueueTask, onJobRunner, waitIdle, active, subscribeJob }
}
