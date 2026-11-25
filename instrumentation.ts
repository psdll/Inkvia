// Next.js instrumentation — 服务器启动时执行（仅 Node.js 运行时）
// 用于检查上传目录是否可访问，方便排查部署问题

export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { prepareRuntime, assertWritablePath } = await import('./lib/runtime-isolation');
    if (process.env.INKVIA_RUNTIME_PROFILE === 'build') return;
    await prepareRuntime();
    const { installRuntimeBoundaries } = await import('./scripts/lib/runtime-boundaries.cjs');
    installRuntimeBoundaries();
    await import("./instrumentation.node");

    const path = await import('path')
    const fs = await import('fs')

    function getUploadsDir(): string {
      const configured = String(process.env.UPLOADS_DIR || '').trim()
      if (configured) return path.resolve(configured)

      // 和 lib/public-path.ts 保持一致：从 cwd 开始找项目根
      const cwd = process.cwd()
      return path.join(cwd, 'public', 'uploads')
    }

    const uploadsDir = getUploadsDir()
    assertWritablePath(uploadsDir)

    const desktopMode = process.env.INKVIA_DESKTOP_MODE === '1'
    try {
      const [{ installBuiltinRoleSkills }, { default: prisma }] = await Promise.all([
        import('./lib/builtin-skills/install'),
        import('./lib/prisma'),
      ])
      await installBuiltinRoleSkills(prisma, desktopMode ? uploadsDir : undefined)
    } catch (error) {
      if (desktopMode) throw error
      console.warn('[builtin-skills] startup initialization failed:', error instanceof Error ? error.name : 'unknown error')
    }

    // 确保目录存在，不存在则自动创建
    try {
      fs.mkdirSync(uploadsDir, { recursive: true })
    } catch {
      // 已存在或权限不足
    }

    // 检查目录是否可写
    let writable = false
    const testFile = path.join(uploadsDir, '.write-test')
    try {
      fs.writeFileSync(testFile, 'ok')
      fs.unlinkSync(testFile)
      writable = true
    } catch {
      writable = false
    }

    const status = writable ? '✓ 可读写' : '✗ 无写入权限'
    console.log(`[uploads] 存储目录: ${uploadsDir}  ${status}`)
    try {
      const { readUploadDiskSnapshot } = await import('./lib/monitoring/upload-disk-snapshot')
      const disk = await readUploadDiskSnapshot({ uploadsRoot: uploadsDir })
      if (disk.state === 'warning' || disk.state === 'critical') {
        console.warn(`[uploads] disk usage ${disk.usedPercent.toFixed(1)}%; large uploads will be blocked at 85%`)
      } else if (disk.state === 'unavailable') {
        console.warn(`[uploads] disk usage check failed: ${disk.error}`)
      }
    } catch (error) {
      console.warn('[uploads] disk usage check failed:', error)
    }
    if (!writable) {
      console.error(`[uploads] 警告: 无法写入 ${uploadsDir}，生成的图片/视频将无法保存！`)
      console.error(`[uploads] 请执行: chmod 755 ${uploadsDir}  或设置环境变量 UPLOADS_DIR`)
    }

    // 启动时校验关键环境变量，缺失则明确告警（不中断启动）
    const requiredEnv = ['ADMIN_USERNAME', 'ADMIN_PASSWORD', 'ADMIN_SECRET']
    const missing = requiredEnv.filter((k) => !String(process.env[k] || '').trim())
    if (missing.length) {
      console.error(`[env] 警告: 缺少关键环境变量 ${missing.join(', ')}，相关功能将不可用`)
    } else {
      console.log('[env] ✓ 关键环境变量已配置')
    }

    try {
      const { startUploadDiskMonitor } = await import('./lib/monitoring/upload-disk-monitor')
      startUploadDiskMonitor()
    } catch (err) {
      console.error('[uploads] failed to bootstrap disk monitor:', err)
    }

    // 启动 admin 后台任务调度(磁盘扫描缓存 / UsageLedger 增量补齐 / 日聚合滚动)。
    // 全部异步、互不阻塞,失败也不会让 HTTP 请求受影响。
    const isWebOnlyDevelopment =
      process.env.NODE_ENV === "development"
      && process.env.INKVIA_DEV_WEB_ONLY === "1"
    if (!isWebOnlyDevelopment) {
      try {
        const { startBackgroundJobs } = await import('./lib/server-bootstrap')
        startBackgroundJobs()
      } catch (err) {
        console.error('[bg] failed to bootstrap background jobs:', err)
      }
    } else {
      console.log('[dev] Web-only mode: server background jobs are disabled')
    }
  }
}
