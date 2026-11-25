'use client'
import { UiText } from "@/i18n/ui";


import React, { useEffect } from 'react'
import { useAuth } from './AuthProvider'
import { useDesktopMode } from '@/components/system/desktop-mode'
import { Lock } from 'lucide-react'

interface RequireAuthProps {
  children: React.ReactNode
  fallbackMessage?: string
}

export default function RequireAuth({
  children,
  fallbackMessage = '请先登录后查看',
}: RequireAuthProps) {
  const { user, loading, openLoginModal } = useAuth()
  const desktopMode = useDesktopMode()

  useEffect(() => {
    if (!loading && !user) {
      openLoginModal()
    }
  }, [loading, user, openLoginModal])

  if (loading) {
    return (
      <div className="flex items-center justify-center min-h-[60vh]">
        <div className="inline-block w-8 h-8 border-2 border-zinc-300 border-t-blue-600 rounded-full animate-spin" />
      </div>
    )
  }

  if (!user) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-zinc-500 dark:text-zinc-400">
        <Lock className="w-12 h-12 mb-4 text-zinc-300 dark:text-zinc-600" />
        <p className="text-lg mb-4">{fallbackMessage}</p>
        <button
          onClick={() => openLoginModal()}
          className="px-6 py-2 rounded-lg bg-blue-600 hover:bg-blue-700 text-white font-medium transition-colors"
        >
          {desktopMode ? <UiText id="auth.medd4000049f2" /> : <UiText id="auth.me5533fd28356" />}
        </button>
      </div>
    )
  }

  return <>{children}</>
}
