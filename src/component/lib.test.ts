/// <reference types="vite/client" />
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { api, internal } from "./_generated/api.js";
import { initConvexTest } from "./setup.test.js";

describe("component lib", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("getUser returns null when user does not exist", async () => {
    const t = initConvexTest();
    const result = await t.query(api.lib.getUser, { kindeId: "kp_test123" });
    expect(result).toBeNull();
  });

  test("handleWebhookEvent creates a user", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.handleWebhookEvent, {
      webhookId: "webhook-001",
      type: "user.created",
      kindeId: "kp_test123",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      isSuspended: false,
      organizations: [],
    });
    const user = await t.query(api.lib.getUser, { kindeId: "kp_test123" });
    expect(user).not.toBeNull();
    expect(user?.email).toBe("jane@example.com");
  });

  test("handleWebhookEvent is idempotent", async () => {
    const t = initConvexTest();
    const args = {
      webhookId: "webhook-002",
      type: "user.created",
      kindeId: "kp_test456",
      email: "john@example.com",
      isSuspended: false,
      organizations: [],
    };
    await t.mutation(api.lib.handleWebhookEvent, args);
    await t.mutation(api.lib.handleWebhookEvent, args);
    const users = await t.query(api.lib.listUsers, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(users.page.filter((u) => u.kindeId === "kp_test456")).toHaveLength(
      1,
    );
  });

  test("handleWebhookEvent deletes user on user.deleted", async () => {
    const t = initConvexTest();
    await t.mutation(api.lib.handleWebhookEvent, {
      webhookId: "webhook-003",
      type: "user.created",
      kindeId: "kp_delete_me",
      email: "delete@example.com",
      isSuspended: false,
      organizations: [],
    });
    await t.mutation(api.lib.handleWebhookEvent, {
      webhookId: "webhook-004",
      type: "user.deleted",
      kindeId: "kp_delete_me",
      email: "delete@example.com",
      isSuspended: false,
      organizations: [],
    });
    const user = await t.query(api.lib.getUser, { kindeId: "kp_delete_me" });
    expect(user).toBeNull();
  });

  test("cleanupProcessedWebhooks prunes rows older than the retention window", async () => {
    const t = initConvexTest();
    vi.setSystemTime(new Date("2026-01-01T00:00:00Z"));

    await t.mutation(api.lib.handleWebhookEvent, {
      webhookId: "retention-webhook",
      type: "user.created",
      kindeId: "kp_retention",
      email: "retention@example.com",
      isSuspended: false,
      organizations: [],
    });

    // Freshly processed rows are within the window and must be kept.
    const noop = await t.mutation(internal.lib.cleanupProcessedWebhooks, {});
    expect(noop.deleted).toBe(0);

    // 8 days later the dedup record is past the 7-day retention window.
    const eightDaysLater = new Date("2026-01-09T00:00:00Z").getTime();
    const pruned = await t.mutation(internal.lib.cleanupProcessedWebhooks, {
      now: eightDaysLater,
    });
    expect(pruned.deleted).toBe(1);
  });
});
