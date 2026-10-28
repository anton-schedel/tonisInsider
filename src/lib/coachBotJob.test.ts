import { describe, expect, it } from "vitest";
import { dueJobs, type BotJob } from "./coachBotJob.ts";

const NOW = new Date("2026-10-22T20:30:00.000Z");
const job = (over: Partial<BotJob>): BotJob => ({ post_id: 1, state: "pending", tries: 1, updated_at: "2026-10-22T20:00:00.000Z", ...over });

describe("dueJobs", () => {
  it("picks jobs left pending or failed a while ago, oldest first", () => {
    const jobs = [
      job({ post_id: 1, updated_at: "2026-10-22T20:20:00.000Z" }),
      job({ post_id: 2, state: "failed", updated_at: "2026-10-22T20:10:00.000Z" }),
      job({ post_id: 3, state: "done" }),
    ];
    expect(dueJobs(jobs, NOW).map((j) => j.post_id)).toEqual([2, 1]);
  });
  it("leaves a job alone while the page may still be writing it", () => {
    expect(dueJobs([job({ updated_at: "2026-10-22T20:29:00.000Z" })], NOW)).toEqual([]);
    expect(dueJobs([job({ updated_at: "2026-10-22T20:26:00.000Z" })], NOW)).toHaveLength(1);
    expect(dueJobs([job({ updated_at: "2026-10-22T20:26:00.000Z" })], NOW, 6 * 60_000)).toEqual([]);
  });
  it("gives up after three tries", () => {
    expect(dueJobs([job({ state: "failed", tries: 3 })], NOW)).toEqual([]);
  });
  it("takes at most two per run", () => {
    expect(dueJobs([job({ post_id: 1 }), job({ post_id: 2 }), job({ post_id: 3 })], NOW)).toHaveLength(2);
  });
});
