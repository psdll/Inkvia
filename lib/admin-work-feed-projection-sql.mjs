function assertSqlIdentifier(value, label) {
  if (!/^[a-z][a-z0-9_]*$/i.test(value)) throw new Error(`invalid ${label}`);
  return value;
}

function normalizedUrl(valueSql) {
  return `CASE
    WHEN ${valueSql} IS NULL OR btrim(${valueSql}) IN ('', 'null', 'undefined') THEN NULL
    WHEN replace(btrim(${valueSql}), E'\\\\', '/') LIKE 'uploads/%'
      THEN '/' || replace(btrim(${valueSql}), E'\\\\', '/')
    ELSE replace(btrim(${valueSql}), E'\\\\', '/')
  END`;
}

export function buildAdminWorkFeedProjectionCtes(sourceSql, options = {}) {
  const prefix = assertSqlIdentifier(options.prefix || "admin_work_feed", "projection prefix");
  const finalName = assertSqlIdentifier(options.finalName || "source", "projection result name");
  const input = `${prefix}_input`;
  const meta = `${prefix}_meta`;
  const assets = `${prefix}_assets`;
  const display = `${prefix}_display`;

  const localPath = normalizedUrl(`${meta}."localPath"`);
  const outputDisplay = normalizedUrl(`${meta}."projectedMeta"->>'outputDisplayUrl'`);
  const outputPreview = normalizedUrl(`${meta}."projectedMeta"->>'outputPreviewUrl'`);
  const outputPoster = normalizedUrl(`${meta}."projectedMeta"->>'outputPosterUrl'`);
  const legacyDisplay = normalizedUrl(`${meta}."projectedMeta"->>'displayUrl'`);
  const outputThumb = normalizedUrl(`${meta}."projectedMeta"->>'outputThumbUrl'`);
  const isAudio = `(lower(COALESCE(${display}."type", '')) = 'audio_gen'
    OR lower(COALESCE(${display}."projectedLocalPath", '')) ~ '\\.(mp3|wav|m4a|aac|ogg|flac)([?#].*)?$')`;

  return `${input} AS MATERIALIZED (
    ${sourceSql}
  ), ${meta} AS MATERIALIZED (
    SELECT ${input}.*,
           CASE
             WHEN pg_input_is_valid(COALESCE(${input}."templateData", ''), 'jsonb')
               THEN CASE
                 WHEN jsonb_typeof(${input}."templateData"::jsonb) = 'object'
                   THEN ${input}."templateData"::jsonb
                 ELSE '{}'::jsonb
               END
             ELSE '{}'::jsonb
           END AS "projectedMeta"
    FROM ${input}
  ), ${assets} AS MATERIALIZED (
    SELECT ${meta}.*,
           ${localPath} AS "projectedLocalPath",
           ${outputDisplay} AS "projectedOutputDisplayUrl",
           ${outputPreview} AS "projectedOutputPreviewUrl",
           ${outputPoster} AS "projectedOutputPosterUrl",
           ${legacyDisplay} AS "projectedLegacyDisplayUrl",
           ${outputThumb} AS "projectedOutputThumbUrl"
    FROM ${meta}
  ), ${display} AS MATERIALIZED (
    SELECT ${assets}.*,
           COALESCE(
             ${assets}."projectedOutputDisplayUrl",
             ${assets}."projectedOutputPreviewUrl",
             ${assets}."projectedOutputPosterUrl",
             ${assets}."projectedLegacyDisplayUrl",
             ${assets}."projectedLocalPath"
           ) AS "projectedDisplayUrl"
    FROM ${assets}
  ), ${finalName} AS MATERIALIZED (
    SELECT ${display}.*,
           CASE
             WHEN ${isAudio} THEN 'audio'
             WHEN lower(COALESCE(${display}."type", '')) IN ('video_gen', 'video_generate')
               OR lower(COALESCE(${display}."projectedLocalPath", '')) ~ '\\.(mp4|webm|mov|m4v|mkv|avi)([?#].*)?$'
             THEN 'video' ELSE 'image'
           END AS "projectedMediaKind",
           CASE WHEN ${isAudio} THEN NULL ELSE COALESCE(
             ${display}."projectedOutputThumbUrl",
             ${display}."projectedOutputPreviewUrl",
             ${display}."projectedOutputPosterUrl",
             ${display}."projectedDisplayUrl"
           ) END AS "projectedThumbUrl",
           CASE WHEN ${isAudio} THEN NULL ELSE COALESCE(
             ${display}."projectedOutputPreviewUrl",
             CASE WHEN ${display}."projectedOutputPosterUrl" IS NULL
               THEN ${display}."projectedDisplayUrl" END
           ) END AS "projectedPreviewUrl",
           CASE WHEN ${isAudio} THEN NULL ELSE ${display}."projectedOutputPosterUrl" END AS "projectedPosterUrl",
           NULLIF(${display}."projectedMeta"->>'errorCode', '') AS "projectedErrorCode"
    FROM ${display}
  )`;
}
