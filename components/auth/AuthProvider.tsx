'use client'

import React, { createContext, useContext, useState, useEffect, useCallback } from 'react'
import { useRouter } from 'next/navigation'
import { shouldHandleUserSessionUnauthorized } from '@/lib/auth-session-response'
import { ephemeralInputDraftRegistry } from '@/lib/ephemeral-input-draft'
import { clearDesktopInputDrafts } from '@/lib/desktop-input-draft'
import { DesktopModeProvider } from '@/components/system/desktop-mode'

interface User {
  id: number
  username: string
  createdAt?: string
  isAdmin?: boolean
}

interface AuthContextType {
  user: User | null
  loading: boolean
  login: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
  register: (username: string, password: string) => Promise<{ success: boolean; error?: string }>
  resetPassword: (username: string, newPassword: string) => Promise<{ success: boolean; error?: string }>
  logout: (options?: { reload?: boolean }) => Promise<void>
  // 弹窗控制
  showLoginModal: boolean
  loginNotice: string | null
  openLoginModal: (callback?: () => void) => void
  openAccountSwitchModal: () => void
  closeLoginModal: () => void
  // 登录后的回调（用于"先弹窗登录，登录后继续操作"）
  pendingCallback: (() => void) | null
}

const AuthContext = createContext<AuthContextType | null>(null)

function clearGuestLocalState() {
  if (typeof window === 'undefined') return
  try {
    const keysToRemove: string[] = []
    for (let i = 0; i < window.localStorage.length; i += 1) {
      const key = window.localStorage.key(i)
      if (!key) continue
      if (
        key === 'ai_studio_device_id' ||
        key.startsWith('draft_video_v1_') ||
        key.startsWith('draft_image_v1_') ||
        key.startsWith('draft_face_v2_') ||
        key.startsWith('studio_running_v1_')
      ) {
        keysToRemove.push(key)
      }
    }
    keysToRemove.forEach((key) => window.localStorage.removeItem(key))
  } catch {
    // 忽略本地存储异常
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const router = useRouter()
  const [user, setUser] = useState<User | null>(null)
  const [desktopMode, setDesktopMode] = useState(false)
  const [loading, setLoading] = useState(true)
  const [showLoginModal, setShowLoginModal] = useState(false)
  const [loginNotice, setLoginNotice] = useState<string | null>(null)
  const [pendingCallback, setPendingCallback] = useState<(() => void) | null>(null)
  // 始终指向最新登录状态：供 openLoginModal 判断"是否已登录"，避免被闭包里的旧值误导
  const userRef = React.useRef<User | null>(user)
  const authSessionVersionRef = React.useRef(0)
  useEffect(() => {
    userRef.current = user
  }, [user])

  const handleSessionInvalid = useCallback(() => {
    if (!userRef.current) return

    ephemeralInputDraftRegistry.clearOwner(String(userRef.current.id))
    clearDesktopInputDrafts(String(userRef.current.id))
    authSessionVersionRef.current += 1
    userRef.current = null
    setUser(null)
    setShowLoginModal(true)
    setLoginNotice('账号已在其他设备登录，请重新登录')
    setPendingCallback(null)
    clearGuestLocalState()
    window.dispatchEvent(new CustomEvent('auth:logout'))
  }, [])

  useEffect(() => {
    const originalFetch = window.fetch
    const interceptedFetch: typeof window.fetch = async (input, init) => {
      const requestSessionVersion = authSessionVersionRef.current
      const response = await originalFetch(input, init)
      const requestUrl = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url

      if (
        requestSessionVersion === authSessionVersionRef.current &&
        userRef.current &&
        shouldHandleUserSessionUnauthorized({
          url: requestUrl,
          status: response.status,
          origin: window.location.origin,
        })
      ) {
        handleSessionInvalid()
      }

      return response
    }

    window.fetch = interceptedFetch
    return () => {
      if (window.fetch === interceptedFetch) {
        window.fetch = originalFetch
      }
    }
  }, [handleSessionInvalid])

  // 初始化：检查当前登录状态
  useEffect(() => {
    checkAuth()
  }, [])

  useEffect(() => {
    if (!loading && !user) {
      clearGuestLocalState()
    }
  }, [loading, user])

  const checkAuth = async () => {
    const desktopWindow = window.location.hostname === '127.0.0.1'
      && /\bInkviaDesktop\/(?:darwin|win32)\b/.test(window.navigator.userAgent)
    if (desktopWindow) setDesktopMode(true)
    try {
      const res = await fetch('/api/auth/me')
      const data = await res.json()
      const isDesktop = desktopWindow || data.desktopMode === true
      setDesktopMode(isDesktop)
      if (data.user) {
        setUser(data.user)
      } else if (isDesktop) {
        setShowLoginModal(true)
      }
    } catch {
      // 未登录，忽略
    } finally {
      setLoading(false)
    }
  }

  // 登录
  const login = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()

      if (!res.ok || !data.user?.id || !data.user?.username) {
        return { success: false, error: data.error || '登录失败' }
      }

      // 切换账号成功后再清理旧账号的本地状态，失败时保留原会话和草稿。
      const previousUser = userRef.current
      authSessionVersionRef.current += 1
      if (previousUser && previousUser.id !== data.user.id) {
        ephemeralInputDraftRegistry.clearOwner(String(previousUser.id))
        clearDesktopInputDrafts(String(previousUser.id))
        clearGuestLocalState()
        window.dispatchEvent(new CustomEvent('auth:logout'))
      }
      userRef.current = data.user
      setUser(data.user)
      setShowLoginModal(false)
      setLoginNotice(null)
      try {
        window.localStorage.setItem('studio_last_tool_v1', 'image')
      } catch {}

      // 执行登录后的待处理回调
      if (pendingCallback) {
        setTimeout(() => {
          pendingCallback()
          setPendingCallback(null)
        }, 100)
      }

      return { success: true }
    } catch {
      return { success: false, error: '网络错误，请稍后重试' }
    }
  }, [pendingCallback])

  // 注册
  const register = useCallback(async (username: string, password: string) => {
    try {
      const res = await fetch('/api/auth/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password }),
      })
      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error || '注册失败' }
      }

      authSessionVersionRef.current += 1
      userRef.current = data.user
      setUser(data.user)
      setShowLoginModal(false)
      setLoginNotice(null)
      try {
        window.localStorage.setItem('studio_last_tool_v1', 'image')
      } catch {}

      if (pendingCallback) {
        setTimeout(() => {
          pendingCallback()
          setPendingCallback(null)
        }, 100)
      }

      return { success: true }
    } catch {
      return { success: false, error: '网络错误，请稍后重试' }
    }
  }, [pendingCallback])

  const resetPassword = useCallback(async (username: string, newPassword: string) => {
    try {
      const res = await fetch('/api/auth/password-reset', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, newPassword }),
      })
      const data = await res.json()

      if (!res.ok) {
        return { success: false, error: data.error || '重置失败' }
      }

      authSessionVersionRef.current += 1
      userRef.current = data.user
      setUser(data.user)
      setShowLoginModal(false)
      setLoginNotice(null)
      try {
        window.localStorage.setItem('studio_last_tool_v1', 'image')
      } catch {}

      if (pendingCallback) {
        setTimeout(() => {
          pendingCallback()
          setPendingCallback(null)
        }, 100)
      }

      return { success: true }
    } catch {
      return { success: false, error: '网络错误，请稍后重试' }
    }
  }, [pendingCallback])

  // 登出
  const logout = useCallback(async (options?: { reload?: boolean }) => {
    const shouldReload =
      options && typeof options === 'object' && 'reload' in options ? options.reload !== false : true

    if (userRef.current) {
      ephemeralInputDraftRegistry.clearOwner(String(userRef.current.id))
      clearDesktopInputDrafts(String(userRef.current.id))
    }
    authSessionVersionRef.current += 1
    userRef.current = null
    try {
      await fetch('/api/auth/me', {
        method: 'DELETE',
        keepalive: true,
      })
    } catch {
      // 忽略
    }
    setUser(null)
    setShowLoginModal(false)
    setLoginNotice(null)
    setPendingCallback(null)
    clearGuestLocalState()

    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('auth:logout'))
      if (shouldReload) {
        window.location.reload()
        return
      }
    }

    router.refresh()
  }, [router])

  // 打开登录弹窗（可附带回调）
  const openLoginModal = useCallback((callback?: () => void) => {
    // 已登录则忽略：登录成功后，旧闭包里的回调可能再次调用本方法（其闭包内 user 仍是 null），
    // 若不拦截会导致登录后又弹出登录框。这里用 ref 读最新登录态，直接跳过弹窗。
    if (userRef.current) return
    if (callback) {
      setPendingCallback(() => callback)
    }
    setShowLoginModal(true)
  }, [])

  // 显式切换允许在已有会话时打开弹窗，不调用退出接口。
  const openAccountSwitchModal = useCallback(() => {
    setPendingCallback(null)
    setLoginNotice(null)
    setShowLoginModal(true)
  }, [])

  const closeLoginModal = useCallback(() => {
    setShowLoginModal(false)
    setLoginNotice(null)
    setPendingCallback(null)
  }, [])

  return (
    <AuthContext.Provider
      value={{
        user,
        loading,
        login,
        register,
        resetPassword,
        logout,
        showLoginModal,
        loginNotice,
        openLoginModal,
        openAccountSwitchModal,
        closeLoginModal,
        pendingCallback,
      }}
    >
      <DesktopModeProvider value={desktopMode}>{children}</DesktopModeProvider>
    </AuthContext.Provider>
  )
}

// Hook：获取认证上下文
export function useAuth() {
  const context = useContext(AuthContext)
  if (!context) {
    throw new Error('useAuth 必须在 AuthProvider 内使用')
  }
  return context
}

// Hook：需要登录才能执行操作
// 用法：const requireAuth = useRequireAuth()
//       requireAuth(() => { /* 需要登录后才执行的操作 */ })
export function useRequireAuth() {
  const { user, openLoginModal } = useAuth()

  return useCallback(
    (callback: () => void) => {
      if (user) {
        callback()
      } else {
        openLoginModal(callback)
      }
    },
    [user, openLoginModal]
  )
}
