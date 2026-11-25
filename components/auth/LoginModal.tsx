'use client'
import { UiProps, UiText, useUiLocale } from "@/i18n/ui";


import React, { useState } from 'react'
import { useAuth } from './AuthProvider'
import { X, User, Lock, ArrowRight, Eye, EyeOff, Loader2 } from 'lucide-react'
import BrandLogo from '@/components/ui/BrandLogo'
import { useDesktopMode } from '@/components/system/desktop-mode'
import { DesktopRestoreLoginLink } from './desktop-restore-login'
import styles from './LoginModal.module.css'

export default function LoginModal() {
  const { loading, showLoginModal, closeLoginModal } = useAuth()
  const desktopMode = useDesktopMode()
  if (loading) return null
  if (!desktopMode) return <WebLoginModal />
  if (!showLoginModal) return null

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={closeLoginModal} />
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="desktop-login-title">
        <UiProps ids={{"aria-label":["auth.mb0725d2630c7"]}}><button type="button" onClick={closeLoginModal} aria-label="auth.mb0725d2630c7" className={styles.close}>
          <X size={19} />
        </button></UiProps>
        <header className={styles.header}>
          <h2 id="desktop-login-title" className={styles.title}><UiText id="auth.m1423cbc02574" /></h2>
        </header>
        <DesktopRestoreLoginLink className={styles.submit} />
      </div>
    </div>
  )
}

function WebLoginModal() {
  const { error: uiError } = useUiLocale();
  const { user, showLoginModal, loginNotice, closeLoginModal, login, register, resetPassword } = useAuth()
  const switchingAccount = Boolean(user)
  const [passwordVisible, setPasswordVisible] = useState(false)
  const [mode, setMode] = useState<'login' | 'register' | 'reset'>('login')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [error, setError] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [checkingReset, setCheckingReset] = useState(false)

  React.useEffect(() => {
    if (!showLoginModal) { setPasswordVisible(false); setPassword(''); setConfirmPassword(''); }
    if (showLoginModal && switchingAccount) {
      setMode('login'); setUsername(''); setPassword(''); setError('');
    }
  }, [showLoginModal, switchingAccount])

  if (!showLoginModal) return null

  const close = () => {
    if (switchingAccount && submitting) return
    closeLoginModal()
  }

  const resetForm = () => {
    setPasswordVisible(false)
    setUsername('')
    setPassword('')
    setConfirmPassword('')
    setError('')
  }

  const switchMode = (newMode: 'login' | 'register') => {
    setMode(newMode)
    resetForm()
  }

  const checkSelfResetAllowed = async () => {
    const name = username.trim()
    setError('')
    if (!name) {
      setError('请先填写需要重置密码的用户名')
      return
    }

    setCheckingReset(true)
    try {
      const res = await fetch(`/api/auth/password-reset?username=${encodeURIComponent(name)}`, { cache: 'no-store' })
      const data = await res.json().catch(() => null)
      if (res.ok && data?.allowed) {
        setMode('reset')
        setPassword('')
        setConfirmPassword('')
        return
      }
      setError('管理员尚未开启该账号的自助重置，请先联系管理员。')
    } finally {
      setCheckingReset(false)
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (submitting) return
    setError('')

    if (!username.trim() || !password) {
      setError('请填写用户名和密码')
      return
    }

    if (mode === 'register' || mode === 'reset') {
      if (password.length < 4) {
        setError('密码至少4个字符')
        return
      }
      if (password !== confirmPassword) {
        setError('两次密码输入不一致')
        return
      }
    }

    setSubmitting(true)

    try {
      const result = mode === 'login'
        ? await login(username.trim(), password)
        : mode === 'register'
          ? await register(username.trim(), password)
          : await resetPassword(username.trim(), password)

      if (!result.success) {
        setError(result.error || '操作失败')
      }
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className={styles.overlay}>
      <div className={styles.backdrop} onClick={close} />
      <div className={styles.panel} role="dialog" aria-modal="true" aria-labelledby="account-login-title" aria-describedby={switchingAccount || mode !== 'login' ? 'account-login-description' : undefined}>
        <UiProps ids={{"aria-label":["auth.m900eacc6fcc4"]}}><button type="button" onClick={close} disabled={switchingAccount && submitting} aria-label="auth.m900eacc6fcc4" className={styles.close}>
          <X size={19} />
        </button></UiProps>
        <header className={styles.header}>
          <div className={styles.brand}><BrandLogo size={33} /></div>
          <h2 id="account-login-title" className={`${styles.title} ${!switchingAccount && (mode === 'login' || mode === 'register') ? styles.welcomeTitle : ''}`}>
            {switchingAccount ? <UiText id="auth.me0351ba25410" /> : mode === 'login' ? <UiText id="auth.m5cfdfe0523ee" /> : mode === 'register' ? <UiText id="auth.mf48d12cf530a" /> : <UiText id="auth.md70928debc2e" />}
          </h2>
          {(switchingAccount || mode !== 'login') && <p id="account-login-description" className={styles.description}>
            {switchingAccount
              ? <UiText id="auth.mb6ec2a0bce6c" />
              : mode === 'register'
                ? <UiText id="auth.mb316e178dd33" />
                : <UiText id="auth.m0271eadb6be2" />}
          </p>}
          {loginNotice && <p className={styles.notice} role="status">{uiError(loginNotice)}</p>}
        </header>
        <form onSubmit={handleSubmit} className={styles.form}>
          <div>
            <label htmlFor="account-username" className={styles.label}><UiText id="auth.m1a3f0617d6de" /></label>
            <div className={styles.input}>
              <User size={17} aria-hidden="true" />
              <UiProps ids={{"placeholder":["auth.mc723b1fab58f"]}}><input id="account-username" name="username" type="text" autoComplete="username" value={username} onChange={e => setUsername(e.target.value)} placeholder="auth.mc723b1fab58f" disabled={mode === 'reset' || submitting} autoFocus /></UiProps>
            </div>
          </div>
          <div>
            <div className={styles.labelRow}>
              <label htmlFor="account-password" className={styles.label}>{mode === 'reset' ? <UiText id="auth.m515e9c7cf7b2" /> : <UiText id="auth.ma621ab606db2" />}</label>
              {!switchingAccount && mode === 'login' && <button type="button" className={styles.textButton} onClick={checkSelfResetAllowed} disabled={checkingReset || submitting}>{checkingReset ? <UiText id="auth.m6b72c3d6855c" /> : <UiText id="auth.m1d02d7f1c5c4" />}</button>}
            </div>
            <div className={styles.input}>
              <Lock size={17} aria-hidden="true" />
              <UiProps ids={{"placeholder":["auth.mba3c8c79cda3","auth.m728a7b601c56"]}}><input id="account-password" name="password" type={passwordVisible ? 'text' : 'password'} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} value={password} disabled={submitting} onChange={e => setPassword(e.target.value)} placeholder={mode === 'reset' ? "auth.mba3c8c79cda3" : "auth.m728a7b601c56"} /></UiProps>
              <UiProps ids={{"aria-label":["auth.mdd1d07bd9ceb","auth.mffe21a671190"]}}><button type="button" className={styles.reveal} aria-label={passwordVisible ? "auth.mdd1d07bd9ceb" : "auth.mffe21a671190"} aria-pressed={passwordVisible} onClick={() => setPasswordVisible(value => !value)}>{passwordVisible ? <EyeOff size={17} /> : <Eye size={17} />}</button></UiProps>
            </div>
          </div>
          {(mode === 'register' || mode === 'reset') && <div>
            <label htmlFor="account-confirm-password" className={styles.label}><UiText id="auth.m81b17bc0c362" /></label>
            <div className={styles.input}>
              <Lock size={17} aria-hidden="true" />
              <UiProps ids={{"placeholder":["auth.md0c9a0e81079"]}}><input id="account-confirm-password" type={passwordVisible ? 'text' : 'password'} autoComplete="new-password" value={confirmPassword} disabled={submitting} onChange={e => setConfirmPassword(e.target.value)} placeholder="auth.md0c9a0e81079" /></UiProps>
            </div>
          </div>}
          {error && <p role="alert" className={styles.error}>{uiError(error)}</p>}
          <button type="submit" disabled={submitting} className={styles.submit}>
            {submitting ? <><Loader2 size={17} className="animate-spin" /><UiText id="auth.m574ec7517de1" /></> : <>{mode === 'login' ? (switchingAccount ? <UiText id="auth.md6e5418232e8" /> : <UiText id="auth.m1e2df9c3075a" />) : mode === 'register' ? <UiText id="auth.mc4fb62202bad" /> : <UiText id="auth.m96f2cb4f04d3" />}<ArrowRight size={17} /></>}
          </button>
        </form>
        {!switchingAccount && <footer className={styles.footer}>
          {mode === 'login' ? <><UiText id="auth.m23e526538b99" /><button type="button" disabled={submitting} onClick={() => switchMode('register')} className={styles.textButton}><UiText id="auth.m76ddd9434330" /></button></> : <>{mode === 'register' ? <UiText id="auth.mbbaffe14e0da" /> : <UiText id="auth.m9daeb1d043ad" />}<button type="button" disabled={submitting} onClick={() => switchMode('login')} className={styles.textButton}><UiText id="auth.mdd388142a51c" /></button></>}
        </footer>}
      </div>
    </div>
  )
}
