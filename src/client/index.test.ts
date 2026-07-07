import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { KindeSync } from "./index.js";
import { components } from "./setup.test.js";
import { createRemoteJWKSet, jwtVerify } from "jose";

// Mock jose so we can drive JWT verification outcomes without real keys.
vi.mock("jose", () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn(),
}));

const mockJwtVerify = vi.mocked(jwtVerify);
const mockCreateRemoteJWKSet = vi.mocked(createRemoteJWKSet);

// The webhook handler's underlying function, invoked directly with a mock ctx
// so we can assert on the mutation it dispatches (mirrors how convex-test's
// `fetch` calls the handler with an injected ctx).
type MockCtx = { runMutation: ReturnType<typeof vi.fn> };
type WebhookHandler = (ctx: MockCtx, request: Request) => Promise<Response>;

function getHandler(client: KindeSync): WebhookHandler {
  return (client.webhookHandler as unknown as { _handler: WebhookHandler })
    ._handler;
}

function makeClient() {
  return new KindeSync(components.kindeSync, {
    KINDE_ISSUER_URL: "https://example.kinde.com",
  });
}

function postRequest(body: string) {
  return new Request("https://deploy.convex.site/webhooks/kinde", {
    method: "POST",
    body,
  });
}

describe("KindeSync client", () => {
  beforeEach(() => {
    mockCreateRemoteJWKSet.mockClear();
  });

  test("instantiates with a valid domain and creates the JWKS client once", () => {
    const client = makeClient();
    expect(client).toBeDefined();
    expect(client.component).toBeDefined();
    expect(client.webhookHandler).toBeDefined();
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
  });

  test.each([
    ["undefined", undefined],
    ["empty", ""],
  ])("throws a typed error when the domain is %s", (_label, domain) => {
    expect(
      () =>
        new KindeSync(components.kindeSync, {
          KINDE_ISSUER_URL: domain as unknown as string,
        }),
    ).toThrow(
      "KindeSync: KINDE_ISSUER_URL is required to construct the client",
    );
    expect(mockCreateRemoteJWKSet).not.toHaveBeenCalled();
  });
});

describe("KindeSync webhookHandler", () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test("returns 400 when the token body is missing", async () => {
    const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
    const res = await getHandler(makeClient())(ctx, postRequest(""));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing token" });
    expect(mockJwtVerify).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test("returns 401 when JWT verification fails", async () => {
    mockJwtVerify.mockRejectedValue(new Error("bad signature"));
    const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
    const res = await getHandler(makeClient())(
      ctx,
      postRequest("some.jwt.token"),
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({ error: "Invalid token" });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test("verifies the token against the issuer domain", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        type: "user.created",
        data: { user: { id: "kp_1", email: "a@example.com" } },
      },
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
    await getHandler(makeClient())(ctx, postRequest("some.jwt.token"));
    expect(mockJwtVerify).toHaveBeenCalledWith(
      "some.jwt.token",
      expect.anything(),
      { issuer: "https://example.kinde.com" },
    );
  });

  test("returns 400 for a malformed payload (missing type/user)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: { jti: "evt_1" },
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
    const res = await getHandler(makeClient())(
      ctx,
      postRequest("some.jwt.token"),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Invalid payload" });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test("returns 400 when the user id is missing (no blank-keyed write)", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        type: "user.created",
        data: { user: { first_name: "NoKeys" } },
      },
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
    const res = await getHandler(makeClient())(
      ctx,
      postRequest("some.jwt.token"),
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({ error: "Missing user id" });
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test.each(["user.created", "user.updated"])(
    "returns 400 when %s has no email (no blank-keyed write)",
    async (type) => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          type,
          data: { user: { id: "kp_no_email" } },
        },
      } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
      const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
      const res = await getHandler(makeClient())(
        ctx,
        postRequest("some.jwt.token"),
      );
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: "Missing user email" });
      expect(ctx.runMutation).not.toHaveBeenCalled();
    },
  );

  test("deletes a user identified by id alone, with no email", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        jti: "evt_delete",
        type: "user.deleted",
        data: { user: { id: "kp_delete_me" } },
      },
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
    const res = await getHandler(makeClient())(
      ctx,
      postRequest("some.jwt.token"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [, args] = ctx.runMutation.mock.calls[0];
    expect(args).toMatchObject({
      webhookId: "evt_delete",
      type: "user.deleted",
      kindeId: "kp_delete_me",
      email: "",
    });
  });

  test("upserts the user on a valid webhook and returns 200", async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        jti: "evt_success",
        type: "user.created",
        data: {
          user: {
            id: "kp_success",
            email: "jane@example.com",
            first_name: "Jane",
            last_name: "Doe",
            is_suspended: false,
            organizations: [{ code: "org_1", roles: "admin" }],
          },
        },
      },
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = { runMutation: vi.fn().mockResolvedValue(null) };
    const res = await getHandler(makeClient())(
      ctx,
      postRequest("some.jwt.token"),
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ success: true });
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [, args] = ctx.runMutation.mock.calls[0];
    expect(args).toMatchObject({
      webhookId: "evt_success",
      type: "user.created",
      kindeId: "kp_success",
      email: "jane@example.com",
      firstName: "Jane",
      lastName: "Doe",
      isSuspended: false,
      organizations: [{ code: "org_1", roles: "admin" }],
    });
  });
});
