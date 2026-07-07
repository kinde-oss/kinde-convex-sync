import { query } from "./_generated/server.js";
import { components } from "./_generated/api.js";
import { v } from "convex/values";

// Reactive query — get a Kinde user by their Kinde ID
export const getUser = query({
  args: { kindeId: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.kindeSync.lib.getUser, {
      kindeId: args.kindeId,
    });
  },
});

// Reactive query — get a Kinde user by email
export const getUserByEmail = query({
  args: { email: v.string() },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.kindeSync.lib.getUserByEmail, {
      email: args.email,
    });
  },
});

// Reactive query — list synced Kinde users, one page at a time
export const listUsers = query({
  args: {
    limit: v.optional(v.number()),
    cursor: v.optional(v.union(v.string(), v.null())),
  },
  handler: async (ctx, args) => {
    return await ctx.runQuery(components.kindeSync.lib.listUsers, {
      limit: args.limit,
      cursor: args.cursor,
    });
  },
});
