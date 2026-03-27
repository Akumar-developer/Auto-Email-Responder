/**
 * server.js
 *
 * Express app — the backbone of the Smart Email Responder.
 *
 * Routes:
 *   GET  /health           → Liveness check
 *   GET  /auth/callback    → OAuth2 callback (used during first-run setup)
 *   POST /watch/start      → Register Gmail push watch
 *   POST /watch/stop       → Deregister Gmail push watch
 *   POST /webhook/gmail    → Pub/Sub push endpoint (core pipeline trigger)
 */

"use strict";

require("dotenv").config();

const express = require("express");
const { startWatch, stopWatch } = require("./gmail/watch");
const { fetchNewMessages } = require("./gmail/reader");
const { generateReply } = require("./ai/generateReply");
const { createDraft } = require("./gmail/drafter");
const { isDuplicate, seenCount } = require("./utils/dedup");

const app = express();
app.use(express.json());

// ── Health check ──────────────────────────────────────────────────────────────
app.get("/health", (req, res) => {
  res.json({
    status: "ok",
    uptime: Math.floor(process.uptime()),
    seenMessages: seenCount(),
    timestamp: new Date().toISOString(),
  });
});

// ── OAuth2 Callback ───────────────────────────────────────────────────────────
// Only used during the initial `npm run auth` flow.
// The auth.js script spins up its own server — this route is a fallback
// in case you want the main server to handle it.
app.get("/auth/callback", (req, res) => {
  res.send(
    "Auth callback received. If you ran `npm run auth`, check your terminal for the refresh token."
  );
});

// ── Watch management ──────────────────────────────────────────────────────────
app.post("/watch/start", async (req, res) => {
  try {
    const result = await startWatch();
    res.json({ success: true, watch: result });
  } catch (err) {
    console.error("Failed to start watch:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

app.post("/watch/stop", async (req, res) => {
  try {
    await stopWatch();
    res.json({ success: true });
  } catch (err) {
    console.error("Failed to stop watch:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

// ── Core Pipeline: Gmail Pub/Sub Webhook ──────────────────────────────────────
/**
 * Google Pub/Sub sends a POST with this shape:
 * {
 *   message: {
 *     data: "<base64-encoded JSON>",   // { emailAddress, historyId }
 *     messageId: "...",
 *     publishTime: "..."
 *   },
 *   subscription: "projects/.../subscriptions/..."
 * }
 *
 * We must respond 200 quickly (< 10s) or Pub/Sub will retry.
 * Heavy work is done async after the ack.
 */
app.post("/webhook/gmail", (req, res) => {
  // Acknowledge immediately to prevent Pub/Sub retry
  res.sendStatus(200);

  // Process async — errors are caught and logged, never crash the server
  handleGmailNotification(req.body).catch((err) => {
    console.error("❌ Unhandled error in pipeline:", err);
  });
});

// ── Pipeline Orchestration ────────────────────────────────────────────────────
async function handleGmailNotification(body) {
  // 1. Decode the Pub/Sub message
  const pubsubMessage = body?.message;
  if (!pubsubMessage?.data) {
    console.warn("⚠️  Received webhook with no Pub/Sub data — skipping.");
    return;
  }

  let notification;
  try {
    const decoded = Buffer.from(pubsubMessage.data, "base64").toString("utf8");
    notification = JSON.parse(decoded);
  } catch (err) {
    console.error("Failed to decode Pub/Sub message:", err.message);
    return;
  }

  const { emailAddress, historyId } = notification;
  console.log(`📬 Notification received [historyId=${historyId}] for ${emailAddress}`);

  // 2. Fetch new messages from the Gmail history delta
  let emails;
  try {
    emails = await fetchNewMessages(historyId);
  } catch (err) {
    console.error("Failed to fetch new messages:", err.message);
    return;
  }

  if (emails.length === 0) {
    console.log("ℹ️  No new actionable messages.");
    return;
  }

  console.log(`📧 Processing ${emails.length} new message(s)…`);

  // 3. Process each email through the AI → Draft pipeline
  for (const email of emails) {
    await processEmail(email);
  }
}

async function processEmail(email) {
  // Dedup guard — skip if we've already processed this message
  if (isDuplicate(email.id)) {
    console.log(`⏭️  Skipping duplicate message [id=${email.id}]`);
    return;
  }

  console.log(`\n─────────────────────────────────────────`);
  console.log(`📨 From:    ${email.from}`);
  console.log(`📋 Subject: ${email.subject}`);
  console.log(`💬 Snippet: ${email.snippet}`);

  try {
    // 4. Generate AI reply
    console.log("🤖 Generating AI reply…");
    const replyBody = await generateReply(email);
    console.log(`✅ Reply generated (${replyBody.length} chars)`);

    // 5. Save as Gmail Draft
    const draftId = await createDraft(email, replyBody);
    console.log(`📝 Draft saved [draftId=${draftId}]`);
    console.log(`─────────────────────────────────────────\n`);
  } catch (err) {
    console.error(`❌ Failed to process message [id=${email.id}]:`, err.message);
  }
}

// ── Start Server ──────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`\n🚀 Smart Email Responder running on port ${PORT}`);
  console.log(`   Health:      http://localhost:${PORT}/health`);
  console.log(`   Webhook:     POST http://localhost:${PORT}/webhook/gmail`);
  console.log(`   Watch start: POST http://localhost:${PORT}/watch/start`);
  console.log(`\n   Waiting for Gmail notifications…\n`);
});

module.exports = app;