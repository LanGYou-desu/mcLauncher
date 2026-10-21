import { useEffect, useMemo, useState } from 'react'
import { ChevronDown, ChevronUp, CircleAlert, LoaderCircle, PackageCheck, X } from 'lucide-react'
import type { JobState } from '../../../shared/types'
import { useLauncher } from '../lib/launcher-context'

const STAGE_LABELS: Record<string, string> = {
  queued: '排队中',
  running: '准备中',
  meta: '解析版本',
  minecraft: '安装游戏',
  loader: '安装加载器',
  download: '下载文件',
  assets: '下载资源',
  libraries: '运行库',
  instance: '创建实例',
  pack: '下载整合包',
  resolve: '解析内容',
  files: '安装内容',
  overrides: '应用配置',
  finishing: '收尾',
  done: '已完成',
  error: '失败'
}

function JobRow({ job, onDismiss }: { job: JobState; onDismiss: (id: string) => void }) {
  const active = job.status === 'running' || job.status === 'queued'
  const failed = job.status === 'error'
  const complete = job.status === 'done'
  return (
    <div className={`job-row ${failed ? 'is-error' : ''} ${complete ? 'is-done' : ''}`}>
      <div className="job-row-top">
        <span className="job-state-icon">
          {failed ? <CircleAlert size={16} /> : complete ? <PackageCheck size={16} /> : <LoaderCircle size={16} className="spin" />}
        </span>
        <div className="job-main">
          <div className="job-title-line">
            <span className="job-title">{job.title}</span>
            {!active ? (
              <button className="job-dismiss" onClick={() => onDismiss(job.id)} type="button" aria-label="移除任务">
                <X size={13} />
              </button>
            ) : (
              <span className="job-percent">{Math.round(job.progress)}%</span>
            )}
          </div>
          <div className="job-detail">{failed ? job.error || job.detail : job.detail}</div>
          <div className="job-progress">
            <span style={{ width: Math.max(failed || complete ? 100 : 3, job.progress) + '%' }} />
          </div>
        </div>
      </div>
      <div className="job-meta-line">
        <span>{failed ? '任务失败' : complete ? '任务完成' : STAGE_LABELS[job.stage] ?? job.stage}</span>
        {job.meta?.mcVersion ? <span>MC {job.meta.mcVersion}</span> : null}
        {active ? <span>请保持网络连接</span> : null}
      </div>
    </div>
  )
}

export function JobsDock() {
  const { jobs, dismissJob } = useLauncher()
  const active = useMemo(() => jobs.filter((job) => job.status === 'running' || job.status === 'queued'), [jobs])
  const recent = useMemo(() => jobs.filter((job) => job.status === 'done' || job.status === 'error').slice(0, 2), [jobs])
  const [expanded, setExpanded] = useState(true)
  const visible = active.length ? active.slice(0, 3) : recent

  useEffect(() => {
    if (active.length) setExpanded(true)
  }, [active.length])

  if (!visible.length) return null
  const overall = active.length
    ? Math.round(active.reduce((sum, job) => sum + job.progress, 0) / active.length)
    : 100

  if (!expanded) {
    return (
      <button className="jobs-pill" type="button" onClick={() => setExpanded(true)}>
        {active.length ? <LoaderCircle size={15} className="spin" /> : <PackageCheck size={15} />}
        <span>{active.length ? active.length + ' 个任务进行中 · ' + overall + '%' : '任务已完成'}</span>
        <ChevronUp size={14} />
      </button>
    )
  }

  return (
    <section className="jobs-dock">
      <header className="jobs-header">
        <div>
          <span className={`jobs-live ${active.length ? 'active' : ''}`} />
          <strong>{active.length ? '下载任务' : '最近任务'}</strong>
          {active.length ? <em>{active.length} 个进行中</em> : null}
        </div>
        <div className="jobs-header-actions">
          {recent.length ? (
            <button type="button" onClick={() => { recent.forEach((job) => dismissJob(job.id)) }}>清空</button>
          ) : null}
          <button type="button" aria-label="收起任务" onClick={() => setExpanded(false)}>
            <ChevronDown size={15} />
          </button>
        </div>
      </header>
      <div className="jobs-body">
        {visible.map((job) => <JobRow key={job.id} job={job} onDismiss={dismissJob} />)}
      </div>
      <footer className="jobs-footer">
        <span>{active.length ? '任务按顺序执行，可继续浏览其他页面' : '所有任务已完成'}</span>
      </footer>
    </section>
  )
}
