/* eslint-disable @typescript-eslint/ban-ts-comment */
// @ts-nocheck -- `.open-next/worker.js` only exists after `opennextjs-cloudflare build`
// Custom Worker entry: OpenNext handles HTTP; we add the cron trigger that drives extraction.
import handler from "./.open-next/worker.js";
import { runPendingJobs } from "./lib/jobs/runner";
import type { AppEnv } from "./lib/env";

export { DOQueueHandler, DOShardedTagCache, BucketCachePurge } from "./.open-next/worker.js";

interface CronEvent { cron: string; scheduledTime: number }
interface Ctx { waitUntil(p: Promise<unknown>): void }

const worker = {
  fetch: handler.fetch,

  async scheduled(_event: CronEvent, env: AppEnv, ctx: Ctx) {
    // Drain up to a few batches per tick so a burst of paid orders doesn't wait several minutes.
    ctx.waitUntil((async () => {
      for (let i = 0; i < 3; i++) {
        const processed = await runPendingJobs(env, { mode: "cron", limit: 3 });
        if (processed === 0) break;
      }
    })());
  },
};

export default worker;
