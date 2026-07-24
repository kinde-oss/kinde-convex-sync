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

  test("getUserByPhone returns null when user does not exist", async () => {
    const t = initConvexTest();
    const result = await t.query(api.example.getUserByPhone, {
      phone: "+15551234567",
    });
    expect(result).toBeNull();
  });

  test("listUsers returns empty page when no users synced", async () => {
    const t = initConvexTest();
    const result = await t.query(api.example.listUsers, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(result.page).toHaveLength(0);
    expect(result.isDone).toBe(true);
  });

  test("synced user is returned by getUser, getUserByEmail, getUserByPhone, and listUsers", async () => {
    const t = initConvexTest();

    // Seed a user through the component's webhook sync flow.
    await t.mutation(components.kindeSync.lib.handleWebhookEvent, {
      webhookId: "example-webhook-001",
      type: "user.created",
      kindeId: "kp_example123",
      email: "synced@example.com",
      phone: "+15551234567",
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

    const byPhone = await t.query(api.example.getUserByPhone, {
      phone: "+15551234567",
    });
    expect(byPhone?.kindeId).toBe("kp_example123");

    const list = await t.query(api.example.listUsers, {
      paginationOpts: { numItems: 100, cursor: null },
    });
    expect(list.page).toHaveLength(1);
    expect(list.page[0]?.kindeId).toBe("kp_example123");
  });

  test("phone-only user is synced and stays queryable by phone", async () => {
    const t = initConvexTest();

    // Seed through the same webhook flow as the fixture above, but with no
    // email field at all — the phone-only Kinde user the component is built to
    // tolerate. The real webhook path reaches the mutation the same way: it
    // normalizes Kinde's "" / null email to `undefined` before forwarding
    // (src/client/index.ts).
    await t.mutation(components.kindeSync.lib.handleWebhookEvent, {
      webhookId: "example-webhook-002",
      type: "user.created",
      kindeId: "kp_phoneonly456",
      phone: "+15559876543",
      firstName: "Phone",
      lastName: "Only",
      isSuspended: false,
      organizations: [],
    });

    const byPhone = await t.query(api.example.getUserByPhone, {
      phone: "+15559876543",
    });
    if (byPhone === null) {
      throw new Error("expected the phone-only user to be found by phone");
    }
    expect(byPhone.kindeId).toBe("kp_phoneonly456");
    expect(byPhone.phone).toBe("+15559876543");

    // An absent email is stored as a missing key, not an explicit `undefined`
    // — Convex drops undefined fields on write — so the round-tripped document
    // has no `email` property at all.
    expect(byPhone.email).toBeUndefined();
    expect(Object.keys(byPhone)).not.toContain("email");
  });
});
