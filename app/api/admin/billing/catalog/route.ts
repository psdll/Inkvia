import { apiErrorMessage, apiMessage } from "@/i18n/api-message";
import { NextRequest, NextResponse } from "next/server";
import { VOLC_ASR_MODEL_ID } from "@/lib/volcengine-asr-models";
import { randomUUID } from "node:crypto";
import { requireAdminRequest } from "@/lib/admin-auth";
import { getBillingCatalog, UNIT_LABELS } from "@/lib/billing/catalog";
import { MEDIAKIT_PROVIDER, MEDIAKIT_SUBTITLE_MODEL } from "@/lib/volcengine-mediakit-models";
import {
  billingDate,
  BILLING_SETTING_KEY,
  conditionKey,
  validatePrice,
} from "@/lib/billing/money";
import { readBillingSettings, withBillingWrite } from "@/lib/billing/settings";
import {
  DRAFT_FORMAT,
  validateDraft,
  mergeDrafts,
} from "@/lib/billing/drafts";
import { APIMART_QUOTES } from "@/lib/billing/apimart-pricing";
import { GOOGLE_IMAGE_QUOTES } from "@/lib/billing/google-pricing";
import { TUZI_IMAGE_QUOTES } from "@/lib/billing/tuzi-pricing";
import { OPENROUTER_IMAGE_QUOTES } from "@/lib/billing/openrouter-pricing";
import { batchDrafts, batchRateDrafts } from "@/lib/billing/batch-drafts";
import { exportAllPrices, exportCurrentPrices, planPriceImport } from "@/lib/billing/migration";
import type { PriceImportReport } from "@/lib/billing/migration-contracts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export async function GET(req: NextRequest) {
  if (!requireAdminRequest(req).ok)
    return NextResponse.json({ error: apiMessage("m9228f9aa4c65") }, { status: 401 });
  try {
    if (req.nextUrl.searchParams.get("export") === "migration") {
      const file = await withBillingWrite(async db => {
        const at = new Date();
        const settings = await readBillingSettings(db);
        return exportCurrentPrices(settings, await getBillingCatalog(settings, at, db), at);
      });
      return new NextResponse(JSON.stringify(file, null, 2), { headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="model-prices-migration.json"',
        "Cache-Control": "no-store",
      } });
    }
    if (req.nextUrl.searchParams.get("export") === "all") {
      const backup = await withBillingWrite(async (db) => exportAllPrices(
        await readBillingSettings(db),
        await db.billingPriceRule.findMany({ orderBy: [{ provider: "asc" }, { model: "asc" }, { effectiveFrom: "asc" }, { id: "asc" }] }),
      ));
      return new NextResponse(JSON.stringify(backup, null, 2), { headers: {
        "Content-Type": "application/json; charset=utf-8",
        "Content-Disposition": 'attachment; filename="model-prices-all.json"',
        "Cache-Control": "no-store",
      } });
    }
    const settings = await readBillingSettings();
    if (req.nextUrl.searchParams.get("export") === "drafts")
      return new NextResponse(
        JSON.stringify(
          { format: DRAFT_FORMAT, drafts: settings.drafts || [] },
          null,
          2,
        ),
        {
          headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Content-Disposition":
              'attachment; filename="model-price-drafts.json"',
            "Cache-Control": "no-store",
          },
        },
      );
    return NextResponse.json(
      {
        settings,
        models: await getBillingCatalog(settings),
        units: UNIT_LABELS,
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch (e) {
    return NextResponse.json(
      { error: apiErrorMessage(e instanceof Error ? e.message : apiMessage("m6aa27f14bff1")) },
      { status: 500 },
    );
  }
}
export async function POST(req: NextRequest) {
  if (!requireAdminRequest(req).ok)
    return NextResponse.json({ error: apiMessage("m9228f9aa4c65") }, { status: 401 });
  try {
    const body = await req.json();
    const result = await withBillingWrite(async (db) => {
      const settings = await readBillingSettings(db);
      let importReport: PriceImportReport | undefined;
      let published: { models: number; rows: number; rates: number; conflicts: string[]; unavailable: string[] } | undefined;
      if (body.revision !== settings.revision)
        throw new Error("配置已被其他管理员修改，请刷新后重试");
      if (body.action === "publishDraft") {
        const draft = settings.drafts?.find((d) => d.id === body.draftId);
        if (!draft) throw new Error("草稿已变化，请刷新");
        Object.assign(body, draft, { action: "prices" });
      }
      if (body.action === "publishDrafts") {
        billingDate(String(body.effectiveDate));
        const catalog = await getBillingCatalog(settings, billingDate(String(body.effectiveDate)), db);
        const plan = batchDrafts(settings.drafts || [], String(body.provider || ""), catalog);
        const ratePlan = batchRateDrafts(settings.rateDrafts || [], String(body.provider || ""), catalog);
        if (!plan.ready.length && !ratePlan.ready.length) throw new Error("没有可批量发布的价格或换算草稿");
        for (const rate of ratePlan.ready) publishRate(settings, { ...rate, rateDraftId: rate.id, effectiveDate: body.effectiveDate });
        for (const draft of plan.ready) {
          try {
            await publishPrices(db, settings, { ...draft, effectiveDate: body.effectiveDate, rows: draft.rows.filter(r => r.price !== "") }, true);
          } catch (e) {
            throw new Error(`${draft.label}：${e instanceof Error ? e.message : "发布失败"}。本次批量操作未保存任何价格。`);
          }
        }
        const ids = new Set(plan.ready.map(d => d.id));
        settings.drafts = (settings.drafts || []).flatMap(d => {
          if (!ids.has(d.id)) return [d];
          const rows = d.rows.filter(r => r.price === "");
          return rows.length ? [validateDraft({ ...d, rows })] : [];
        });
        published = { models: plan.ready.length, rows: plan.rowCount, rates: ratePlan.ready.length, conflicts: [...plan.conflicts, ...ratePlan.conflicts], unavailable: [...plan.unavailable, ...ratePlan.unavailable] };
      } else if (body.action === "previewImport" || body.action === "importDrafts") {
        const plan = planPriceImport(body.file, settings, await getBillingCatalog(settings, new Date(), db), UNIT_LABELS);
        if (body.action === "previewImport" || !plan.report.items.some((item) => item.status === "ready"))
          return { ok: true, revision: settings.revision, importReport: plan.report };
        settings.drafts = plan.drafts;
        settings.rateDrafts = plan.rateDrafts;
        importReport = { items: plan.report.items.map((item) => item.status === "ready" ? { ...item, status: "imported" } : item) };
      } else if (body.action === "saveDraft") {
        const incoming = [validateDraft(body)];
        const catalog = await getBillingCatalog(settings, new Date(), db);
        for (const d of incoming) {
          if (
            !catalog.some(
              (m) =>
                m.provider === d.provider &&
                m.model === d.model &&
                m.module === d.module,
            )
          )
            throw new Error(
              `未接入模型：${d.provider} / ${d.model}；请先更新线上代码及模型配置`,
            );
          if (d.rows.some((r) => !UNIT_LABELS[r.unitType]))
            throw new Error("草稿计费单位无效");
        }
        settings.drafts = mergeDrafts(settings.drafts || [], incoming);
      } else if (body.action === "rate") {
        publishRate(settings, body);
      } else if (body.action === "prices") {
        await publishPrices(db, settings, body);
      } else if (body.action === "mode") {
        if (!["observe", "strict"].includes(body.mode))
          throw new Error("模式无效");
        if (body.mode === "strict") {
          const missing = (
            await getBillingCatalog(settings, new Date(), db)
          ).filter((m) => m.enabled && !m.complete);
          if (missing.length)
            throw new Error(
              `仍有 ${missing.length} 个启用模型缺少价格或汇率：${missing
                .slice(0, 5)
                .map((m) => m.label)
                .join("、")}`,
            );
        }
        settings.mode = body.mode;
      } else throw new Error("操作无效");
      settings.revision++;
      await db.appSetting.upsert({
        where: { key: BILLING_SETTING_KEY },
        create: { key: BILLING_SETTING_KEY, value: JSON.stringify(settings) },
        update: { value: JSON.stringify(settings) },
      });
      return { ok: true, revision: settings.revision, published, importReport };
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json(
      { error: apiErrorMessage(e instanceof Error ? e.message : apiMessage("m6309a3bb5ba4")) },
      { status: 400 },
    );
  }
}

function publishRate(settings: Awaited<ReturnType<typeof readBillingSettings>>, body: any) {
  const effectiveFrom = billingDate(
    String(body.effectiveDate),
  ).toISOString();
  const provider = String(body.provider || "").trim();
  const currency = String(body.currency || "")
    .trim()
    .toUpperCase();
  if (
    !provider ||
    !/^(?:[A-Z]{3}|CREDIT)$/.test(currency) ||
    currency === "CNY"
  )
    throw new Error("请选择供应商及外币或积分");
  const rate = validatePrice(body.rate, "每单位折合人民币");
  if (Number(rate) <= 0) throw new Error("换算比例必须大于零");
  const dates = settings.rates
    .filter((r) => r.provider === provider && r.currency === currency)
    .map((r) => r.effectiveFrom)
    .sort();
  if (
    dates.includes(effectiveFrom) ||
    (dates.length &&
      effectiveFrom > dates[0] &&
      effectiveFrom < dates[dates.length - 1])
  )
    throw new Error(
      "不能覆盖已有汇率区间；可补录最早版本之前的汇率，或新增后续版本",
    );
  settings.rates.push({
    id: randomUUID(),
    provider,
    currency,
    rate,
    effectiveFrom,
    notes: String(body.notes || ""),
  });
  if (body.rateDraftId) settings.rateDrafts = (settings.rateDrafts || []).filter((rate) => rate.id !== body.rateDraftId);
}

async function publishPrices(db: any, settings: Awaited<ReturnType<typeof readBillingSettings>>, body: any, partial = false) {
        const effectiveFrom = billingDate(String(body.effectiveDate));
        const provider = String(body.provider || "").trim();
        const model = String(body.model || "").trim();
        const modelModule = String(body.module || "").trim();
        const currency = String(body.currency || "CNY").toUpperCase();
        if (
          !provider ||
          !model ||
          !modelModule ||
          !/^(?:[A-Z]{3}|CREDIT)$/.test(currency)
        )
          throw new Error("模型、供应商或币种无效");
        if (
          !Array.isArray(body.rows) ||
          !body.rows.length ||
          body.rows.length > 3000
        )
          throw new Error("请填写整套价格");
        const known = (
          await getBillingCatalog(settings, effectiveFrom, db, {
            provider,
            model,
          })
        )[0];
        if (!known || known.module !== modelModule)
          throw new Error("模型分类无效，请刷新模型目录");
        const allowed =
          provider === "openrouter" && modelModule === "image"
            ? ["provider_usd", ...(OPENROUTER_IMAGE_QUOTES[model] || []).map(r => r.unitType)]
            : provider === "apimart" && APIMART_QUOTES[model]
            ? [...new Set(APIMART_QUOTES[model].map((r) => r.unitType))]
            : provider === "google-ai-studio" && GOOGLE_IMAGE_QUOTES[model]
              ? GOOGLE_IMAGE_QUOTES[model].map((r) => r.unitType)
            : provider === "tuzi" && TUZI_IMAGE_QUOTES[model]
              ? TUZI_IMAGE_QUOTES[model].map(r => r.unitType)
            : modelModule === "agent"
              ? [
                  "input_million_token",
                  "output_million_token",
                  "cached_million_token",
                  "cache_creation_million_token",
                ]
              : modelModule === "image"
                ? ["image", "request", ...(provider === "volcengine" && model === "doubao-seedream-5.0-pro" ? ["additional_input_image"] : []), ...(((provider === "bailian" && model === "qwen-image-3.0") || (provider === "apimart" && model === "seedream-5.5-apimart") || (provider === "volcengine" && model === "doubao-seedream-5.5")) ? ["input_image"] : [])]
                : modelModule === "audio"
                  ? ["second", "request", "ten_thousand_character", ...(provider === "volcengine-speech" && (model === "seed-audio-1.0" || model === VOLC_ASR_MODEL_ID) ? ["minute"] : [])]
                  : modelModule === "video"
                    ? provider === MEDIAKIT_PROVIDER && model === MEDIAKIT_SUBTITLE_MODEL
                      ? ["minute"]
                      : model === "minimax-h3"
                      ? ["second", "input_second", "excess_image"]
                      : ["video", "second", "million_token", "request", ...(provider === MEDIAKIT_PROVIDER && model === MEDIAKIT_SUBTITLE_MODEL ? ["minute"] : [])]
                    : ["request", "image"];
        const keys = new Set<string>();
        const rows = body.rows.map((row: any) => {
          if (!UNIT_LABELS[row.unitType] || !allowed.includes(row.unitType))
            throw new Error("计费单位不适用于该模型");
          const conditions = row.conditions || {};
          if (
            typeof conditions !== "object" ||
            Array.isArray(conditions) ||
            Object.values(conditions).some(
              (v) =>
                !["string", "number", "boolean"].includes(typeof v) &&
                !Array.isArray(v),
            )
          )
            throw new Error("价格条件无效");
          const key = `${row.unitType}|${conditionKey(conditions)}`;
          if (keys.has(key)) throw new Error("价格档位重复");
          keys.add(key);
          return {
            provider,
            model,
            module: modelModule,
            displayName: String(body.label || model),
            currency,
            unitType: row.unitType,
            unitPrice: validatePrice(row.price),
            matchConditions: conditions,
            priority: 100,
            isActive: true,
            effectiveFrom,
            notes: String(body.notes || ""),
          };
        });
        const mainRows = rows.filter(
          (r: any) => !["input_second", "excess_image", "additional_input_image", "input_image"].includes(r.unitType),
        );
        if (
          modelModule !== "agent" &&
          !(provider === "openrouter" && modelModule === "image") &&
          !mainRows.every((r: any) => r.unitType.endsWith("_million_token")) &&
          new Set(mainRows.map((r: any) => r.unitType)).size > 1
        )
          throw new Error("同一模型的主要计费单位必须一致");
        for (let i = 0; i < rows.length; i++)
          for (let j = i + 1; j < rows.length; j++) {
            const a = rows[i],
              b = rows[j];
            if (
              a.unitType !== b.unitType ||
              Object.keys(a.matchConditions).length !==
                Object.keys(b.matchConditions).length
            )
              continue;
            const overlaps = Object.keys(a.matchConditions).every((key) => {
              if (!(key in b.matchConditions)) return true;
              const values = (v: any) =>
                (Array.isArray(v) ? v : [v]).map((x) =>
                  String(x).trim().toLowerCase(),
                );
              return values(a.matchConditions[key]).some((v: string) =>
                values(b.matchConditions[key]).includes(v),
              );
            });
            if (overlaps)
              throw new Error("存在重叠价格档位，请合并同价档位或拆开适用条件");
          }
        const allExisting = await db.billingPriceRule.findMany({
          where: { provider, model, isActive: true },
        });
        const existing = partial ? allExisting.filter((r: any) => keys.has(`${r.unitType}|${conditionKey(r.matchConditions || {})}`)) : allExisting;
        if (existing.some((r: any) => +r.effectiveFrom === +effectiveFrom))
          throw new Error(
            "该生效时间已有价格版本，不能覆盖；请使用新的生效日期",
          );
        const nextStart =
          existing
            .filter((r: any) => +r.effectiveFrom > +effectiveFrom)
            .sort((a: any, b: any) => +a.effectiveFrom - +b.effectiveFrom)[0]
            ?.effectiveFrom || null;
        if (
          nextStart &&
          existing.some((r: any) => +r.effectiveFrom < +effectiveFrom)
        )
          throw new Error(
            "不能插入并改写已有历史价格区间；仅可补录首个版本之前的缺失价格，或新增后续版本",
          );
        await db.billingPriceRule.updateMany({
          where: {
            provider,
            model,
            ...(partial ? { id: { in: existing.map((r: any) => r.id) } } : {}),
            isActive: true,
            effectiveFrom: { lt: effectiveFrom },
            OR: [{ effectiveTo: null }, { effectiveTo: { gt: effectiveFrom } }],
          },
          data: { effectiveTo: effectiveFrom },
        });
        await db.billingPriceRule.createMany({
          data: rows.map((r: any) => ({ ...r, effectiveTo: partial
            ? existing.filter((old: any) => old.unitType === r.unitType
                && conditionKey(old.matchConditions || {}) === conditionKey(r.matchConditions)
                && +old.effectiveFrom > +effectiveFrom)
                .sort((a: any, b: any) => +a.effectiveFrom - +b.effectiveFrom)[0]?.effectiveFrom || null
            : nextStart })),
        });
        const catalog = await getBillingCatalog(settings, effectiveFrom, db);
        const saved = catalog.find(
          (m) => m.provider === provider && m.model === model,
        );
        if (!partial && !saved?.complete)
          throw new Error(
            `价格未配齐或缺少该生效日适用的汇率：${
              saved?.slots
                .filter((s) => s.missing)
                .slice(0, 3)
                .map((s) => `${s.label} ${s.missing}`)
                .join("；") || "模型未识别"
            }`,
          );
        if (body.draftId)
          settings.drafts = settings.drafts?.filter(
            (d) =>
              !(
                d.id === body.draftId &&
                d.provider === provider &&
                d.model === model
              ),
          );

}
