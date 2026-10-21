# Connect the Supporter notifier to Discord

This is a **Discord incoming webhook**, not a bot-account login or private key.
It lets the release workflow post as **Decent DNFT Bot** in the chosen channel.
Anyone with its URL can post there: never paste it into chat, source, an issue,
an Actions variable, or a screenshot.

## 1. Create the webhook in Discord

Use Discord desktop or its web app, with an account allowed to **Manage Webhooks**
in the DecentAgency server.

1. Open **DecentAgency → lobby**.
2. Open the channel's gear / **Edit Channel**.
3. Choose **Integrations → Webhooks → New Webhook** (or **Create Webhook**).
4. Set its name to **Decent DNFT Bot** and channel to **lobby**.
5. Optionally choose an avatar. Save changes.
6. Click **Copy Webhook URL**. Keep this private; do not send it to the assistant.

If Integrations is missing, ask a server administrator for Manage Webhooks
permission or have them create it and save it directly in GitHub.

## 2. Store it directly as a GitHub Actions secret

For the already-listed Head v2.0.0 edition, the notifying workflow lives in
**TheJollyLaMa/DecentHead**, not in Market.

Open:
https://github.com/TheJollyLaMa/DecentHead/settings/secrets/actions

1. Choose **New repository secret**.
2. Name: `DISCORD_SUPPORTER_WEBHOOK`.
3. Secret: paste the webhook URL directly into GitHub.
4. Click **Add secret**. GitHub will not show the value again.
5. Clear your clipboard if it still contains the URL.

Leave `SUPPORTER_DISCORD_ENABLED` **false** until the steward is ready for the
real announcement. Never use a repository **variable** for the webhook.
The assistant can verify the secret's *name exists* without reading its value.

## 3. Authorize and verify the first real announcement

Once the secret exists, explicitly authorize activation. Before sending:

- Inspect the v2.0.0 release assets for existing pending/sent markers.
- Confirm the registered mint evidence, live listing and purchase route.
- Enable the repository variable `SUPPORTER_DISCORD_ENABLED=true`.
- Dispatch the existing `supporter-announce.yml` workflow and inspect its result.
- Verify the actual image/message/link appeared once in lobby and that the
  durable sent marker contains the Discord message ID.

Do not repeatedly dispatch if delivery is uncertain. A pending marker without a
sent marker requires reconciling the channel before any retry. The notifier
verifies on-chain mint, confirmations, metadata, price and stock; the webhook
alone does not bypass those checks.

## Future products

Market and subsequent products must install their reviewed release/announcement
workflow and register per-release mint/listing evidence before they can announce.
Adding a secret alone does **not** install a notifier or discover arbitrary mints.
Configure each personal repository's secret privately when it is adopted;
do not commit a shared webhook in a config file.

Rotate a leaked URL by deleting/recreating the webhook in Discord, then
updating every configured repository secret. A webhook requires no Discord bot
token, wallet key or broad server-administrator permission.
