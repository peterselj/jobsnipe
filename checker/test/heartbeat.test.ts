import { describe, expect, it } from "vitest";
import { heartbeatProblem, type RunRow } from "../src/heartbeat.js";

const now = new Date("2026-11-10T12:00:00Z");
const run = (hoursAgo: number, trigger = "schedule", finished = true): RunRow => {
  const at = new Date(now.getTime() - hoursAgo * 3_600_000).toISOString();
  return { trigger, started_at: at, finished_at: finished ? at : null };
};

describe("heartbeat", () => {
  it("is quiet while checks run hourly", () => {
    expect(heartbeatProblem([run(0.5), run(1.5), run(2.5, "backup schedule")], now)).toBeUndefined();
    expect(heartbeatProblem([run(0.2, "check now"), run(4, "backup schedule")], now)).toBeUndefined();
  });

  it("speaks up when no check has finished in three hours", () => {
    expect(heartbeatProblem([run(0.1, "schedule", false), run(5)], now)).toMatch(/No check has finished in 5 hours/);
    expect(heartbeatProblem([], now)).toMatch(/ever finished/);
  });

  it("speaks up when only GitHub's backup schedule is starting checks", () => {
    const backupOnly = [run(1, "backup schedule"), run(4, "backup schedule"), run(7, "backup schedule"), run(9)];
    expect(heartbeatProblem(backupOnly, now)).toMatch(/only running on GitHub's 3-hourly backup.*9 hours/);
    expect(heartbeatProblem([run(1, "backup schedule"), run(5)], now)).toBeUndefined(); // one missed hour isn't an outage
  });
});
