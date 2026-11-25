import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
﻿import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { getAdminAccountPage, getAdminAccountSummary, invalidateAdminAccountSummary } from '@/lib/admin/account-directory'
import { randomUUID } from 'node:crypto'
import { requireAdminRequest } from "@/lib/admin-auth";
import { logAdminAction } from "@/lib/admin-audit";
import { preparePasswordVerification, revealUserCredential, writeUserCredential } from "@/lib/user-credentials";
import { CredentialError } from "@/lib/password-crypto";
import { hasSameRequestOrigin } from "@/lib/request-origin";
import {
  getPasswordResetAllowedUsernames,
  setPasswordResetAllowed,
} from "@/lib/password-reset-permission";
import {
  getMaterialUploadAllowedUsernames,
  setMaterialUploadAllowed,
} from "@/lib/material-upload-permission";
import {
  getInspirationTemplateUploadAllowedUsernames,
  setInspirationTemplateUploadAllowed,
} from "@/lib/inspiration-template-upload-permission";

// GET - 获取白名单 + 已注册用户列表
export async function GET(request: NextRequest) {
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }
    const query = request.nextUrl.searchParams;
    if (query.get('view') === 'summary') return NextResponse.json(await getAdminAccountSummary(), { headers: { 'Cache-Control': 'no-store' } });
    const pagination = query.get('view') === 'page'
      ? await getAdminAccountPage({ q: query.get('q') || '', page: Number(query.get('page')), pageSize: 50 }) : null;
    const [whitelist, users] = await Promise.all([
      prisma.whitelistName.findMany({ ...(pagination ? { where: { name: { in: pagination.names } } } : {}), orderBy: [{ createdAt: 'desc' }, { name: 'asc' }] }),
      prisma.user.findMany({
        ...(pagination ? { where: { username: { in: pagination.names } } } : {}),
        select: { id: true, username: true, createdAt: true },
        orderBy: { createdAt: 'desc' },
      }),
    ])

    const userIds = users.map((u) => u.id)
    const allAccountNames = Array.from(
      new Set([...whitelist.map((u) => u.name), ...users.map((u) => u.username)].filter(Boolean))
    )

    // 以下查询彼此独立，并行执行（之前是串行，5 次往返叠加是变慢主因）。
    // 计数一律用 groupBy 在数据库侧聚合，不把整张 generation 拉进内存逐条数。
    const [passwordResetAllowed, materialUploadAllowed, inspirationTemplateUploadAllowed, genCountGroup] = await Promise.all([
      getPasswordResetAllowedUsernames(users.map((u) => u.username)),
      getMaterialUploadAllowedUsernames(allAccountNames),
      getInspirationTemplateUploadAllowedUsernames(allAccountNames),
      userIds.length
        ? prisma.generation
            .groupBy({ by: ['authUserId'], where: { authUserId: { in: userIds } }, _count: { _all: true } })
            .catch(() => [] as any[])
        : Promise.resolve([] as any[]),
    ])

    // 每个注册用户的资产数（generation 按 authUserId 聚合）
    const genCountByAuthId = new Map<number, number>()
    for (const g of genCountGroup as any[]) {
      const aid = g.authUserId as number | null
      if (aid != null) genCountByAuthId.set(aid, g._count?._all ?? 0)
    }

    return NextResponse.json({
      ...(pagination ? { pagination: { page: pagination.page, pageSize: pagination.pageSize, total: pagination.total, hasMore: pagination.page * pagination.pageSize < pagination.total } } : {}),
      whitelist: whitelist.map((u) => ({
        ...u,
        materialUploadAllowed: materialUploadAllowed.has(u.name),
        inspirationTemplateUploadAllowed: inspirationTemplateUploadAllowed.has(u.name),
      })),
      users: users.map((u) => ({
        id: u.id,
        username: u.username,
        password: null,
        passwordResetAllowed: passwordResetAllowed.has(u.username),
        materialUploadAllowed: materialUploadAllowed.has(u.username),
        inspirationTemplateUploadAllowed: inspirationTemplateUploadAllowed.has(u.username),
        createdAt: u.createdAt,
        generationCount: genCountByAuthId.get(u.id) ?? 0,
      })),
    })
  } catch (error) {
    console.error('获取用户数据失败:', error)
    return NextResponse.json(
      { error: apiMessage("m200d3e4e0e6d") },
      { status: 500 }
    )
  }
}

// POST - 添加白名单用户名 / 重置密码 / 删除用户
export async function POST(request: NextRequest) {
  let auditCredential: ((result: string, credentialVersion?: number, grantId?: string) => Promise<void>) | undefined;
  let invalidateSummary = false;
  try {
    const admin = requireAdminRequest(request);
    if (!admin.ok) {
      return NextResponse.json({ error: apiErrorMessage(admin.error || apiMessage("m6eb5dc119e84")) }, { status: 403 });
    }
    const body = await request.json()
    const { action } = body
    invalidateSummary = true;
    if (['reset_password', 'reveal_password', 'set_self_reset'].includes(action)) {
      const requestId = randomUUID();
      auditCredential = (result, credentialVersion, grantId) => logAdminAction({ admin: admin.username, req: request,
        action, message: `账号凭证操作：${action}`, level: result === 'success' ? 'success' : 'warning',
        metadata: { userId: Number.isSafeInteger(body.userId) ? body.userId : null, result, credentialVersion, grantId, requestId } });
      if (!hasSameRequestOrigin(request)) { await auditCredential('origin_rejected'); return NextResponse.json({ error: apiMessage("m4fab5d58421b") }, { status: 403 }); }
      if (!Number.isSafeInteger(body.userId) || body.userId <= 0) { await auditCredential('invalid_target'); return NextResponse.json({ error: apiMessage("mb2666fd1ed9c") }, { status: 400 }); }
    }
    const adminPassword = String(body.adminPassword || '').trim()
    const expectedAdminPassword = String(process.env.ADMIN_PASSWORD || '').trim()
    const requiresAdminPassword = new Set([
      'remove_whitelist',
      'delete_user',
      'reveal_password',
    ]).has(String(action || ''))

    if (requiresAdminPassword && (!expectedAdminPassword || adminPassword !== expectedAdminPassword)) {
      await auditCredential?.('password_confirmation_rejected');
      return NextResponse.json(
        { error: apiMessage("me6d02c3fa01d") },
        { status: 401 }
      )
    }

    const addedNames = Array.isArray(body?.names)
      ? body.names.map((n: any) => String(n || "").trim()).filter(Boolean)
      : [];
    const targetName = String(body?.name || body?.username || "").trim();
    let auditMessage = `后台账号管理（${action || "未知"}）`;
    if (action === "add_whitelist") auditMessage = `添加用户：${addedNames.join("、") || "(空)"}`;
    else if (action === "remove_whitelist") auditMessage = `删除用户：${targetName || "(未知)"}`;
    else if (action === "reset_password") auditMessage = `重置密码：${targetName || "(未知)"}`;
    else if (action === "set_material_upload") auditMessage = `设置素材上传权限：${targetName || body?.userId || "(未知)"}`;
    else if (action === "set_inspiration_template_upload") auditMessage = `设置传灵感权限：${targetName || body?.userId || "(未知)"}`;
    if (!auditCredential) void logAdminAction({
      admin: admin.username,
      req: request,
      action: "auth_user_manage",
      level: "warning",
      message: auditMessage,
      metadata: { subAction: action, names: addedNames, name: targetName },
    });

    switch (action) {
      // 添加白名单用户名
      case 'add_whitelist': {
        const { names } = body // names: string[] 支持批量
        if (!names || !Array.isArray(names) || names.length === 0) {
          return NextResponse.json(
            { error: apiMessage("mc0ed948893d5") },
            { status: 400 }
          )
        }

        const results = []
        for (const name of names) {
          const trimmed = name.trim()
          if (!trimmed) continue
          try {
            await prisma.whitelistName.create({
              data: { name: trimmed },
            })
            results.push({ name: trimmed, success: true })
          } catch (e: any) {
            // 重复的用户名跳过
            if (e.code === 'P2002') {
              results.push({ name: trimmed, success: false, reason: '已存在' })
            } else {
              throw e
            }
          }
        }

        return NextResponse.json({ success: true, results })
      }

      // 删除白名单用户名
      case 'remove_whitelist': {
        const { name } = body
        if (!name) {
          return NextResponse.json(
            { error: apiMessage("m93afcc94d755") },
            { status: 400 }
          )
        }

        await prisma.whitelistName.delete({
          where: { name: name.trim() },
        })

        return NextResponse.json({ success: true })
      }

      // 重置用户密码
      case 'reset_password': {
        const { userId, newPassword } = body
        if (typeof newPassword !== 'string' || newPassword.length < 4 || newPassword.length > 256) {
          await auditCredential?.('invalid_password');
          return NextResponse.json(
            { error: apiMessage("m2a81c91756f8") },
            { status: 400 }
          )
        }

        const current = await prisma.user.findUniqueOrThrow({
          where: { id: userId },
          select: { credentialVersion: true },
        })
        const prepared = await preparePasswordVerification(newPassword);
        const credentialVersion = await prisma.$transaction(tx => writeUserCredential(tx, { userId, expectedVersion: current.credentialVersion, prepared }));
        await auditCredential?.('success', credentialVersion);
        return NextResponse.json({ success: true, credentialVersion }, { headers: { 'Cache-Control': 'no-store' } })
      }

      // 查看用户密码
      case 'reveal_password': {
        const { userId } = body
        if (!userId) {
          return NextResponse.json(
            { error: apiMessage("mcac82bb15c4a") },
            { status: 400 }
          )
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { id: true, password: true, passwordCipher: true, credentialVersion: true },
        })
        if (!user) {
          return NextResponse.json(
            { error: apiMessage("ma82de572ccd7") },
            { status: 404 }
          )
        }

        const password = revealUserCredential(user);
        await auditCredential?.('success', user.credentialVersion);
        return NextResponse.json({ success: true, password, credentialVersion: user.credentialVersion }, { headers: { 'Cache-Control': 'no-store' } })
      }

      // 允许/取消用户自助重置密码
      case 'set_self_reset': {
        const { userId, allowed } = body
        if (!userId) {
          return NextResponse.json(
            { error: apiMessage("mcac82bb15c4a") },
            { status: 400 }
          )
        }

        const user = await prisma.user.findUnique({
          where: { id: userId },
          select: { username: true },
        })
        if (!user) {
          return NextResponse.json(
            { error: apiMessage("ma82de572ccd7") },
            { status: 404 }
          )
        }

        if (typeof allowed !== 'boolean') { await auditCredential?.('invalid_request'); return NextResponse.json({ error: apiMessage("mebfd67f4d61e") }, { status: 400 }); }
        await setPasswordResetAllowed(user.username, allowed);
        await auditCredential?.('success');
        return NextResponse.json({ success: true, passwordResetAllowed: allowed }, { headers: { 'Cache-Control': 'no-store' } })
      }

      // 允许/取消用户在设置页上传素材
      case 'set_material_upload': {
        const { userId, allowed } = body
        let username = String(body?.username || body?.name || '').trim()

        if (!username && userId) {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true },
          })
          username = user?.username || ''
        }

        if (!username) {
          return NextResponse.json(
            { error: apiMessage("me74994e195be") },
            { status: 400 }
          )
        }

        const [registered, whitelisted] = await Promise.all([
          prisma.user.findUnique({ where: { username }, select: { id: true } }),
          prisma.whitelistName.findUnique({ where: { name: username }, select: { id: true } }),
        ])
        if (!registered && !whitelisted) {
          return NextResponse.json(
            { error: apiMessage("ma82de572ccd7") },
            { status: 404 }
          )
        }

        await setMaterialUploadAllowed(username, Boolean(allowed))
        return NextResponse.json({ success: true, materialUploadAllowed: Boolean(allowed) })
      }

      // 允许/取消用户在资产详情中上传灵感模板
      case 'set_inspiration_template_upload': {
        const { userId, allowed } = body
        let username = String(body?.username || body?.name || '').trim()

        if (!username && userId) {
          const user = await prisma.user.findUnique({
            where: { id: userId },
            select: { username: true },
          })
          username = user?.username || ''
        }

        if (!username) {
          return NextResponse.json(
            { error: apiMessage("me74994e195be") },
            { status: 400 }
          )
        }

        const [registered, whitelisted] = await Promise.all([
          prisma.user.findUnique({ where: { username }, select: { id: true } }),
          prisma.whitelistName.findUnique({ where: { name: username }, select: { id: true } }),
        ])
        if (!registered && !whitelisted) {
          return NextResponse.json(
            { error: apiMessage("ma82de572ccd7") },
            { status: 404 }
          )
        }

        await setInspirationTemplateUploadAllowed(username, Boolean(allowed))
        return NextResponse.json({ success: true, inspirationTemplateUploadAllowed: Boolean(allowed) })
      }

      // 删除用户
      case 'delete_user': {
        const { userId: deleteId } = body
        if (!deleteId) {
          return NextResponse.json(
            { error: apiMessage("mcac82bb15c4a") },
            { status: 400 }
          )
        }
        const deletingUser = await prisma.user.findUnique({
          where: { id: deleteId },
          select: { username: true },
        })

        // 先把该用户的生成记录的 authUserId 置空（保留数据但解绑）
        await prisma.generation.updateMany({
          where: { authUserId: deleteId },
          data: { authUserId: null },
        })

        await prisma.user.delete({
          where: { id: deleteId },
        })
        if (deletingUser?.username) {
          await setPasswordResetAllowed(deletingUser.username, false)
          await setMaterialUploadAllowed(deletingUser.username, false)
          await setInspirationTemplateUploadAllowed(deletingUser.username, false)
        }

        return NextResponse.json({ success: true })
      }

      default:
        return NextResponse.json(
          { error: apiMessage("mf242d2db4cea") },
          { status: 400 }
        )
    }
  } catch (error) {
    await auditCredential?.('failed');
    if (error instanceof CredentialError) {
      const message = error.code === 'PASSWORD_LEGACY_HASH_ONLY' ? '历史记录仅有密码哈希，无法还原原文；现有登录仍可使用' : error.code === 'CREDENTIAL_VERSION_CONFLICT' ? '密码已被其他操作更新，请刷新后重试' : '密码密钥配置或密文校验异常，请管理员修复配置';
      return NextResponse.json({ error: apiErrorMessage(message), code: error.code }, { status: error.code === 'CREDENTIAL_VERSION_CONFLICT' ? 409 : 503, headers: { 'Cache-Control': 'no-store' } });
    }
    console.error('管理员操作失败')
    return NextResponse.json(
      { error: apiMessage("m0c3b4cf7aa25") },
      { status: 500 }
    )
  } finally {
    if (invalidateSummary) invalidateAdminAccountSummary();
  }
}
