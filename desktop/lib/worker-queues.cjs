// Inspect the same durable queues that the workers claim. Future retries and
// outstanding leases remain visible so reopening the app resumes pending work.
const QUEUES = `
  SELECT
    EXISTS (SELECT 1 FROM "ImageBatchOutput"
      WHERE "status" IN ('queued', 'submitting', 'waiting_provider')) AS "image-batch-worker",
    EXISTS (SELECT 1 FROM "LiveVideoPromptJob"
      WHERE "status" IN ('queued', 'running')) AS "live-video-prompt-worker",
    EXISTS (SELECT 1 FROM "LiveVideoBatchOutput"
      WHERE "status" IN ('queued', 'submitting', 'waiting_provider')) AS "live-video-video-worker"
  WHERE current_setting('inkvia.instance_id', true) = $1
`;

async function readWorkerQueues(pool, instanceId) {
  const { rows: [pending] } = await pool.query(QUEUES, [instanceId]);
  if (!pending) throw Error("任务队列连接的数据库与桌面实例不匹配");
  return pending;
}

async function countUnfinishedTasks(pool, instanceId) {
  const { rows: [result] } = await pool.query(`
    SELECT (
      (SELECT COUNT(*) FROM "ImageBatchOutput" WHERE "status" IN ('queued', 'submitting', 'waiting_provider')) +
      (SELECT COUNT(*) FROM "LiveVideoPromptJob" WHERE "status" IN ('queued', 'running')) +
      (SELECT COUNT(*) FROM "LiveVideoBatchOutput" WHERE "status" IN ('queued', 'submitting', 'waiting_provider')) +
      (SELECT COUNT(*) FROM "CanvasRun" WHERE "status" IN ('queued', 'running', 'cancel_requested', 'submission_unknown')) +
      (SELECT COUNT(*) FROM "Generation" generation WHERE "status" IN ('queued', 'pending', 'running', 'submitted', 'processing')
        AND NOT EXISTS (SELECT 1 FROM "ImageBatchOutput" output WHERE output."generationId" = generation."id")
        AND NOT EXISTS (SELECT 1 FROM "LiveVideoBatchOutput" output WHERE output."generationId" = generation."id"))
    )::int AS count
    WHERE current_setting('inkvia.instance_id', true) = $1
  `, [instanceId]);
  if (!result) throw Error("任务状态连接的数据库与桌面实例不匹配");
  return result.count;
}

module.exports = { readWorkerQueues, countUnfinishedTasks };
