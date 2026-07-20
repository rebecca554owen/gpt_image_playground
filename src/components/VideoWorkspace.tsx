import { useEffect, useMemo, useState } from 'react'
import { useStore } from '../store'
import { normalizeImageApiErrorDisplayText } from '../lib/imageApiShared'
import { createVideoJob, getVideoJob, type VideoJobStatus } from '../lib/videoJobs'
import { LinkIcon, RefreshIcon, TrashIcon } from './icons'

const VIDEO_TASKS_KEY = 'gpt-image-playground-video-tasks'
const VIDEO_ENDPOINT_KEY = 'gpt-image-playground-video-endpoint'
const DEFAULT_VIDEO_ENDPOINT = '/api/video-jobs'

interface VideoTaskRecord {
  id: string
  remoteJobId?: string
  prompt: string
  imageUrl?: string
  ratio: string
  duration: number
  resolution: string
  model: string
  status: VideoJobStatus
  videoUrl?: string
  error?: string
  createdAt: number
  updatedAt: number
}

function createLocalId() {
  return `video-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`
}

function loadVideoTasks(): VideoTaskRecord[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(VIDEO_TASKS_KEY) ?? '[]')
    return Array.isArray(parsed) ? parsed.filter((item): item is VideoTaskRecord => Boolean(item?.id && item?.prompt)) : []
  } catch {
    return []
  }
}

function formatTime(value: number) {
  return new Date(value).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  })
}

export default function VideoWorkspace() {
  const showToast = useStore((s) => s.showToast)
  const [endpoint, setEndpoint] = useState(() => localStorage.getItem(VIDEO_ENDPOINT_KEY) || DEFAULT_VIDEO_ENDPOINT)
  const [prompt, setPrompt] = useState('')
  const [imageUrl, setImageUrl] = useState('')
  const [ratio, setRatio] = useState('16:9')
  const [duration, setDuration] = useState(5)
  const [resolution, setResolution] = useState('720p')
  const [tasks, setTasks] = useState<VideoTaskRecord[]>(loadVideoTasks)
  const isSubmitting = tasks.some((task) => task.status === 'running' && !task.remoteJobId)

  const runningTasks = useMemo(() => tasks.filter((task) => task.status === 'running' && task.remoteJobId), [tasks])

  useEffect(() => {
    localStorage.setItem(VIDEO_TASKS_KEY, JSON.stringify(tasks.slice(0, 80)))
  }, [tasks])

  useEffect(() => {
    localStorage.setItem(VIDEO_ENDPOINT_KEY, endpoint)
  }, [endpoint])

  useEffect(() => {
    if (!runningTasks.length) return

    let cancelled = false
    const poll = async () => {
      for (const task of runningTasks) {
        if (!task.remoteJobId || cancelled) continue
        try {
          const result = await getVideoJob(endpoint, task.remoteJobId)
          if (cancelled) return
          setTasks((current) => current.map((item) => item.id === task.id
            ? {
                ...item,
                status: result.status,
                videoUrl: result.videoUrl ?? item.videoUrl,
                error: result.error,
                updatedAt: Date.now(),
              }
            : item,
          ))
        } catch (err) {
          if (cancelled) return
          setTasks((current) => current.map((item) => item.id === task.id
            ? { ...item, status: 'error', error: err instanceof Error ? err.message : String(err), updatedAt: Date.now() }
            : item,
          ))
        }
      }
    }

    const timer = window.setInterval(poll, 5000)
    void poll()
    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [endpoint, runningTasks])

  const submit = async () => {
    const text = prompt.trim()
    if (!text) {
      showToast('请输入视频提示词', 'error')
      return
    }

    const task: VideoTaskRecord = {
      id: createLocalId(),
      prompt: text,
      imageUrl: imageUrl.trim() || undefined,
      ratio,
      duration,
      resolution,
      model: 'seedance',
      status: 'running',
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }

    setTasks((current) => [task, ...current])
    setPrompt('')

    try {
      const result = await createVideoJob(endpoint, {
        prompt: task.prompt,
        imageUrl: task.imageUrl,
        ratio: task.ratio,
        duration: task.duration,
        resolution: task.resolution,
        model: task.model,
      })
      if (!result.id && result.status === 'running') throw new Error('后端未返回任务 ID')
      setTasks((current) => current.map((item) => item.id === task.id
        ? {
            ...item,
            remoteJobId: result.id,
            status: result.status,
            videoUrl: result.videoUrl,
            error: result.error,
            updatedAt: Date.now(),
          }
        : item,
      ))
      showToast('视频任务已提交', 'success')
    } catch (err) {
      setTasks((current) => current.map((item) => item.id === task.id
        ? { ...item, status: 'error', error: err instanceof Error ? err.message : String(err), updatedAt: Date.now() }
        : item,
      ))
      showToast(err instanceof Error ? err.message : String(err), 'error')
    }
  }

  const removeTask = (id: string) => {
    setTasks((current) => current.filter((task) => task.id !== id))
  }

  return (
    <main className="safe-area-x mx-auto max-w-7xl pb-10">
      <div className="grid gap-4 lg:grid-cols-[360px_minmax(0,1fr)]">
        <section className="rounded-2xl border border-gray-200 bg-white p-4 shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">视频提示词</span>
              <textarea
                value={prompt}
                onChange={(e) => setPrompt(e.target.value)}
                rows={6}
                className="w-full resize-none rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"
                placeholder="展示户外便携咖啡机，海边露营场景，镜头缓慢推进"
              />
            </label>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">商品图 URL</span>
              <input
                value={imageUrl}
                onChange={(e) => setImageUrl(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"
                placeholder="https://..."
              />
            </label>

            <div className="grid grid-cols-3 gap-2">
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">比例</span>
                <select
                  value={ratio}
                  onChange={(e) => setRatio(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"
                >
                  <option>16:9</option>
                  <option>9:16</option>
                  <option>1:1</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">时长</span>
                <select
                  value={duration}
                  onChange={(e) => setDuration(Number(e.target.value))}
                  className="w-full rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"
                >
                  <option value={5}>5s</option>
                  <option value={10}>10s</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1.5 block text-xs font-medium text-gray-500 dark:text-gray-400">清晰度</span>
                <select
                  value={resolution}
                  onChange={(e) => setResolution(e.target.value)}
                  className="w-full rounded-xl border border-gray-200 bg-white px-2 py-2 text-sm text-gray-900 outline-none dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"
                >
                  <option>720p</option>
                  <option>1080p</option>
                </select>
              </label>
            </div>

            <label className="block">
              <span className="mb-1.5 block text-sm font-medium text-gray-700 dark:text-gray-200">视频 API</span>
              <input
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                className="w-full rounded-xl border border-gray-200 bg-white px-3 py-2.5 text-sm text-gray-900 outline-none transition focus:border-blue-500 focus:ring-2 focus:ring-blue-500/15 dark:border-white/[0.08] dark:bg-gray-950 dark:text-gray-100"
              />
            </label>

            <button
              type="button"
              onClick={submit}
              disabled={isSubmitting}
              className="w-full rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-500 disabled:cursor-not-allowed disabled:opacity-60"
            >
              生成视频
            </button>
          </div>
        </section>

        <section className="min-w-0">
          {tasks.length ? (
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
              {tasks.map((task) => (
                <article key={task.id} className="overflow-hidden rounded-2xl border border-gray-200 bg-white shadow-sm dark:border-white/[0.08] dark:bg-gray-900">
                  <div className="aspect-video bg-gray-100 dark:bg-gray-950">
                    {task.videoUrl ? (
                      <video src={task.videoUrl} controls className="h-full w-full bg-black object-contain" />
                    ) : (
                      <div className="flex h-full items-center justify-center px-4 text-center text-sm text-gray-400 dark:text-gray-500">
                        {task.status === 'error' ? '生成失败' : '生成中'}
                      </div>
                    )}
                  </div>
                  <div className="space-y-3 p-3">
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                        task.status === 'done'
                          ? 'bg-green-100 text-green-700 dark:bg-green-500/15 dark:text-green-300'
                          : task.status === 'error'
                            ? 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300'
                            : 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300'
                      }`}>
                        {task.status === 'done' ? '完成' : task.status === 'error' ? '失败' : '生成中'}
                      </span>
                      <span className="text-xs text-gray-400">{formatTime(task.createdAt)}</span>
                    </div>
                    <p className="line-clamp-3 text-sm text-gray-700 dark:text-gray-200">{task.prompt}</p>
                    <div className="flex flex-wrap gap-1.5 text-xs text-gray-500 dark:text-gray-400">
                      <span>{task.ratio}</span>
                      <span>{task.duration}s</span>
                      <span>{task.resolution}</span>
                    </div>
                    {task.error && <p className="whitespace-pre-line text-xs leading-5 text-red-500">{normalizeImageApiErrorDisplayText(task.error)}</p>}
                    <div className="flex items-center justify-end gap-1">
                      {task.videoUrl && (
                        <a
                          href={task.videoUrl}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
                          aria-label="打开视频"
                        >
                          <LinkIcon className="h-4 w-4" />
                        </a>
                      )}
                      {task.status === 'running' && (
                        <button
                          type="button"
                          onClick={() => setTasks((current) => [...current])}
                          className="rounded-lg p-2 text-gray-500 transition hover:bg-gray-100 hover:text-gray-900 dark:hover:bg-white/[0.06] dark:hover:text-gray-100"
                          aria-label="刷新"
                        >
                          <RefreshIcon className="h-4 w-4" />
                        </button>
                      )}
                      <button
                        type="button"
                        onClick={() => removeTask(task.id)}
                        className="rounded-lg p-2 text-gray-500 transition hover:bg-red-50 hover:text-red-600 dark:hover:bg-red-500/10 dark:hover:text-red-300"
                        aria-label="删除"
                      >
                        <TrashIcon className="h-4 w-4" />
                      </button>
                    </div>
                  </div>
                </article>
              ))}
            </div>
          ) : (
            <div className="flex min-h-[360px] items-center justify-center rounded-2xl border border-dashed border-gray-200 bg-white text-sm text-gray-400 dark:border-white/[0.08] dark:bg-gray-900 dark:text-gray-500">
              还没有视频任务
            </div>
          )}
        </section>
      </div>
    </main>
  )
}
