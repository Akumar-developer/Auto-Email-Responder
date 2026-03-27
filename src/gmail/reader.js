/**
 * gmail/reader.js
 *
 * Fetches new messages from Gmail using the history API
 * (delta from a known historyId), then parses each message into a
 * structured object ready for the AI layer.
 *
 * Flow:
 *   historyId (from Pub/Sub) → history.list() → messageIds → messages.get()
 *   → parse headers + body → return structured email objects
 */

"use strict";

const { google } = require("googleapis");
const { createOAuth2Client } = require("./auth");

/**
 * Fetch all new INBOX messages added since `startHistoryId`.
 *
 * @param {string} startHistoryId  - historyId from the Pub/Sub notification
 * @returns {Promise<ParsedEmail[]>}
 */
async function fetchNewMessages(startHistoryId) {
  const auth = createOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  // Get the history delta
  const historyRes = await gmail.users.history.list({
    userId: "me",
    startHistoryId,
    historyTypes: ["messageAdded"],
    labelId: "INBOX",
  });

  const history = historyRes.data.history ?? [];
  if (history.length === 0) return [];

  // Collect unique messageIds from the delta
  const messageIds = new Set();
  for (const record of history) {
    for (const added of record.messagesAdded ?? []) {
      messageIds.add(added.message.id);
    }
  }

  // Fetch & parse each message (in parallel, capped via Promise.all)
  const parsed = await Promise.all(
    [...messageIds].map((id) => fetchAndParseMessage(gmail, id))
  );

  // Filter nulls (e.g. messages that failed to parse or are self-sent drafts)
  return parsed.filter(Boolean);
}

/**
 * Fetch a single message and return a structured ParsedEmail.
 *
 * @param {object} gmail   - authenticated Gmail client
 * @param {string} id      - Gmail message ID
 * @returns {Promise<ParsedEmail|null>}
 */
async function fetchAndParseMessage(gmail, id) {
  try {
    const res = await gmail.users.messages.get({
      userId: "me",
      id,
      format: "full",
    });

    const msg = res.data;
    const headers = Object.fromEntries(
      (msg.payload.headers ?? []).map((h) => [h.name.toLowerCase(), h.value])
    );

    // Skip messages sent by the authenticated user (avoid self-reply loops)
    const fromHeader = headers["from"] ?? "";
    const userEmail = process.env.GMAIL_USER.toLowerCase();
    if (fromHeader.toLowerCase().includes(userEmail)) return null;

    const body = extractPlainTextBody(msg.payload);
    if (!body.trim()) return null;

    return {
      id: msg.id,
      threadId: msg.threadId,
      from: fromHeader,
      to: headers["to"] ?? "",
      subject: headers["subject"] ?? "(no subject)",
      messageId: headers["message-id"] ?? "",   // for In-Reply-To threading
      references: headers["references"] ?? "",
      body: cleanBody(body),
      snippet: msg.snippet ?? "",
    };
  } catch (err) {
    console.error(`Failed to fetch message ${id}:`, err.message);
    return null;
  }
}

/**
 * Recursively walk the MIME tree and return the first text/plain part.
 *
 * @param {object} payload - Gmail message payload
 * @returns {string}
 */
function extractPlainTextBody(payload) {
  if (payload.mimeType === "text/plain" && payload.body?.data) {
    return Buffer.from(payload.body.data, "base64url").toString("utf8");
  }

  for (const part of payload.parts ?? []) {
    const result = extractPlainTextBody(part);
    if (result) return result;
  }

  return "";
}

/**
 * Strip quoted reply chains and excessive whitespace.
 * Keeps only the "new" content at the top of the email.
 *
 * @param {string} text
 * @returns {string}
 */
function cleanBody(text) {
  return text
    .split("\n")
    // Drop lines that are quoted replies (lines starting with >)
    .filter((line) => !line.trimStart().startsWith(">"))
    // Drop the common "On <date>, <name> wrote:" divider
    .filter((line) => !/^On .+wrote:$/i.test(line.trim()))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n") // collapse blank lines
    .trim();
}

module.exports = { fetchNewMessages };

/**
 * @typedef {Object} ParsedEmail
 * @property {string} id          - Gmail message ID
 * @property {string} threadId    - Gmail thread ID
 * @property {string} from        - Sender header
 * @property {string} to          - Recipient header
 * @property {string} subject     - Subject header
 * @property {string} messageId   - RFC Message-ID (for threading)
 * @property {string} references  - RFC References header
 * @property {string} body        - Cleaned plain-text body
 * @property {string} snippet     - Gmail snippet (fallback preview)
 */