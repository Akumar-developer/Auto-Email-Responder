/**
 * gmail/drafter.js
 *
 * Takes a ParsedEmail + an AI-generated reply body and creates a Gmail Draft
 * in the correct thread with proper RFC 2822 headers for clean threading.
 *
 * The draft will appear in Gmail's "Drafts" folder.
 * The human opens it, reviews, optionally edits, and hits Send.
 */

"use strict";

const { google } = require("googleapis");
const { createOAuth2Client } = require("./auth");

/**
 * Create a Gmail Draft as a reply to the given email.
 *
 * @param {import("./reader").ParsedEmail} email  - The original parsed email
 * @param {string} replyBody                      - AI-generated reply text
 * @returns {Promise<string>}                     - The new draft ID
 */
async function createDraft(email, replyBody) {
  const auth = createOAuth2Client();
  const gmail = google.gmail({ version: "v1", auth });

  const raw = buildRawEmail({
    from: process.env.GMAIL_USER,
    to: extractEmailAddress(email.from),
    subject: ensureRePrefix(email.subject),
    inReplyTo: email.messageId,
    references: buildReferences(email.references, email.messageId),
    body: replyBody,
  });

  const res = await gmail.users.drafts.create({
    userId: "me",
    requestBody: {
      message: {
        raw,
        threadId: email.threadId,
      },
    },
  });

  const draftId = res.data.id;
  console.log(`📝 Draft created [id=${draftId}] for thread [${email.threadId}]`);
  return draftId;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Build a base64url-encoded RFC 2822 email string.
 */
function buildRawEmail({ from, to, subject, inReplyTo, references, body }) {
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Subject: ${subject}`,
    `In-Reply-To: ${inReplyTo}`,
    `References: ${references}`,
    "Content-Type: text/plain; charset=utf-8",
    "MIME-Version: 1.0",
    "",
    body,
  ];

  const raw = lines.join("\r\n");
  return Buffer.from(raw).toString("base64url");
}

/**
 * Extract a bare email address from a "Name <email>" header value.
 * e.g. "John Doe <john@example.com>" → "john@example.com"
 */
function extractEmailAddress(from) {
  const match = from.match(/<([^>]+)>/);
  return match ? match[1] : from.trim();
}

/**
 * Ensure subject starts with "Re: " (avoid "Re: Re: Re:").
 */
function ensureRePrefix(subject) {
  return /^re:/i.test(subject.trim()) ? subject : `Re: ${subject}`;
}

/**
 * Build the References header: existing references + the current message-id.
 */
function buildReferences(existingRefs, messageId) {
  const refs = existingRefs ? `${existingRefs} ${messageId}` : messageId;
  return refs.trim();
}

module.exports = { createDraft };