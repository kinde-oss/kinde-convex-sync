import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { initConvexTest } from "./setup.test";
import { api, components } from "./_generated/api";

describe("kinde-sync example", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  test("getUser returns null when user does not exist", async () => {
    const t = initConvexTest();
    const result = await t.query(api.example.getUser, {
      kindeId: "kp_nonexistent",
    });
    expect(result).toBeNull();
  });

  test("getUserByEmail returns null when user does not exist", async () => {
    const t = initConvexTest();
    const result = await t.query(api.example.getUserByEmail, {
      email: "test@example.com",
    });
    expect(result).toBeNull();
  });

  test("listUsers returns empty page when no users synced", async () => {
    const t = initConvexTest();
    const result = await t.query(api.example.listUsers, {});
    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  test("synced user is returned by getUser, getUserByEmail, and listUsers", async () => {
    const t = initConvexTest();

    // Seed a user through the component's webhook sync flow.
    await t.mutation(components.kindeSync.lib.handleWebhookEvent, {
      webhookId: "example-webhook-001",
      type: "user.created",
      kindeId: "kp_example123",
      email: "synced@example.com",
      firstName: "Synced",
      lastName: "User",
      isSuspended: false,
      organizations: [],
    });

    const byId = await t.query(api.example.getUser, {
      kindeId: "kp_example123",
    });
    expect(byId?.email).toBe("synced@example.com");
    expect(byId?.firstName).toBe("Synced");

    const byEmail = await t.query(api.example.getUserByEmail, {
      email: "synced@example.com",
    });
    expect(byEmail?.kindeId).toBe("kp_example123");

    const list = await t.query(api.example.listUsers, {});
    expect(list.page).toHaveLength(1);
    expect(list.page[0]?.kindeId).toBe("kp_example123");
  });
});
