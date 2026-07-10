import {query} from './_generated/server.js';
import {components} from './_generated/api.js';
import {paginationOptsValidator} from 'convex/server';
import {v} from 'convex/values';

// Mirrors the component's synced-user shape, for a self-documenting surface.
const userValidator = v.object({
  _id: v.string(),
  _creationTime: v.number(),
  kindeId: v.string(),
  // Optional to mirror the component: phone-only users have no email.
  email: v.optional(v.string()),
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
});

// Reactive query — get a Kinde user by their Kinde ID
export const getUser = query({
  args: {kindeId: v.string()},
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.kindeSync.lib.getUser, {
      kindeId: args.kindeId
    });
  }
});

// Reactive query — get a Kinde user by email
export const getUserByEmail = query({
  args: {email: v.string()},
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.kindeSync.lib.getUserByEmail, {
      email: args.email
    });
  }
});

// Reactive query — list synced Kinde users, one page at a time
export const listUsers = query({
  args: {paginationOpts: paginationOptsValidator},
  returns: v.object({
    page: v.array(userValidator),
    isDone: v.boolean(),
    continueCursor: v.string()
  }),
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.kindeSync.lib.listUsers, {
      paginationOpts: args.paginationOpts
    });
  }
});
