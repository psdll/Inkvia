'use client'

import { UiText, UiProps, useUiLocale } from "@/i18n/ui";


import React, { useState, useEffect, useCallback, useMemo } from 'react'
import {
  Users,
  UserPlus,
  Trash2,
  RefreshCw,
  Eye,
  EyeOff,
  Shield,
  Plus,
  X,
  Search,
  KeyRound,
  UploadCloud,
  Sparkles,
  UserCheck,
  UserX,
  ListChecks,
  FileText,
} from 'lucide-react'
import { ConfirmDialog } from '@/components/ui/confirm-dialog'
import { fmtTime } from '@/lib/admin-utils'
import type { AdminAccountSummary } from '@/lib/admin/account-directory'
import { getAuthUsersCache, setAuthUsersCache, clearAuthUsersCache } from '@/lib/admin/auth-users-cache'
import { fetchJsonOnce } from "@/lib/client/inflight-json";

interface WhitelistItem {
  id: number
  name: string
  createdAt: string
  materialUploadAllowed?: boolean
  inspirationTemplateUploadAllowed?: boolean
}

interface UserItem {
  id: number
  username: string
  createdAt: string
  generationCount: number
  passwordResetAllowed?: boolean
  materialUploadAllowed?: boolean
  inspirationTemplateUploadAllowed?: boolean
}

interface AccountRow {
  name: string
  whitelistItem?: WhitelistItem
  user?: UserItem
}

type PendingSensitiveAction = {
  title: string
  description: string
  confirmText: string
  danger?: boolean
  run: (adminPassword: string) => Promise<void>
}

export default function UserManagement({ refreshSignal, active = true }: { refreshSignal?: number; active?: boolean } = {}) {
  const { label: uiLabel, error: uiError } = useUiLocale();
  const [whitelist, setWhitelist] = useState<WhitelistItem[]>(getAuthUsersCache()?.whitelist ?? [])
  const [users, setUsers] = useState<UserItem[]>(getAuthUsersCache()?.users ?? [])
  // 有缓存时不显示首屏 loading（直接展示旧数据，后台刷新）
  const [loading, setLoading] = useState(!getAuthUsersCache())
  const [hasLoaded, setHasLoaded] = useState(Boolean(getAuthUsersCache()))
  const [loadError, setLoadError] = useState<string | null>(null)
  const [page, setPage] = useState(1)
  const [query, setQuery] = useState('')
  const [pagination, setPagination] = useState(getAuthUsersCache()?.pagination)
  const [summary, setSummary] = useState<AdminAccountSummary | null>(null)
  const requestSeq = React.useRef(0)
  const requestController = React.useRef<AbortController | null>(null)
  const [newNames, setNewNames] = useState('')
  const [addingNames, setAddingNames] = useState(false)
  const [showPasswords, setShowPasswords] = useState<Record<number, boolean>>({})
  const [resetPasswordId, setResetPasswordId] = useState<number | null>(null)
  const [newPassword, setNewPassword] = useState('')
  const [revealedPasswords, setRevealedPasswords] = useState<Record<number, string>>({})
  const revealEpoch = React.useRef(0)
  const clearCredentials = useCallback(() => {
    revealEpoch.current += 1
    setRevealedPasswords({})
    setShowPasswords({})
    setAdminPassword('')
    setNewPassword('')
  }, [])
  const [selfResetBusy, setSelfResetBusy] = useState<Record<number, boolean>>({})
  const [materialUploadBusy, setMaterialUploadBusy] = useState<Record<string, boolean>>({})
  const [inspirationTemplateUploadBusy, setInspirationTemplateUploadBusy] = useState<Record<string, boolean>>({})
  const [searchTerm, setSearchTerm] = useState('')
  const [pendingAction, setPendingAction] = useState<PendingSensitiveAction | null>(null)
  const [adminPassword, setAdminPassword] = useState('')
  const [adminPasswordError, setAdminPasswordError] = useState('')
  const addInputRef = React.useRef<HTMLInputElement>(null)

  const openSensitiveAction = useCallback((action: PendingSensitiveAction) => {
    clearCredentials()
    setAdminPassword('')
    setAdminPasswordError('')
    setPendingAction(action)
  }, [clearCredentials])

  useEffect(() => {
    const onHidden = () => { if (document.hidden) clearCredentials() }
    window.addEventListener('inkvia:admin-session-ended', clearCredentials)
    document.addEventListener('visibilitychange', onHidden)
    return () => {
      revealEpoch.current += 1
      window.removeEventListener('inkvia:admin-session-ended', clearCredentials)
      document.removeEventListener('visibilitychange', onHidden)
    }
  }, [clearCredentials])

  useEffect(() => {
    if (active) return
    clearCredentials()
    setPendingAction(null)
    setResetPasswordId(null)
  }, [active, clearCredentials])
  useEffect(() => { clearCredentials() }, [searchTerm, page, clearCredentials])
  useEffect(() => {
    if (searchTerm.trim() === query) return
    const timer = window.setTimeout(() => { setQuery(searchTerm.trim()); setPage(1) }, 200)
    return () => window.clearTimeout(timer)
  }, [searchTerm, query])

  const postAuthUsers = useCallback(
    async (payload: Record<string, unknown>, password?: string) => {
      const res = await fetch('/api/admin/auth-users', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(password === undefined ? payload : { ...payload, adminPassword: password }),
      })
      const data = await res.json().catch(() => ({}))
      if (res.status === 401 || res.status === 403) clearCredentials()
      if (!res.ok || data.error) {
        throw new Error(data.error || '操作失败')
      }
      if (payload.action !== 'reveal_password') clearAuthUsersCache()
      return data
    },
    [clearCredentials]
  )

  const loadData = useCallback(async (options?: { showLoading?: boolean }) => {
    const sequence = ++requestSeq.current
    requestController.current?.abort()
    const controller = new AbortController()
    requestController.current = controller
    const showLoading = options?.showLoading ?? false
    const key = page === 1 && !query ? '' : `${query}|${page}`
    const cached = getAuthUsersCache(key)
    if (cached) { setWhitelist(cached.whitelist); setUsers(cached.users); setPagination(cached.pagination); setHasLoaded(true) }
    const current = () => sequence === requestSeq.current
    setLoadError(null)
    if (showLoading) setLoading(true)
    try {
      const response = await fetch(`/api/admin/auth-users?view=page&page=${page}&q=${encodeURIComponent(query)}`, { cache: "no-store", signal: controller.signal })
      const ok = response.ok
      const data = await response.json().catch(() => null)
      if (!current()) return
      if (!ok || !data) { clearCredentials(); throw new Error('加载失败') }
      if (!Array.isArray(data.whitelist) || !Array.isArray(data.users)) throw new Error('账号数据不完整')
      const nextWhitelist = data.whitelist
      const nextUsers = data.users
      if (data.whitelist) setWhitelist(nextWhitelist)
      if (data.users) setUsers(nextUsers)
      // 写入共享缓存，下次重挂载（刷新）时秒显示
      setPagination(data.pagination)
      setAuthUsersCache({ whitelist: nextWhitelist, users: nextUsers, pagination: data.pagination }, key)
      setHasLoaded(true)
    } catch (error) {
      if (!current()) return
      console.error('加载用户数据失败:', error)
      setLoadError(error instanceof Error ? error.message : '加载失败')
    } finally {
      if (current()) setLoading(false)
    }
  }, [clearCredentials, page, query])

  useEffect(() => {
    // 有缓存：后台静默刷新（不白屏）；无缓存：首屏 loading
    // refreshSignal 变化（顶部"刷新"）也会触发这里：有缓存时同样后台静默刷新，不白屏
    loadData({ showLoading: true })
    return () => { requestSeq.current++; requestController.current?.abort() }
  }, [loadData, refreshSignal])

  const wasActive = React.useRef(active)
  useEffect(() => {
    const returning = active && !wasActive.current
    wasActive.current = active
    if (!returning || !hasLoaded) return
    const key = page === 1 && !query ? '' : `${query}|${page}`
    // Mutations in other admin tabs and expired pages refresh behind existing rows.
    if (!getAuthUsersCache(key)) void loadData()
  }, [active, hasLoaded, loadData, page, query])

  const refreshSummary = useCallback(() => {
    void fetchJsonOnce<AdminAccountSummary>('/api/admin/auth-users?view=summary').then(({ok,json}) => {
      if (ok && typeof json?.accounts === 'number') setSummary(json)
    }).catch(() => {})
  }, [])
  useEffect(() => { if (pagination) refreshSummary() }, [refreshSummary, refreshSignal, whitelist, users, pagination])

  const accountRows = useMemo<AccountRow[]>(() => {
    const usersByName = new Map(users.map((user) => [user.username, user]))
    const whitelistByName = new Map(whitelist.map((item) => [item.name, item]))
    const rows: AccountRow[] = whitelist.map((item) => ({
      name: item.name,
      whitelistItem: item,
      user: usersByName.get(item.name),
    }))

    for (const user of users) {
      if (!whitelistByName.has(user.username)) {
        rows.push({ name: user.username, user })
      }
    }

    return rows
  }, [whitelist, users])

  const normalizedSearch = searchTerm.trim().toLowerCase()
  const filteredRows = pagination ? accountRows : accountRows.filter((row) =>
    row.name.toLowerCase().includes(normalizedSearch)
  )
  const registeredCount = summary?.registered ?? (pagination ? '—' : users.length)
  const unregisteredCount = summary?.unregistered ?? (pagination ? '—' : accountRows.filter((row) => !row.user).length)
  const selfResetCount = summary?.selfReset ?? (pagination ? '—' : users.filter((user) => user.passwordResetAllowed).length)
  const materialUploadCount = summary?.materialUpload ?? (pagination ? '—' : accountRows.filter((row) => row.user?.materialUploadAllowed || row.whitelistItem?.materialUploadAllowed).length)
  const inspirationTemplateUploadCount = summary?.inspirationUpload ?? (pagination ? '—' : accountRows.filter((row) => row.user?.inspirationTemplateUploadAllowed || row.whitelistItem?.inspirationTemplateUploadAllowed).length)
  const totalGenerationCount = summary?.generations ?? (pagination ? '—' : users.reduce((sum, user) => sum + user.generationCount, 0))

  const handleAddWhitelist = async () => {
    const names = newNames
      .split(/[,，\n]/)
      .map((n) => n.trim())
      .filter(Boolean)

    if (names.length === 0) return

    setAddingNames(true)
    try {
      await postAuthUsers({ action: 'add_whitelist', names })
      setNewNames('')
      loadData()
      window.setTimeout(() => addInputRef.current?.focus(), 0)
    } catch (error) {
      alert(error instanceof Error ? error.message : uiLabel('操作失败'))
    } finally {
      setAddingNames(false)
    }
  }

  const requestRemoveWhitelist = (name: string) => {
    openSensitiveAction({
      title: '确认移出白名单',
      description: `确定将「${name}」移出白名单？这只会取消该用户名后续注册资格，不会删除已注册账号、密码或历史记录。请输入管理员密码确认。`,
      confirmText: '确认移出',
      danger: true,
      run: async (password) => {
        await postAuthUsers({ action: 'remove_whitelist', name }, password)
        loadData()
      },
    })
  }

  const handleResetPassword = async (userId: number) => {
    if (!newPassword) return
    const passwordToSet = newPassword
    try {
      await postAuthUsers({
        action: 'reset_password',
        userId,
        newPassword: passwordToSet,
      })
      clearCredentials()
      setResetPasswordId(null)
      setNewPassword('')
      loadData()
    } catch (error) {
      alert(error instanceof Error ? error.message : uiLabel('操作失败'))
    }
  }

  const handleSetSelfReset = async (userId: number, allowed: boolean) => {
    setSelfResetBusy((prev) => ({ ...prev, [userId]: true }))
    try {
      clearCredentials()
      await postAuthUsers({ action: 'set_self_reset', userId, allowed })
      loadData()
    } catch (error) {
      alert(error instanceof Error ? error.message : uiLabel('操作失败'))
    } finally {
      setSelfResetBusy((prev) => ({ ...prev, [userId]: false }))
    }
  }

  const handleSetMaterialUpload = async (username: string, allowed: boolean) => {
    setMaterialUploadBusy((prev) => ({ ...prev, [username]: true }))
    try {
      await postAuthUsers({ action: 'set_material_upload', username, allowed })
      loadData()
    } catch (error) {
      alert(error instanceof Error ? error.message : uiLabel('操作失败'))
    } finally {
      setMaterialUploadBusy((prev) => ({ ...prev, [username]: false }))
    }
  }

  const handleSetInspirationTemplateUpload = async (username: string, allowed: boolean) => {
    setInspirationTemplateUploadBusy((prev) => ({ ...prev, [username]: true }))
    try {
      await postAuthUsers({ action: 'set_inspiration_template_upload', username, allowed })
      loadData()
    } catch (error) {
      alert(error instanceof Error ? error.message : uiLabel('操作失败'))
    } finally {
      setInspirationTemplateUploadBusy((prev) => ({ ...prev, [username]: false }))
    }
  }

  const requestDeleteUser = (user: UserItem) => {
    openSensitiveAction({
      title: '确认删除注册账号',
      description: `确定删除注册账号「${user.username}」？该账号会被删除，生成记录将保留但不再关联任何用户。请输入管理员密码确认。`,
      confirmText: '确认删除',
      danger: true,
      run: async (password) => {
        await postAuthUsers({ action: 'delete_user', userId: user.id }, password)
        loadData()
      },
    })
  }

  const togglePassword = (user: UserItem) => {
    if (showPasswords[user.id]) {
      clearCredentials()
      return
    }

    openSensitiveAction({
      title: '确认查看用户密码',
      description: `即将查看「${user.username}」的登录密码。请输入管理员密码确认。`,
      confirmText: '确认查看',
      run: async (password) => {
        const epoch = ++revealEpoch.current
        const data = await postAuthUsers({ action: 'reveal_password', userId: user.id }, password)
        if (epoch !== revealEpoch.current) return
        setRevealedPasswords((prev) => ({ ...prev, [user.id]: String(data.password || '') }))
        setShowPasswords((prev) => ({ ...prev, [user.id]: true }))
      },
    })
  }

  if (!hasLoaded) {
    return (
      <div className="space-y-5" aria-busy={loading}>
        <div>
          <h2 className="text-[18px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mfbf413d429bd" /></h2>
          <p className="mt-1 text-[13px] text-[var(--app-muted)]"><UiText id="admin.md8121bbadea6" /></p>
        </div>
        <div role={loadError ? 'alert' : 'status'} className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 text-sm text-[var(--app-muted)]">
          {loadError ? <UiText id="admin.m533be900a82f" values={{v0: uiError(loadError)}} /> : <UiText id="admin.m837e88420834" />}
          {loadError && <button type="button" onClick={() => void loadData({ showLoading: true })} className="ml-3 rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--app-fg)]"><UiText id="admin.mb8784c8dd563" /></button>}
        </div>
        <div className="grid grid-cols-2 gap-3 xl:grid-cols-7" aria-hidden="true">
          {['用户名额', '已注册', '未注册', '自助重置', '素材上传', '传灵感', '记录/内容'].map((label) => (
            <div key={label} className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4">
              <div className="text-xs text-[var(--app-muted)]">{uiLabel(label)}</div>
              <div className="mt-3 h-6 w-12 rounded bg-[var(--panel-3)]" />
            </div>
          ))}
        </div>
        <UiProps ids={{"placeholder":["admin.m57eae9a8cb95"],"aria-label":["admin.m52b14e4191ea"]}}><input disabled placeholder="admin.m57eae9a8cb95" aria-label="admin.m52b14e4191ea" className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-4 py-2.5 text-[13px]" /></UiProps>
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] p-4" aria-hidden="true">
          <div className="text-sm text-[var(--app-fg)]"><UiText id="admin.ma4660b1813b3" /></div>
          {[0, 1, 2].map((row) => <div key={row} className="mt-4 h-10 rounded-lg bg-[var(--panel-3)]" />)}
        </section>
      </div>
    )
  }

  return (
    <div className="space-y-5">
      {loadError && (
        <div role="alert" className="rounded-xl border border-[var(--border)] bg-[var(--panel-2)] p-4 text-sm text-[var(--app-muted)]"><UiText id="admin.m9eb7d5275cd6" />{uiError(loadError)}
          <button type="button" onClick={() => void loadData()} className="ml-3 rounded-lg border border-[var(--border)] px-3 py-1 text-[var(--app-fg)]"><UiText id="admin.mb8784c8dd563" /></button>
        </div>
      )}
      <div className="flex items-center justify-between rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] px-4 py-3">
        <div className="flex items-center gap-2">
          <Shield className="w-5 h-5 text-blue-500" />
          <div>
            <h2 className="text-[15px] font-semibold text-[var(--app-fg)]"><UiText id="admin.mfbf413d429bd" /></h2>
            <p className="text-[11px] text-[var(--app-muted)]"><UiText id="admin.md8121bbadea6" /></p>
          </div>
        </div>
        <UiProps ids={{"title":["admin.maee887434131"]}}><button
          onClick={() => loadData()}
          className="p-2 rounded-lg hover:bg-[var(--panel-bg)] transition-colors"
          title="admin.maee887434131"
        >
          <RefreshCw className="w-4 h-4 text-[var(--app-muted)]" />
        </button></UiProps>
      </div>

      <div className="grid grid-cols-2 gap-3 xl:grid-cols-7">
        <UiProps ids={{"label":["admin.m9ed0b281ffbf"]}}><StatCard
          icon={<Users className="h-4 w-4" />}
          label="admin.m9ed0b281ffbf"
          value={summary?.accounts ?? (pagination ? '—' : accountRows.length)}
          note={uiLabel(`白名单 ${summary?.whitelist ?? (pagination ? '—' : whitelist.length)}`)}
        /></UiProps>
        <UiProps ids={{"label":["admin.m1f4273cab151"]}}><StatCard
          icon={<UserCheck className="h-4 w-4" />}
          label="admin.m1f4273cab151"
          value={registeredCount}
          note={uiLabel(`${unregisteredCount} 人未注册`)}
        /></UiProps>
        <UiProps ids={{"label":["admin.m7b89c50978de"]}}><StatCard
          icon={<UserX className="h-4 w-4" />}
          label="admin.m7b89c50978de"
          value={unregisteredCount}
          note={uiLabel("可继续邀请注册")}
        /></UiProps>
        <UiProps ids={{"label":["admin.mc9678d509cff"]}}><StatCard
          icon={<KeyRound className="h-4 w-4" />}
          label="admin.mc9678d509cff"
          value={selfResetCount}
          note={uiLabel("已开放入口")}
        /></UiProps>
        <UiProps ids={{"label":["admin.m4b3a493399eb"]}}><StatCard
          icon={<UploadCloud className="h-4 w-4" />}
          label="admin.m4b3a493399eb"
          value={materialUploadCount}
          note={uiLabel("已开放入口")}
        /></UiProps>
        <UiProps ids={{"label":["admin.m024e9ad72a65"]}}><StatCard
          icon={<Sparkles className="h-4 w-4" />}
          label="admin.m024e9ad72a65"
          value={inspirationTemplateUploadCount}
          note={uiLabel("已开放入口")}
        /></UiProps>
        <UiProps ids={{"label":["admin.m07fe044641d0"]}}><StatCard
          icon={<ListChecks className="h-4 w-4" />}
          label="admin.m07fe044641d0"
          value={totalGenerationCount}
          note={uiLabel("已注册账号")}
        /></UiProps>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-[var(--app-muted)]" />
        <UiProps ids={{"placeholder":["admin.m57eae9a8cb95"]}}><input
          type="text"
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          placeholder="admin.m57eae9a8cb95"
          className="w-full pl-10 pr-4 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[13px] text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
        /></UiProps>
      </div>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] overflow-hidden">
        <div className="flex w-full items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--app-fg)]">
            <UserPlus className="h-4 w-4 text-blue-500" /><UiText id="admin.m40e8c231c87f" /></span>
          <span className="flex items-center gap-2 text-[12px] text-[var(--app-muted)]"><UiText id="admin.me31932634264" /></span>
        </div>
        <div className="border-t border-[var(--border)] px-4 py-4">
          <div className="flex flex-col gap-2 sm:flex-row">
            <UiProps ids={{"placeholder":["admin.m9ce0cc19719e"]}}><input
              ref={addInputRef}
              type="text"
              value={newNames}
              onChange={(e) => setNewNames(e.target.value)}
              placeholder="admin.m9ce0cc19719e"
              className="min-w-0 flex-1 px-3 py-2.5 rounded-xl border border-[var(--border)] bg-[var(--input-bg)] text-[13px] text-[var(--app-fg)] focus:outline-none focus:ring-2 focus:ring-blue-500/20"
              onKeyDown={(e) => e.key === 'Enter' && handleAddWhitelist()}
            /></UiProps>
            <button
              onClick={handleAddWhitelist}
              disabled={addingNames || !newNames.trim()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-sm font-medium transition-colors"
            >
              {addingNames ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Plus className="w-4 h-4" />
              )}<UiText id="admin.m7a8a11ead507" /></button>
          </div>
          <p className="mt-2 text-[11px] text-[var(--app-muted)]"><UiText id="admin.m6c209d450eb1" /></p>
        </div>
      </section>

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--panel-2)] overflow-hidden">
        <div className="flex w-full items-center justify-between px-4 py-3">
          <span className="flex items-center gap-2 text-[13px] font-semibold text-[var(--app-fg)]">
            <FileText className="h-4 w-4 text-blue-500" /><UiText id="admin.ma4660b1813b3" /></span>
          <span className="flex items-center gap-2 text-[12px] text-[var(--app-muted)]">
            {loading ? <UiText id="admin.ma598d688d9fb" /> : normalizedSearch ? <UiText id="admin.m5169563e378f" values={{v0: String(pagination?.total ?? filteredRows.length)}} /> : <UiText id="admin.m6bed9d904008" values={{v0: String(pagination?.total ?? accountRows.length)}} />}
          </span>
        </div>

        <div className="border-t border-[var(--border)]">
            <div className="hidden grid-cols-[minmax(100px,0.9fr)_90px_minmax(110px,0.8fr)_minmax(165px,1.1fr)_130px_minmax(280px,1.6fr)] gap-2 px-4 py-2 text-[11px] font-medium text-[var(--app-muted)] lg:grid">
              <span><UiText id="admin.m1a3f0617d6de" /></span>
              <span><UiText id="admin.m05e8decba0b1" /></span>
              <span><UiText id="admin.ma621ab606db2" /></span>
              <span><UiText id="admin.m1dd8d99a8d49" /></span>
              <span><UiText id="admin.m4e68461b5af3" /></span>
              <span className="text-right"><UiText id="admin.med31fbb483ee" /></span>
            </div>
            <div className="divide-y divide-[var(--border)]">
              {filteredRows.length === 0 ? (
                <div className="px-4 py-8 text-center text-[13px] text-[var(--app-muted)]"><UiText id="admin.mbab87f7d343f" /></div>
              ) : (
                filteredRows.map((row) => (
                  <AccountListRow
                    key={`${row.whitelistItem?.id ?? 'user'}-${row.user?.id ?? row.name}`}
                    row={row}
                    showPassword={row.user ? !!showPasswords[row.user.id] : false}
                    visiblePassword={row.user ? revealedPasswords[row.user.id] : undefined}
                    resetPasswordId={resetPasswordId}
                    newPassword={newPassword}
                    selfResetBusy={selfResetBusy}
                    materialUploadBusy={materialUploadBusy}
                    inspirationTemplateUploadBusy={inspirationTemplateUploadBusy}
                    onTogglePassword={togglePassword}
                    onResetPassword={handleResetPassword}
                    onSetResetPasswordId={setResetPasswordId}
                    onNewPasswordChange={setNewPassword}
                    onSetSelfReset={handleSetSelfReset}
                    onSetMaterialUpload={handleSetMaterialUpload}
                    onSetInspirationTemplateUpload={handleSetInspirationTemplateUpload}
                    onRemoveWhitelist={requestRemoveWhitelist}
                    onDeleteUser={requestDeleteUser}
                  />
                ))
              )}
            </div>
        </div>
      </section>

      {pagination && (page > 1 || pagination.hasMore) && (
        <div className="flex items-center justify-end gap-3 text-sm">
          <button disabled={loading || page <= 1} onClick={() => setPage((n) => n - 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-40"><UiText id="admin.mc9b9ae7a6144" /></button>
          <span><UiText id="admin.m9552fe3bd366" />{page}<UiText id="admin.ma46df383ad4b" /></span>
          <button disabled={loading || !pagination.hasMore} onClick={() => setPage((n) => n + 1)} className="rounded-lg border border-[var(--border)] px-3 py-2 disabled:opacity-40"><UiText id="admin.m8a8542f69648" /></button>
        </div>
      )}
      <UiProps ids={{"confirmText":["admin.m36f33adaf094"],"cancelText":["admin.m2cd0f3be8738"]}}><ConfirmDialog
        open={!!pendingAction}
        title={pendingAction?.title ?? ''}
        description={pendingAction?.description}
        confirmText={pendingAction?.confirmText ?? "admin.m36f33adaf094"}
        cancelText="admin.m2cd0f3be8738"
        danger={pendingAction?.danger}
        onClose={() => {
          setPendingAction(null)
          setAdminPassword('')
          setAdminPasswordError('')
        }}
        onConfirm={async () => {
          if (!pendingAction) return false
          if (!adminPassword.trim()) {
            setAdminPasswordError('请输入管理员密码')
            return false
          }
          try {
            await pendingAction.run(adminPassword.trim())
            return true
          } catch (error) {
            setAdminPasswordError(error instanceof Error ? error.message : '操作失败')
            return false
          }
        }}
      >
        <div className="space-y-2">
          <label className="block text-xs font-medium text-[var(--app-fg)]"><UiText id="admin.mc19091521d71" /></label>
          <UiProps ids={{"placeholder":["admin.m1a4e08f372ef"]}}><input
            type="password"
            value={adminPassword}
            onChange={(event) => {
              setAdminPassword(event.target.value)
              setAdminPasswordError('')
            }}
            placeholder="admin.m1a4e08f372ef"
            className="w-full rounded-xl border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2.5 text-sm text-[var(--app-fg)] outline-none focus:ring-2 focus:ring-blue-500/20"
            autoFocus
          /></UiProps>
          {adminPasswordError ? (
            <p className="text-xs text-rose-500">{adminPasswordError}</p>
          ) : (
            <p className="text-xs text-[var(--app-muted)]"><UiText id="admin.md8f618b629bd" /></p>
          )}
        </div>
      </ConfirmDialog></UiProps>
    </div>
  )
}

function StatCard({
  icon,
  label,
  value,
  note,
}: {
  icon: React.ReactNode
  label: string
  value: number | string
  note: string
}) {
  return (
    <div className="rounded-2xl border border-[var(--border)] bg-[var(--panel-bg)] px-4 py-3">
      <div className="flex items-center gap-2 text-[12px] text-[var(--app-muted)]">
        <span className="grid h-7 w-7 place-items-center rounded-lg bg-blue-500/10 text-blue-500">
          {icon}
        </span>
        {label}
      </div>
      <div className="mt-2 flex items-end justify-between gap-2">
        <span className="text-2xl font-semibold leading-none text-[var(--app-fg)]">{value}</span>
        <span className="text-[11px] text-[var(--app-muted)]">{note}</span>
      </div>
    </div>
  )
}

function AccountListRow({
  row,
  showPassword,
  visiblePassword,
  resetPasswordId,
  newPassword,
  selfResetBusy,
  materialUploadBusy,
  inspirationTemplateUploadBusy,
  onTogglePassword,
  onResetPassword,
  onSetResetPasswordId,
  onNewPasswordChange,
  onSetSelfReset,
  onSetMaterialUpload,
  onSetInspirationTemplateUpload,
  onRemoveWhitelist,
  onDeleteUser,
}: {
  row: AccountRow
  showPassword: boolean
  visiblePassword?: string
  resetPasswordId: number | null
  newPassword: string
  selfResetBusy: Record<number, boolean>
  materialUploadBusy: Record<string, boolean>
  inspirationTemplateUploadBusy: Record<string, boolean>
  onTogglePassword: (user: UserItem) => void
  onResetPassword: (userId: number) => void
  onSetResetPasswordId: (userId: number | null) => void
  onNewPasswordChange: (password: string) => void
  onSetSelfReset: (userId: number, allowed: boolean) => void
  onSetMaterialUpload: (username: string, allowed: boolean) => void
  onSetInspirationTemplateUpload: (username: string, allowed: boolean) => void
  onRemoveWhitelist: (name: string) => void
  onDeleteUser: (user: UserItem) => void
}) {
  const user = row.user
  const isResetting = user ? resetPasswordId === user.id : false
  const materialUploadAllowed = Boolean(row.user?.materialUploadAllowed || row.whitelistItem?.materialUploadAllowed)
  const inspirationTemplateUploadAllowed = Boolean(row.user?.inspirationTemplateUploadAllowed || row.whitelistItem?.inspirationTemplateUploadAllowed)

  return (
    <div className="grid gap-3 px-4 py-3 text-[13px] lg:grid-cols-[minmax(100px,0.9fr)_90px_minmax(110px,0.8fr)_minmax(165px,1.1fr)_130px_minmax(280px,1.6fr)] lg:items-center lg:gap-2">
      <div className="min-w-0">
        <div className="truncate font-medium text-[var(--app-fg)]">{row.name}</div>
        <div className="mt-1 text-[11px] text-[var(--app-muted)]">
          {row.whitelistItem ? <UiText id="admin.m62b48b2e4c0b" /> : <UiText id="admin.m2d86da8671ff" />}
        </div>
      </div>

      <div>
        {user ? (
          <span className="inline-flex items-center rounded-full bg-green-100 px-2 py-0.5 text-xs text-green-700 dark:bg-green-900/30 dark:text-green-400"><UiText id="admin.m1f4273cab151" /></span>
        ) : (
          <span className="inline-flex items-center rounded-full bg-[var(--input-bg)] px-2 py-0.5 text-xs text-[var(--app-muted)]"><UiText id="admin.m7b89c50978de" /></span>
        )}
      </div>

      <div className="min-w-0">
        {user ? (
          <div className="flex items-center gap-2 text-xs text-[var(--app-muted)]">
            <span className="font-mono text-[var(--app-fg)]">
              {showPassword ? visiblePassword || <UiText id="admin.mc9c37a1ebaf2" /> : '******'}
            </span>
            <UiProps ids={{"title":["admin.mdd1d07bd9ceb","admin.m65294a301ba4"]}}><button
              type="button"
              onClick={() => onTogglePassword(user)}
              className="p-1 rounded-md hover:bg-[var(--input-bg)] hover:text-[var(--app-fg)] transition-colors"
              title={showPassword ? "admin.mdd1d07bd9ceb" : "admin.m65294a301ba4"}
            >
              {showPassword ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
            </button></UiProps>
          </div>
        ) : (
          <span className="text-xs text-[var(--app-muted)]"><UiText id="admin.m26089dde5b01" /></span>
        )}
      </div>

      <div className="space-y-1 text-xs text-[var(--app-muted)]">
        <div><UiText id="admin.m1023573baff0" />{row.whitelistItem ? fmtTime(row.whitelistItem.createdAt) : '-'}</div>
        <div><UiText id="admin.m0cfd04c1ba37" />{user ? fmtTime(user.createdAt) : '-'}</div>
      </div>

      <div className="flex flex-wrap gap-1.5 text-xs">
        <span className="rounded-full bg-blue-100 px-2 py-0.5 text-blue-700 dark:bg-blue-900/30 dark:text-blue-400">
          {user?.generationCount ?? 0}<UiText id="admin.m53aa7f3019bb" /></span>
        {user?.passwordResetAllowed && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300"><UiText id="admin.mc9678d509cff" /></span>
        )}
        {materialUploadAllowed && (
          <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300"><UiText id="admin.m4b3a493399eb" /></span>
        )}
        {inspirationTemplateUploadAllowed && (
          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-indigo-700 dark:bg-indigo-900/30 dark:text-indigo-300"><UiText id="admin.m024e9ad72a65" /></span>
        )}
      </div>

      <div className="flex flex-wrap items-center justify-start gap-1 lg:justify-end">
        {user && isResetting ? (
          <div className="flex items-center gap-1">
            <UiProps ids={{"placeholder":["admin.m515e9c7cf7b2"]}}><input
              type="text"
              value={newPassword}
              onChange={(e) => onNewPasswordChange(e.target.value)}
              placeholder="admin.m515e9c7cf7b2"
              className="w-24 px-2 py-1 rounded border border-[var(--border)] bg-[var(--input-bg)] text-xs text-[var(--app-fg)] focus:outline-none focus:ring-1 focus:ring-blue-500"
              autoFocus
              onKeyDown={(e) => e.key === 'Enter' && onResetPassword(user.id)}
            /></UiProps>
            <button
              type="button"
              onClick={() => onResetPassword(user.id)}
              disabled={!newPassword}
              className="px-2 py-1 rounded bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white text-xs transition-colors"
            ><UiText id="admin.m36f33adaf094" /></button>
            <UiProps ids={{"title":["admin.m2cd0f3be8738"]}}><button
              type="button"
              onClick={() => {
                onSetResetPasswordId(null)
                onNewPasswordChange('')
              }}
              className="p-1 hover:bg-[var(--input-bg)] rounded transition-colors"
              title="admin.m2cd0f3be8738"
            >
              <X className="w-3.5 h-3.5 text-[var(--app-muted)]" />
            </button></UiProps>
          </div>
        ) : user ? (
          <button
            type="button"
            onClick={() => onSetResetPasswordId(user.id)}
            className="px-2 py-1 rounded-lg text-xs text-[var(--app-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 transition-colors"
          ><UiText id="admin.md70928debc2e" /></button>
        ) : null}

        {user && (
          <UiProps ids={{"title":["admin.m0aab7784de73","admin.m0cb95d6ef819"]}}><button
            type="button"
            onClick={() => onSetSelfReset(user.id, !user.passwordResetAllowed)}
            disabled={!!selfResetBusy[user.id]}
            className={[
              'px-2 py-1 rounded-lg text-xs transition-colors inline-flex items-center gap-1',
              user.passwordResetAllowed
                ? 'text-amber-700 hover:bg-amber-50 dark:text-amber-300 dark:hover:bg-amber-900/20'
                : 'text-[var(--app-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20',
              selfResetBusy[user.id] ? 'opacity-60 cursor-not-allowed' : '',
            ].join(' ')}
            title={user.passwordResetAllowed ? "admin.m0aab7784de73" : "admin.m0cb95d6ef819"}
          >
            {selfResetBusy[user.id] ? (
              <RefreshCw className="w-3.5 h-3.5 animate-spin" />
            ) : (
              <KeyRound className="w-3.5 h-3.5" />
            )}
            {user.passwordResetAllowed ? <UiText id="admin.m4c563963b4c3" /> : <UiText id="admin.mc9678d509cff" />}
          </button></UiProps>
        )}

        <UiProps ids={{"title":["admin.mda3bfb5c19d4","admin.m352a322bf4b9"]}}><button
          type="button"
          onClick={() => onSetMaterialUpload(row.name, !materialUploadAllowed)}
          disabled={!!materialUploadBusy[row.name]}
          className={[
            'px-2 py-1 rounded-lg text-xs transition-colors inline-flex items-center gap-1',
            materialUploadAllowed
              ? 'text-emerald-700 hover:bg-emerald-50 dark:text-emerald-300 dark:hover:bg-emerald-900/20'
              : 'text-[var(--app-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20',
            materialUploadBusy[row.name] ? 'opacity-60 cursor-not-allowed' : '',
          ].join(' ')}
          title={materialUploadAllowed ? "admin.mda3bfb5c19d4" : "admin.m352a322bf4b9"}
        >
          {materialUploadBusy[row.name] ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <UploadCloud className="w-3.5 h-3.5" />
          )}
          {materialUploadAllowed ? <UiText id="admin.meadcacc3a8da" /> : <UiText id="admin.m4b3a493399eb" />}
        </button></UiProps>

        <UiProps ids={{"title":["admin.m5f34ee377809","admin.mdc8f0d40c955"]}}><button
          type="button"
          onClick={() => onSetInspirationTemplateUpload(row.name, !inspirationTemplateUploadAllowed)}
          disabled={!!inspirationTemplateUploadBusy[row.name]}
          className={[
            'px-2 py-1 rounded-lg text-xs transition-colors inline-flex items-center gap-1',
            inspirationTemplateUploadAllowed
              ? 'text-indigo-700 hover:bg-indigo-50 dark:text-indigo-300 dark:hover:bg-indigo-900/20'
              : 'text-[var(--app-muted)] hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20',
            inspirationTemplateUploadBusy[row.name] ? 'opacity-60 cursor-not-allowed' : '',
          ].join(' ')}
          title={inspirationTemplateUploadAllowed ? "admin.m5f34ee377809" : "admin.mdc8f0d40c955"}
        >
          {inspirationTemplateUploadBusy[row.name] ? (
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          ) : (
            <Sparkles className="w-3.5 h-3.5" />
          )}
          {inspirationTemplateUploadAllowed ? <UiText id="admin.mac899972cc76" /> : <UiText id="admin.m024e9ad72a65" />}
        </button></UiProps>

        {user && (
          <UiProps ids={{"title":["admin.m1a238bff0e75"]}}><button
            type="button"
            onClick={() => onDeleteUser(user)}
            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--app-muted)] hover:text-red-500 transition-colors"
            title="admin.m1a238bff0e75"
          >
            <Trash2 className="w-4 h-4" />
          </button></UiProps>
        )}

        {row.whitelistItem && (
          <UiProps ids={{"title":["admin.mdf2f2128b963"]}}><button
            type="button"
            onClick={() => onRemoveWhitelist(row.whitelistItem!.name)}
            className="p-1.5 rounded-lg hover:bg-red-50 dark:hover:bg-red-900/20 text-[var(--app-muted)] hover:text-red-500 transition-colors"
            title="admin.mdf2f2128b963"
          >
            <UserX className="w-4 h-4" />
          </button></UiProps>
        )}
      </div>
    </div>
  )
}
