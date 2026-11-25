import { NextRequest, NextResponse } from 'next/server'
import { resolvePublicPath } from '@/lib/public-path'
import { createReadStream, statSync, existsSync } from 'fs'
import path from 'path'
import { Readable } from 'stream'
import { isPrivateUploadPath } from '@/lib/private-upload-path'
import { legacyLibraryFile } from '@/lib/canvas/legacy-library-path'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const MIME: Record<string, string> = {
  '.jpg':  'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png':  'image/png',
  '.gif':  'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.svg':  'image/svg+xml',
  '.bmp':  'image/bmp',
  '.tiff': 'image/tiff',
  '.mp4':  'video/mp4',
  '.webm': 'video/webm',
  '.mov':  'video/quicktime',
  '.mkv':  'video/x-matroska',
  '.mp3':  'audio/mpeg',
  '.wav':  'audio/wav',
  '.m4a':  'audio/mp4',
  '.aac':  'audio/aac',
  '.ogg':  'audio/ogg',
  '.flac': 'audio/flac',
}

// 安全响应头。SVG 可内嵌脚本，强制以附件下载而非内联渲染，杜绝存储型 XSS。
function buildSecurityHeaders(ext: string): Record<string, string> {
  const headers: Record<string, string> = { 'X-Content-Type-Options': 'nosniff' }
  if (ext === '.svg') {
    headers['Content-Disposition'] = 'attachment'
    headers['Content-Security-Policy'] = "default-src 'none'"
  }
  return headers
}

function cacheControlForUpload(relative: string): string {
  const normalized = relative.replaceAll('\\', '/')
  if (/^(products\/(?:thumbs|previews|posters)|material_library\/(?:thumbs|previews|posters)|materials\/thumbs|inspiration_assets\/(?:previews|posters)|generation_(?:previews|posters)|canvas_breakdowns\/\d{4}-\d{2}-\d{2})\//.test(normalized)) {
    return 'public, max-age=31536000, immutable'
  }
  if (/^(inspiration_assets|template_images|template_videos|image_results|face_results|video_results|canvas_imports|canvas_image_results|canvas_video_results|canvas_audio_results|canvas_voice_previews|imports)\//.test(normalized)) {
    return 'public, max-age=31536000, immutable'
  }
  return 'public, max-age=86400'
}

function resolveDiskPath(relative: string): string {
  const archived = legacyLibraryFile(resolvePublicPath("uploads"), relative)
  if (archived) return archived
  const uploadsDir = process.env.UPLOADS_DIR
  if (uploadsDir) {
    return path.join(path.resolve(uploadsDir), relative)
  }
  return resolvePublicPath('uploads', relative)
}

function getFileStat(diskPath: string) {
  if (!existsSync(diskPath)) return null
  try {
    const s = statSync(diskPath)
    return s.isFile() ? s : null
  } catch {
    return null
  }
}

function parseRange(rangeHeader: string, fileSize: number) {
  const match = rangeHeader.match(/bytes=(\d*)-(\d*)/)
  if (!match) return null

  const startStr = match[1]
  const endStr = match[2]

  let start: number
  let end: number

  if (!startStr && endStr) {
    // suffix range: bytes=-500 → last 500 bytes
    const suffix = parseInt(endStr, 10)
    start = Math.max(0, fileSize - suffix)
    end = fileSize - 1
  } else {
    start = parseInt(startStr, 10)
    end = endStr ? parseInt(endStr, 10) : fileSize - 1
  }

  if (isNaN(start) || isNaN(end) || start > end || end >= fileSize) return null
  return { start, end }
}

// HEAD — 让浏览器先探测文件大小和类型（视频播放器常用）
export async function HEAD(
  _req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const relative = params.path.join('/')
  if (relative.includes('..') || path.isAbsolute(relative) || (isPrivateUploadPath(relative) && !legacyLibraryFile(resolvePublicPath("uploads"), relative))) {
    return new NextResponse(null, { status: 403 })
  }

  const diskPath = resolveDiskPath(relative)
  const stat = getFileStat(diskPath)
  if (!stat) return new NextResponse(null, { status: 404 })

  const ext = path.extname(diskPath).toLowerCase()
  const contentType = MIME[ext] || 'application/octet-stream'

  return new NextResponse(null, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(stat.size),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControlForUpload(relative),
      ...buildSecurityHeaders(ext),
    },
  })
}

// GET — 支持完整响应和 Range 分段响应
export async function GET(
  req: NextRequest,
  { params }: { params: { path: string[] } }
) {
  const relative = params.path.join('/')

  // 安全：防止路径穿越
  if (relative.includes('..') || path.isAbsolute(relative) || (isPrivateUploadPath(relative) && !legacyLibraryFile(resolvePublicPath("uploads"), relative))) {
    return new NextResponse('Forbidden', { status: 403 })
  }

  const diskPath = resolveDiskPath(relative)
  const stat = getFileStat(diskPath)

  if (!stat) {
    return new NextResponse('Not Found', { status: 404 })
  }

  const ext = path.extname(diskPath).toLowerCase()
  const contentType = MIME[ext] || 'application/octet-stream'
  const fileSize = stat.size

  // —— Range 请求处理（视频 seek、断点续传）——
  const rangeHeader = req.headers.get('range')
  if (rangeHeader) {
    const range = parseRange(rangeHeader, fileSize)

    // Range 无法解析或超出范围
    if (!range) {
      return new NextResponse('Range Not Satisfiable', {
        status: 416,
        headers: { 'Content-Range': `bytes */${fileSize}` },
      })
    }

    const { start, end } = range
    const chunkSize = end - start + 1

    let nodeStream: ReturnType<typeof createReadStream>
    try {
      nodeStream = createReadStream(diskPath, { start, end })
    } catch {
      return new NextResponse('Internal Server Error', { status: 500 })
    }

    const webStream = Readable.toWeb(nodeStream) as ReadableStream

    return new NextResponse(webStream, {
      status: 206,
      headers: {
        'Content-Type': contentType,
        'Content-Range': `bytes ${start}-${end}/${fileSize}`,
        'Content-Length': String(chunkSize),
        'Accept-Ranges': 'bytes',
        'Cache-Control': cacheControlForUpload(relative),
        ...buildSecurityHeaders(ext),
      },
    })
  }

  // —— 完整文件响应 ——
  let nodeStream: ReturnType<typeof createReadStream>
  try {
    nodeStream = createReadStream(diskPath)
  } catch {
    return new NextResponse('Internal Server Error', { status: 500 })
  }

  const webStream = Readable.toWeb(nodeStream) as ReadableStream

  return new NextResponse(webStream, {
    status: 200,
    headers: {
      'Content-Type': contentType,
      'Content-Length': String(fileSize),
      'Accept-Ranges': 'bytes',
      'Cache-Control': cacheControlForUpload(relative),
      ...buildSecurityHeaders(ext),
    },
  })
}
