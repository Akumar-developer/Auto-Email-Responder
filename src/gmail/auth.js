/**
 * gmail/auth.js
 *
 * Two responsibilities:
 *   1. Export a ready-to-use OAuth2 client for all Gmail API calls.
 *   2. When run directly (`node src/gmail/auth.js`), execute the one-time
 *      authorization flow and print the refresh token to stdout so you can
 *      paste it into .env.
 */

"use strict";

require("dotenv").config();
const { google } = require("googleapis");
const http = require("http");
const url = require("url");

// ── Scopes ────────────────────────────────────────────────────────────────────
// gmail.modify  → read messages + mark as read
// gmail.compose → create drafts
const SCOPES = [
  "https://www.googleapis.com/auth/gmail.modify",
  "https://www.googleapis.com/auth/gmail.compose",
];

// ── Build the shared OAuth2 client ────────────────────────────────────────────
function createOAuth2Client() {
  const client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI
  );

  if (!process.env.GOOGLE_REFRESH_TOKEN) {
    throw new Error(
      "GOOGLE_REFRESH_TOKEN is not set.\n" +
        "Run `npm run auth` to complete the OAuth flow and obtain a token."
    );
  }

  client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return client;
}

module.exports = { createOAuth2Client };

// ── One-time OAuth flow (run this file directly) ───────────────────────────────
if (require.main === module) {
  (async () => {
    const client = new google.auth.OAuth2(
      process.env.GOOGLE_CLIENT_ID,
      process.env.GOOGLE_CLIENT_SECRET,
      process.env.GOOGLE_REDIRECT_URI // must be http://localhost:3000/auth/callback
    );

    const authUrl = client.generateAuthUrl({
      access_type: "offline",
      prompt: "consent", // force consent screen so we always get a refresh token
      scope: SCOPES,
    });

    console.log("\n🔐 Open this URL in your browser to authorise the app:\n");
    console.log(authUrl);
    console.log("\nWaiting for callback on http://localhost:3000/auth/callback …\n");

    // Spin up a temporary server to catch the OAuth callback
    const server = http.createServer(async (req, res) => {
      try {
        const qs = new url.URL(req.url, "http://localhost:3000").searchParams;
        const code = qs.get("code");

        if (!code) {
          res.end("No code found in callback. Try again.");
          return;
        }

        const { tokens } = await client.getToken(code);

        res.end("✅ Authorisation successful! You can close this tab.");
        server.close();

        console.log("✅ Tokens received:\n");
        console.log("GOOGLE_REFRESH_TOKEN=" + tokens.refresh_token);
        console.log(
          "\nPaste the GOOGLE_REFRESH_TOKEN value into your .env file, then restart the server."
        );
      } catch (err) {
        res.end("Error during token exchange: " + err.message);
        server.close();
      }
    });

    server.listen(3000);
  })();
}