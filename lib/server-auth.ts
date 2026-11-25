import { prisma } from '@/lib/prisma'
import { cookies } from 'next/headers'
import crypto from 'crypto'

// 生成随机 token
export function generateToken(): string {
  return crypto.randomBytes(32).toString('hex')
}

// 从请求中获取当前登录用户
// 优先从 cookie 取，其次从 Authorization header 取
export async function getCurrentUser(request?: Request) {
  let token: string | null = null

  // 方式1：从 cookie 中取
  try {
    const cookieStore = await cookies()
    token = cookieStore.get('auth_token')?.value || null
  } catch {
    // cookies() 在某些上下文中可能不可用
  }

  // 方式2：从请求 header 中取
  if (!token && request) {
    const authHeader = request.headers.get('Authorization')
    if (authHeader?.startsWith('Bearer ')) {
      token = authHeader.slice(7)
    }
  }

  if (!token) return null

  try {
    const user = await prisma.user.findUnique({
      where: { token },
      select: {
        id: true,
        username: true,
        createdAt: true,
      },
    })
    return user
  } catch {
    return null
  }
}

// 从请求中获取 userId（简化版，供 API 路由快速使用）
// 如果未登录返回 null，不会报错
export async function getUserId(request: Request): Promise<number | null> {
  const user = await getCurrentUser(request)
  return user?.id || null
}
