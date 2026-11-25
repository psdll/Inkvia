import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { generateToken } from '@/lib/server-auth'
import { verifyUserCredential } from '@/lib/user-credentials'
import { resolveAuthCookieSecure } from '@/lib/cookie-security'
import { getClientIp, rateLimit } from '@/lib/rate-limit'
import { loginSchema } from '@/lib/validation/auth'

export async function POST(request: NextRequest) {
  try {
    // 登录限流：同一 IP 5 分钟内最多 10 次尝试，防暴力破解
    const ip = getClientIp(request)
    const limited = rateLimit(`login:${ip}`, { limit: 10, windowMs: 5 * 60 * 1000 })
    if (!limited.ok) {
      return NextResponse.json(
        { error: apiMessage("m3245d6d9e5a0") },
        { status: 429, headers: { 'Retry-After': String(Math.ceil(limited.retryAfterMs / 1000)) } }
      )
    }

    const parsed = loginSchema.safeParse(await request.json().catch(() => null))
    if (!parsed.success) {
      return NextResponse.json(
        { error: apiErrorMessage(parsed.error.errors[0]?.message || apiMessage("mfc77bc7bce4d")) },
        { status: 400 }
      )
    }
    const { username, password } = parsed.data

    // 查找用户
    const user = await prisma.user.findUnique({
      where: { username },
    })

    if (!user) {
      return NextResponse.json(
        { error: apiMessage("mdfe7b116f7c2"), code: "AUTH_USER_NOT_FOUND" },
        { status: 404 }
      )
    }

    // 校验密码（兼容历史 bcrypt 哈希记录 + 明文记录）
    const verification = await verifyUserCredential(user, password)
    if (!verification.valid) {
      return NextResponse.json(
        { error: apiMessage("m4585c8223a69") },
        { status: 401 }
      )
    }

    // 登录只签发会话；与改密竞争时旧验证结果不能产生有效的新会话。
    const token = generateToken()
    const updated = await prisma.user.updateMany({
      where: { id: user.id, credentialVersion: user.credentialVersion, password: user.password },
      data: { token },
    })
    if (updated.count !== 1) return NextResponse.json({ error: apiMessage("me559ccc5f437") }, { status: 409 })

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
      maxAge: 60 * 60 * 24 * 30,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('登录失败')
    return NextResponse.json(
      { error: apiMessage("mf2d6e6d1b9b8") },
      { status: 500 }
    )
  }
}
