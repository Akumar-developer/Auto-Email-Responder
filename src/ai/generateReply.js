/**
 * ai/generateReply.js
 *
 * Sends a structured prompt to Claude and returns a ready-to-review
 * email reply draft.
 *
 * Design decisions:
 *   - System prompt enforces tone + format constraints.
 *   - User prompt is minimal: we give Claude exactly what it needs.
 *   - No conversational filler, no sign-off (human will personalise).
 *   - Temperature kept low (0.3) for consistent, professional output.
 */

"use strict";

require("dotenv").config();
const Anthropic = require("@anthropic-ai/sdk");

const client = new Anthropic.default({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

const SYSTEM_PROMPT = `You are a professional email assistant.

Your task: draft a concise, clear reply to the email provided.

Rules:
- Be professional but natural — match the tone of the original email (formal if formal, casual if casual).
- Get to the point. No fluff, no filler.
- Do NOT include a subject line.
- Do NOT include a greeting (e.g. "Hi John,") — the human will add one.
- Do NOT include a sign-off (e.g. "Best regards") — the human will add one.
- Do NOT explain what you are doing. Just write the reply body.
- If the email asks a question, answer it directly.
- If the email requires an action, acknowledge it and indicate next steps.
- If the email is ambiguous, draft a polite clarifying reply.
- Keep replies under 150 words unless the email is complex and requires more.`;

/**
 * Generate a draft reply for a given parsed email.
 *
 * @param {import("../gmail/reader").ParsedEmail} email
 * @returns {Promise<string>} - The draft reply body text
 */
async function generateReply(email) {
  const userPrompt = buildUserPrompt(email);

  const message = await client.messages.create({
    model: "claude-sonnet-4-20250514",
    max_tokens: 512,
    system: SYSTEM_PROMPT,
    messages: [{ role: "user", content: userPrompt }],
  });

  // Extract text from the response
  const textBlock = message.content.find((block) => block.type === "text");
  if (!textBlock) throw new Error("Claude returned no text content");

  return textBlock.text.trim();
}

/**
 * Build the structured user prompt from a parsed email.
 */
function buildUserPrompt(email) {
  return [
    `From: ${email.from}`,
    `Subject: ${email.subject}`,
    ``,
    `--- Email Body ---`,
    email.body,
    `--- End ---`,
    ``,
    `Draft a reply to this email.`,
  ].join("\n");
}

module.exports = { generateReply };