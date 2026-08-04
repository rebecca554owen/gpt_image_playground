import { createImageJobProxy } from './image-job-proxy.mjs'

let proxy

try {
  proxy = createImageJobProxy()
  await proxy.listen()
} catch {
  process.stderr.write('image job proxy failed to start\n')
  process.exit(1)
}

const shutdown = async () => {
  try {
    await proxy.close()
    process.exit(0)
  } catch {
    process.exit(1)
  }
}

process.once('SIGINT', shutdown)
process.once('SIGTERM', shutdown)
