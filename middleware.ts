import { NextRequest, NextResponse } from 'next/server'

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // 将 /uploads/... 请求转发到自定义文件服务路由
  // 这样无论服务器如何部署，都能从正确的磁盘路径读取文件
  if (pathname.startsWith('/uploads/')) {
    const url = request.nextUrl.clone()
    // /uploads/image_results/xxx.png → /api/uploads/image_results/xxx.png
    url.pathname = '/api/uploads' + pathname.slice('/uploads'.length)
    return NextResponse.rewrite(url)
  }

  return NextResponse.next()
}

export const config = {
  matcher: '/uploads/:path*',
}
