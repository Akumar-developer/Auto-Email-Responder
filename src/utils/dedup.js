/**
 * utils/dedup.js
 *
 * Prevents the same Gmail message from being processed twice.
 *
 * Why this is necessary:
 *   Google Pub/Sub has at-least-once delivery semantics — the same
 *   notification can be delivered multiple times, especially during
 *   network hiccups or restarts. Without dedup, we'd create duplicate drafts.
 *
 * Implementation:
 *   In-memory Set with a TTL-based eviction (24h).
 *   For production, replace with Redis SETNX for persistence across restarts.
 */

"use strict";

const TTL_MS = 24 * 60 * 60 * 1000; // 24 hours

// { messageId → timestamp }
const seen = new Map();

/**
 * Returns true if this message has already been processed.
 * Registers the message if it hasn't been seen.
 *
 * @param {string} messageId - Gmail message ID
 * @returns {boolean}
 */
function isDuplicate(messageId) {
  evictExpired();

  if (seen.has(messageId)) return true;

  seen.set(messageId, Date.now());
  return false;
}

/**
 * Evict entries older than TTL_MS to prevent unbounded memory growth.
 */
function evictExpired() {
  const cutoff = Date.now() - TTL_MS;
  for (const [id, ts] of seen.entries()) {
    if (ts < cutoff) seen.delete(id);
  }
}

/**
 * How many message IDs are currently tracked.
 * Useful for health check endpoints.
 */
function seenCount() {
  evictExpired();
  return seen.size;
}

module.exports = { isDuplicate, seenCount };