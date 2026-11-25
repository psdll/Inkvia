import { NextRequest, NextResponse } from 'next/server'
import { getCurrentUser } from '@/lib/server-auth'
import { prisma } from '@/lib/prisma'
import { isAdminRequest } from '@/lib/admin-auth'
import { resolveAuthCookieSecure } from '@/lib/cookie-security'
import { isDesktopMode } from '@/lib/desktop-mode'

// GET - 获取当前用户信息
export async function GET(request: NextRequest) {
  const mode = isDesktopMode() ? { desktopMode: true } : {}
  try {
    const user = await getCurrentUser(request)

    if (!user) {
      return NextResponse.json(
        { user: null, ...mode },
        { status: 200 }
      )
    }

    return NextResponse.json({
      ...mode,
      user: {
        id: user.id,
        username: user.username,
        createdAt: user.createdAt,
        isAdmin: isAdminRequest(request),
      },
    })
  } catch (error) {
    console.error('获取用户信息失败:', error)
    return NextResponse.json({ user: null, ...mode }, { status: 200 })
  }
}

// DELETE - 登出
export async function DELETE(request: NextRequest) {
  try {
    const user = await getCurrentUser(request)

    if (user) {
      // 清除数据库中的 token
      await prisma.user.update({
        where: { id: user.id },
        data: { token: null },
      })
    }

    const response = NextResponse.json({ success: true })

    // 清除 cookie（属性须与登录时一致，否则部分浏览器不会删除原 cookie）
    response.cookies.set('auth_token', '', {
      httpOnly: true,
      secure: resolveAuthCookieSecure(request),
      sameSite: 'lax',
      maxAge: 0,
      path: '/',
    })

    return response
  } catch (error) {
    console.error('登出失败:', error)
    return NextResponse.json({ success: true })
  }
}
