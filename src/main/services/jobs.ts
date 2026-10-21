import { EventEmitter } from 'node:events'
import type { JobState } from '../../shared/types'
import { describeError } from './http'
import { newId } from './util'

export interface JobContext {
  update(patch: Partial<Pick<JobState, 'title' | 'detail' | 'progress' | 'stage'>>): void
  get(): JobState
}

type Runner<T> = (context: JobContext) => Promise<T>

interface InternalJob {
  state: JobState
  queueTask?: Promise<void>
}

const MAX_COMPLETED = 30

export class JobManager extends EventEmitter {
  private jobs = new Map<string, InternalJob>()
  private queue: Promise<void> = Promise.resolve()

  constructor() {
    super()
  }

  list(): JobState[] {
    return [...this.jobs.values()]
      .map((job) => ({ ...job.state, meta: job.state.meta ? { ...job.state.meta } : undefined }))
      .sort((a, b) => b.createdAt - a.createdAt)
  }

  get(id: string): JobState | undefined {
    const job = this.jobs.get(id)
    return job ? { ...job.state } : undefined
  }

  enqueue<T>(kind: JobState['kind'], title: string, meta: JobState['meta'], runner: Runner<T>): string {
    const id = newId('job-')
    const state: JobState = {
      id,
      kind,
      title,
      detail: '等待开始…',
      status: 'queued',
      progress: 0,
      stage: 'queued',
      createdAt: Date.now(),
      meta
    }
    const internal: InternalJob = { state }
    this.jobs.set(id, internal)
    this.emitUpdate(internal.state)

    const context: JobContext = {
      update: (patch) => {
        if (internal.state.status === 'queued' && patch.stage !== 'queued') {
          internal.state.status = 'running'
          internal.state.startedAt = internal.state.startedAt ?? Date.now()
        }
        const previousProgress = internal.state.progress
        const { progress: nextProgress, ...incoming } = patch
        Object.assign(internal.state, incoming)
        if (nextProgress !== undefined) {
          const value = Number(nextProgress)
          internal.state.progress = Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : previousProgress
        }
        this.emitUpdate(internal.state)
      },
      get: () => ({ ...internal.state })
    }

    internal.queueTask = this.queue.then(async () => {
      if (internal.state.status === 'done' || internal.state.status === 'error') return
      internal.state.status = 'running'
      internal.state.startedAt = Date.now()
      internal.state.stage = 'running'
      internal.state.detail = '正在准备…'
      this.emitUpdate(internal.state)
      try {
        await runner(context)
        internal.state.status = 'done'
        internal.state.progress = 100
        internal.state.stage = 'done'
        internal.state.detail = '已完成'
        internal.state.finishedAt = Date.now()
        this.emitUpdate(internal.state)
      } catch (error) {
        internal.state.status = 'error'
        internal.state.stage = 'error'
        internal.state.error = describeError(error)
        internal.state.detail = '任务失败'
        internal.state.finishedAt = Date.now()
        this.emitUpdate(internal.state)
      }
      this.prune()
    })
    this.queue = internal.queueTask.catch(() => {})
    return id
  }

  dismiss(id: string): void {
    const job = this.jobs.get(id)
    if (!job) return
    if (job.state.status === 'running' || job.state.status === 'queued') return
    this.jobs.delete(id)
  }

  dismissCompleted(): void {
    for (const [id, job] of this.jobs) {
      if (job.state.status === 'done' || job.state.status === 'error') this.jobs.delete(id)
    }
  }

  private prune(): void {
    const completed = [...this.jobs.values()]
      .filter((job) => job.state.status === 'done' || job.state.status === 'error')
      .sort((a, b) => (a.state.finishedAt ?? 0) - (b.state.finishedAt ?? 0))
    while (completed.length > MAX_COMPLETED) {
      const job = completed.shift()
      if (job) this.jobs.delete(job.state.id)
    }
  }

  private emitUpdate(state: JobState): void {
    this.emit('update', { ...state, meta: state.meta ? { ...state.meta } : undefined })
  }
}