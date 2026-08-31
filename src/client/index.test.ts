import {afterEach, beforeEach, describe, expect, test, vi} from 'vitest';
import {KindeSync} from './index.js';
import {components} from './setup.test.js';
import {createRemoteJWKSet, jwtVerify} from 'jose';

// Mock jose so we can drive JWT verification outcomes without real keys.
vi.mock('jose', () => ({
  createRemoteJWKSet: vi.fn(() => vi.fn()),
  jwtVerify: vi.fn()
}));

const mockJwtVerify = vi.mocked(jwtVerify);
const mockCreateRemoteJWKSet = vi.mocked(createRemoteJWKSet);

// The webhook handler's underlying function, invoked directly with a mock ctx
// so we can assert on the mutation it dispatches (mirrors how convex-test's
// `fetch` calls the handler with an injected ctx).
type MockCtx = {runMutation: ReturnType<typeof vi.fn>};
type WebhookHandler = (ctx: MockCtx, request: Request) => Promise<Response>;

function getHandler(client: KindeSync): WebhookHandler {
  return (client.webhookHandler as unknown as {_handler: WebhookHandler})
    ._handler;
}

function makeClient() {
  return new KindeSync(components.kindeSync, {
    KINDE_ISSUER_URL: 'https://example.kinde.com'
  });
}

function postRequest(body: string) {
  return new Request('https://deploy.convex.site/webhooks/kinde', {
    method: 'POST',
    body
  });
}

describe('KindeSync client', () => {
  beforeEach(() => {
    mockCreateRemoteJWKSet.mockClear();
  });

  test('instantiates with a valid domain and creates the JWKS client once', () => {
    const client = makeClient();
    expect(client).toBeDefined();
    expect(client.component).toBeDefined();
    expect(client.webhookHandler).toBeDefined();
    expect(mockCreateRemoteJWKSet).toHaveBeenCalledTimes(1);
  });

  test.each([
    ['undefined', undefined],
    ['empty', '']
  ])('throws a typed error when the domain is %s', (_label, domain) => {
    expect(
      () =>
        new KindeSync(components.kindeSync, {
          KINDE_ISSUER_URL: domain as unknown as string
        })
    ).toThrow(
      'KindeSync: KINDE_ISSUER_URL is required to construct the client'
    );
    expect(mockCreateRemoteJWKSet).not.toHaveBeenCalled();
  });
});

describe('KindeSync webhookHandler', () => {
  beforeEach(() => {
    mockJwtVerify.mockReset();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  test('returns 400 when the token body is missing', async () => {
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(ctx, postRequest(''));
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({error: 'Missing token'});
    expect(mockJwtVerify).not.toHaveBeenCalled();
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test('returns 401 when JWT verification fails', async () => {
    mockJwtVerify.mockRejectedValue(new Error('bad signature'));
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('some.jwt.token')
    );
    expect(res.status).toBe(401);
    expect(await res.json()).toEqual({error: 'Invalid token'});
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test('verifies against the JWKS only, with no issuer assertion', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        jti: 'evt_iss',
        type: 'user.created',
        data: {user: {id: 'kp_1', email: 'a@example.com'}}
      }
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    await getHandler(makeClient())(ctx, postRequest('some.jwt.token'));
    // Kinde webhook JWTs carry no `iss` claim, so we must call jwtVerify with
    // (token, JWKS) and NO issuer option — asserting an issuer would reject
    // every real webhook with "missing required iss claim".
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'some.jwt.token',
      expect.anything()
    );
    expect(mockJwtVerify).toHaveBeenCalledTimes(1);
    expect(mockJwtVerify.mock.calls[0]).toHaveLength(2);
  });

  test('returns 400 for a malformed payload (missing type/user)', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {jti: 'evt_1'}
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('some.jwt.token')
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({error: 'Invalid payload'});
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test('returns 400 when the user id is missing (no blank-keyed write)', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        jti: 'evt_no_id',
        type: 'user.created',
        data: {user: {first_name: 'NoKeys'}}
      }
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('some.jwt.token')
    );
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({error: 'Missing user id'});
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });

  test.each(['user.created', 'user.updated'])(
    'syncs %s for a phone-only user with no email (email is optional)',
    async (type) => {
      mockJwtVerify.mockResolvedValue({
        payload: {
          jti: 'evt_no_email',
          type,
          data: {user: {id: 'kp_no_email', phone: '+15551234567'}}
        }
      } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
      const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
      const res = await getHandler(makeClient())(
        ctx,
        postRequest('some.jwt.token')
      );
      // Phone-only Kinde users are valid: a create/update with no email must
      // succeed and dispatch the mutation (email absent, phone stored).
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({success: true});
      expect(ctx.runMutation).toHaveBeenCalledTimes(1);
      const [, args] = ctx.runMutation.mock.calls[0];
      expect(args).toMatchObject({
        webhookId: 'evt_no_email',
        type,
        kindeId: 'kp_no_email',
        phone: '+15551234567'
      });
      expect(args.email).toBeUndefined();
    }
  );

  test('deletes a user identified by id alone, with no email', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        jti: 'evt_delete',
        type: 'user.deleted',
        data: {user: {id: 'kp_delete_me'}}
      }
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('some.jwt.token')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({success: true});
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [, args] = ctx.runMutation.mock.calls[0];
    expect(args).toMatchObject({
      webhookId: 'evt_delete',
      type: 'user.deleted',
      kindeId: 'kp_delete_me'
    });
    // A user with no email is stored as absent, never as a blank string.
    expect(args.email).toBeUndefined();
  });

  test('upserts the user on a valid webhook and returns 200', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        jti: 'evt_success',
        type: 'user.created',
        data: {
          user: {
            id: 'kp_success',
            email: 'jane@example.com',
            first_name: 'Jane',
            last_name: 'Doe',
            is_suspended: false,
            organizations: [{code: 'org_1', roles: 'admin'}]
          }
        }
      }
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('some.jwt.token')
    );

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({success: true});
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [, args] = ctx.runMutation.mock.calls[0];
    expect(args).toMatchObject({
      webhookId: 'evt_success',
      type: 'user.created',
      kindeId: 'kp_success',
      email: 'jane@example.com',
      firstName: 'Jane',
      lastName: 'Doe',
      isSuspended: false,
      organizations: [{code: 'org_1', roles: 'admin'}]
    });
  });

  test('syncs a real Kinde webhook payload: no iss claim, event_id, empty email, phone', async () => {
    // Mirrors a real Kinde user.updated webhook JWT: it carries NO `iss` claim,
    // identifies itself with `event_id`, and — for a phone-only user — sends
    // email as an empty string alongside a phone at data.user.phone.
    mockJwtVerify.mockResolvedValue({
      payload: {
        type: 'user.updated',
        event_id: 'event_01HXYZREALKINDEID',
        data: {
          user: {
            id: 'kp_c3f7ce9realuser',
            email: '',
            phone: '+442071838750',
            first_name: 'Phone',
            last_name: 'Only',
            is_suspended: false,
            organizations: [{code: 'org_realtenant'}]
          }
        }
      }
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('real.kinde.jwt')
    );

    // Verified against the JWKS with no issuer option (real payloads lack iss).
    expect(mockJwtVerify).toHaveBeenCalledWith(
      'real.kinde.jwt',
      expect.anything()
    );
    expect(mockJwtVerify.mock.calls[0]).toHaveLength(2);

    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({success: true});
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [, args] = ctx.runMutation.mock.calls[0];
    expect(args).toMatchObject({
      webhookId: 'event_01HXYZREALKINDEID',
      type: 'user.updated',
      kindeId: 'kp_c3f7ce9realuser',
      phone: '+442071838750',
      firstName: 'Phone',
      lastName: 'Only',
      organizations: [{code: 'org_realtenant'}]
    });
    // An empty-string email is normalized to absent, not written as "".
    expect(args.email).toBeUndefined();
  });

  test('falls back to event_id as webhookId when jti is absent', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        event_id: 987654,
        type: 'user.created',
        data: {user: {id: 'kp_evt', email: 'evt@example.com'}}
      }
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('some.jwt.token')
    );

    expect(res.status).toBe(200);
    expect(ctx.runMutation).toHaveBeenCalledTimes(1);
    const [, args] = ctx.runMutation.mock.calls[0];
    expect(args).toMatchObject({webhookId: '987654', kindeId: 'kp_evt'});
  });

  test('returns 400 and does not process when both jti and event_id are absent', async () => {
    mockJwtVerify.mockResolvedValue({
      payload: {
        type: 'user.created',
        data: {user: {id: 'kp_now', email: 'now@example.com'}}
      }
    } as unknown as Awaited<ReturnType<typeof jwtVerify>>);
    const ctx: MockCtx = {runMutation: vi.fn().mockResolvedValue(null)};
    const res = await getHandler(makeClient())(
      ctx,
      postRequest('some.jwt.token')
    );

    // An event with no dedup identifier must not be processed — otherwise every
    // retry would look new and defeat idempotency.
    expect(res.status).toBe(400);
    expect(await res.json()).toEqual({error: 'Missing webhook identifier'});
    expect(ctx.runMutation).not.toHaveBeenCalled();
  });
});
