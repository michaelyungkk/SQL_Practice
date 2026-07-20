import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const progressFilePath = path.resolve(process.cwd(), 'progress.json')

const sendJson = (res: ServerResponse, statusCode: number, payload: unknown) => {
  res.statusCode = statusCode
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(payload))
}

const handleProgressRequest = async (req: IncomingMessage, res: ServerResponse) => {
  if (!req.url?.startsWith('/api/progress')) {
    return false
  }

  if (req.method === 'GET') {
    try {
      const file = await readFile(progressFilePath, 'utf8')
      sendJson(res, 200, JSON.parse(file))
    } catch (error) {
      const code = typeof error === 'object' && error !== null && 'code' in error ? String(error.code) : ''
      if (code === 'ENOENT') {
        sendJson(res, 200, {})
      } else {
        sendJson(res, 500, { error: 'Unable to read progress file.' })
      }
    }

    return true
  }

  if (req.method === 'POST') {
    try {
      const body = await new Promise<string>((resolve, reject) => {
        const chunks: Buffer[] = []
        req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)))
        req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
        req.on('error', reject)
      })

      const parsed = JSON.parse(body)
      await mkdir(path.dirname(progressFilePath), { recursive: true })
      await writeFile(progressFilePath, JSON.stringify(parsed, null, 2), 'utf8')
      sendJson(res, 200, { ok: true })
    } catch {
      sendJson(res, 500, { error: 'Unable to save progress file.' })
    }

    return true
  }

  sendJson(res, 405, { error: 'Method not allowed.' })
  return true
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'progress-file-api',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleProgressRequest(req, res).then((handled) => {
            if (!handled) {
              next()
            }
          })
        })
      },
      configurePreviewServer(server) {
        server.middlewares.use((req, res, next) => {
          void handleProgressRequest(req, res).then((handled) => {
            if (!handled) {
              next()
            }
          })
        })
      },
    },
  ],
})
