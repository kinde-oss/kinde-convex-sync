import {v, type Infer} from 'convex/values';
import {paginationOptsValidator} from 'convex/server';
import {paginator} from 'convex-helpers/server/pagination';
import {
  internalMutation,
  internalQuery,
  mutation,
  query,
  type MutationCtx,
  type QueryCtx
} from './_generated/server.js';
import type {Id} from './_generated/dataModel.js';
import schema from './schema.js';

const orgValidator = v.object({
  code: v.string(),
  roles: v.optional(v.string()),
  permissions: v.optional(v.string())
});

const userValidator = v.object({
  _id: v.id('kindeUsers'),
  _creationTime: v.number(),
  kindeId: v.string(),
  // Optional: phone-only Kinde users have no email.
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  isSuspended: v.boolean(),
  organizations: v.array(orgValidator),
  lastSyncedAt: v.number()
});

// ─── Shared helpers ──────────────────────────────────────────────────────────
//
// Plain async functions holding the single source of truth for each unit of
// work. `handleWebhookEvent` calls them directly on the hot path (no
// runQuery/runMutation overhead, no isolated JS context), and the
// internalQuery/internalMutation exports below are thin wrappers around the
// same helpers so external and cron callers keep working.

const upsertUserArgs = {
  kindeId: v.string(),
  email: v.optional(v.string()),
  phone: v.optional(v.string()),
  firstName: v.optional(v.string()),
  lastName: v.optional(v.string()),
  imageUrl: v.optional(v.string()),
  isSuspended: v.boolean(),
  organizations: v.array(orgValidator)
};
type UpsertUserArgs = Infer<ReturnType<typeof v.object<typeof upsertUserArgs>>>;

async function isWebhookProcessedHelper(
  ctx: QueryCtx,
  webhookId: string
): Promise<boolean> {
  const existing = await ctx.db
    .query('processedWebhooks')
    .withIndex('by_webhookId', (q) => q.eq('webhookId', webhookId))
    .first();
  return existing !== null;
}

async function markWebhookProcessedHelper(
  ctx: MutationCtx,
  webhookId: string
): Promise<void> {
  await ctx.db.insert('processedWebhooks', {
    webhookId,
    processedAt: Date.now()
  });
}

async function upsertUserHelper(
  ctx: MutationCtx,
  args: UpsertUserArgs
): Promise<Id<'kindeUsers'>> {
  const existing = await ctx.db
    .query('kindeUsers')
    .withIndex('by_kindeId', (q) => q.eq('kindeId', args.kindeId))
    .first();
  if (existing) {
    await ctx.db.patch('kindeUsers', existing._id, {
      email: args.email,
      phone: args.phone,
      firstName: args.firstName,
      lastName: args.lastName,
      imageUrl: args.imageUrl,
      isSuspended: args.isSuspended,
      organizations: args.organizations,
      lastSyncedAt: Date.now()
    });
    return existing._id;
  }
  return await ctx.db.insert('kindeUsers', {
    kindeId: args.kindeId,
    email: args.email,
    phone: args.phone,
    firstName: args.firstName,
    lastName: args.lastName,
    imageUrl: args.imageUrl,
    isSuspended: args.isSuspended,
    organizations: args.organizations,
    lastSyncedAt: Date.now()
  });
}

async function deleteUserHelper(
  ctx: MutationCtx,
  kindeId: string
): Promise<void> {
  const existing = await ctx.db
    .query('kindeUsers')
    .withIndex('by_kindeId', (q) => q.eq('kindeId', kindeId))
    .first();
  if (existing) await ctx.db.delete('kindeUsers', existing._id);
}

// ─── Internal wrappers (thin) ────────────────────────────────────────────────

export const isWebhookProcessed = internalQuery({
  args: {webhookId: v.string()},
  returns: v.boolean(),
  handler: (ctx, args) => isWebhookProcessedHelper(ctx, args.webhookId)
});

export const markWebhookProcessed = internalMutation({
  args: {webhookId: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    await markWebhookProcessedHelper(ctx, args.webhookId);
    return null;
  }
});

export const upsertUser = internalMutation({
  args: upsertUserArgs,
  returns: v.id('kindeUsers'),
  handler: (ctx, args) => upsertUserHelper(ctx, args)
});

export const deleteUser = internalMutation({
  args: {kindeId: v.string()},
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteUserHelper(ctx, args.kindeId);
    return null;
  }
});

export const handleWebhookEvent = mutation({
  args: {
    webhookId: v.string(),
    type: v.string(),
    kindeId: v.string(),
    email: v.optional(v.string()),
    phone: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isSuspended: v.boolean(),
    organizations: v.array(orgValidator)
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // Deduplicate by webhook ID so retried deliveries are no-ops. The helpers
    // run inline in this single mutation transaction, which already guarantees
    // atomicity.
    if (await isWebhookProcessedHelper(ctx, args.webhookId)) return null;
    await markWebhookProcessedHelper(ctx, args.webhookId);

    if (args.type === 'user.deleted') {
      await deleteUserHelper(ctx, args.kindeId);
      return null;
    }

    await upsertUserHelper(ctx, {
      kindeId: args.kindeId,
      email: args.email,
      phone: args.phone,
      firstName: args.firstName,
      lastName: args.lastName,
      imageUrl: args.imageUrl,
      isSuspended: args.isSuspended,
      organizations: args.organizations
    });
    return null;
  }
});

export const getUser = query({
  args: {kindeId: v.string()},
  returns: v.union(v.null(), userValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('kindeUsers')
      .withIndex('by_kindeId', (q) => q.eq('kindeId', args.kindeId))
      .first();
  }
});

export const getUserByEmail = query({
  args: {email: v.string()},
  returns: v.union(v.null(), userValidator),
  handler: async (ctx, args) => {
    return await ctx.db
      .query('kindeUsers')
      .withIndex('by_email', (q) => q.eq('email', args.email))
      .first();
  }
});

export const getUserByPhone = query({
  args: {phone: v.string()},
  returns: v.union(v.null(), userValidator),
  handler: async (ctx, args) => {
    // Matched verbatim against the stored value: the webhook path stores
    // `data.user.phone` exactly as Kinde sends it (only ""/null collapse to an
    // absent field), so no trimming or E.164 normalization happens on write and
    // none may happen here either.
    return await ctx.db
      .query('kindeUsers')
      .withIndex('by_phone', (q) => q.eq('phone', args.phone))
      .first();
  }
});

export const listUsers = query({
  args: {paginationOpts: paginationOptsValidator},
  returns: v.object({
    page: v.array(userValidator),
    isDone: v.boolean(),
    continueCursor: v.string()
  }),
  handler: async (ctx, args) => {
    // Convex's built-in `ctx.db.query(...).paginate()` is only supported inside
    // the app, not inside a component (it throws at runtime here). Use the
    // convex-helpers `paginator`, which reimplements cursor pagination on top of
    // index scans and works in a component context — matching the pattern
    // kinde-convex-agent-auth uses in its audit.ts.
    const result = await paginator(ctx.db, schema)
      .query('kindeUsers')
      .order('desc')
      .paginate(args.paginationOpts);
    return {
      page: result.page,
      isDone: result.isDone,
      continueCursor: result.continueCursor
    };
  }
});

// ─── Retention cleanup ───────────────────────────────────────────────────────
//
// The processedWebhooks table only exists to deduplicate retried deliveries, so
// rows are safe to discard once Kinde can no longer retry an event. Kinde
// retries a failed webhook delivery for up to ~24 hours; we keep dedup records
// for 7 days to comfortably cover that window (plus clock skew) before
// reclaiming the space. A cron (see crons.ts) invokes this on a schedule.
const WEBHOOK_DEDUP_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;

// Bound the work per invocation so a large backlog never exceeds a single
// transaction's read/write limits; the cron reruns until the backlog drains.
const CLEANUP_BATCH_SIZE = 500;

export const cleanupProcessedWebhooks = internalMutation({
  args: {now: v.optional(v.number())},
  returns: v.object({deleted: v.number()}),
  handler: async (ctx, args) => {
    const cutoff = (args.now ?? Date.now()) - WEBHOOK_DEDUP_RETENTION_MS;
    const stale = await ctx.db
      .query('processedWebhooks')
      .withIndex('by_processedAt', (q) => q.lt('processedAt', cutoff))
      .take(CLEANUP_BATCH_SIZE);
    for (const row of stale) {
      await ctx.db.delete('processedWebhooks', row._id);
    }
    return {deleted: stale.length};
  }
});
