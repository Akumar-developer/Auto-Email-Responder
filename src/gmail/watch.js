/**
 * gmail/watch.js
 *
 * Manages the Gmail push-notification subscription via Google Cloud Pub/Sub.
 *
 * Gmail Watch API docs:
 *   https://developers.google.com/gmail/api/reference/rest/v1/users/watch
 *
 * Key constraints:
 *   - A watch expires after ~7 days; call renewWatch() on a cron or at startup.
 *   - Only one active watch per mailbox; calling watch() again replaces it.
 */

"use strict";

require("dotenv").config();
const { google } = require("googleapis");
const { createOAuth2Client } = require("./auth");

/**
 * Register (or renew) a Gmail push watch.
 * Gmail will POST a Pub/Sub message to your topic whenever the inbox changes.
 *
 * @returns {Promise<{historyId: string, expiration: string}>}
 */
async function startWatch() {
  const auth = createOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const res = await gmail.users.watch({
    userId: "me",
    requestBody: {
      topicName: process.env.PUBSUB_TOPIC,
      labelIds: ["INBOX"], // only watch INBOX, ignore Sent/Drafts/Spam
      labelFilterBehavior: "INCLUDE",
    },
  });

  console.log("✅ Gmail watch registered:", res.data);
  return res.data; // { historyId, expiration }
}

/**
 * Stop the active Gmail push watch.
 * Useful during teardown / re-registration.
 */
async function stopWatch() {
  const auth = createOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  await gmail.users.stop({ userId: "me" });
  console.log("🛑 Gmail watch stopped.");
}

module.exports = { startWatch, stopWatch };