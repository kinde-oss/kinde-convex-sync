import {defineSchema, defineTable} from 'convex/server';
import {v} from 'convex/values';

export default defineSchema({
  kindeUsers: defineTable({
    kindeId: v.string(),
    // Email is optional: phone-only Kinde users legitimately arrive with no
    // email (Kinde sends "" or null), so we never key a user on email alone.
    email: v.optional(v.string()),
    // Phone is optional and may be absent for email-only users, so by_phone is
    // effectively a sparse index — documents without a phone are simply not
    // indexed under a real value.
    phone: v.optional(v.string()),
    firstName: v.optional(v.string()),
    lastName: v.optional(v.string()),
    imageUrl: v.optional(v.string()),
    isSuspended: v.boolean(),
    organizations: v.array(
      v.object({
        code: v.string(),
        roles: v.optional(v.string()),
        permissions: v.optional(v.string())
      })
    ),
    lastSyncedAt: v.number()
  })
    .index('by_kindeId', ['kindeId'])
    .index('by_email', ['email'])
    .index('by_phone', ['phone']),

  processedWebhooks: defineTable({
    webhookId: v.string(),
    processedAt: v.number()
  })
    .index('by_webhookId', ['webhookId'])
    // Supports the retention cron that prunes rows older than the dedup window.
    .index('by_processedAt', ['processedAt'])
});
