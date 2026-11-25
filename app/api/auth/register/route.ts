import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateToken } from '@/lib/server-auth'
import { resolveAuthCookieSecure } from '@/lib/cookie-security'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { registerSchema } from '@/lib/validation/auth'
import { createUserCredential, preparePasswordVerification } from '@/lib/user-credentials'

export async function POST(request: NextRequest) {
  try {
    // 注册限流：同一 IP 1 小时内最多 10 次
    const ip = getClientIp(request)
    const limited = rateLimit(`register:${ip}`, { limit: 10, windowMs: 60 * 60 * 1000 })
    if (!limited.ok) {
      return NextResponse.json(
        { error: apiMessage("m7ac34e96535b") },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) } }
      )
    }

    const parsed = registerSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: apiErrorMessage(parsed.error.errors[0]?.message || apiMessage("mfc77bc7bce4d")) },
        { status: 400 }
      )
    }
    const { username, password } = parsed.data

    // 检查用户名是否在白名单中
    const whitelist = await prisma.whitelistName.findUnique({
      where: { name: username },
    })

    if (!whitelist) {
      return NextResponse.json(
        { error: apiMessage("me0152588bbde") },
        { status: 403 }
      )
    }

    // 检查是否已注册
    const existing = await prisma.user.findUnique({
      where: { username },
    })

    if (existing) {
      return NextResponse.json(
        { error: apiMessage("mb981978295bc") },
        { status: 409 }
      )
    }

    // 验证材料与可查看密文在同一事务内创建。
    const token = generateToken()
    const prepared = await preparePasswordVerification(password)
    const user = await prisma.$transaction(tx => createUserCredential(tx, { username, prepared, token }))

    // 设置 cookie
    const response = NextResponse.json({
      success: true,
      user: {
        id: user.id,
        username: user.username,
      },
    })

    response.cookies.set('auth_token', token, {
      httpOnly: true,
      secure: resolveAuthCookieSecure(request),
      sameSite: 'lax',
      maxAge: 60 * 60 * 24 * 30, // 30天
      path: '/',
    })

    return response
  } catch (error) {
    console.error('注册失败')
    return NextResponse.json(
      { error: apiMessage("m8e7222fcc6f5") },
      { status: 500 }
    )
  }
}
