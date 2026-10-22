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

Market now installs the reviewed [announcement workflow](../.github/workflows/supporter-announce.yml).
It uses the exact pinned Head notifier revision, not a second fork of the delivery
logic. Although its checkout is Head, GitHub's repository context/token remain
Market's: it reads and writes Market release assets, not Head assets.
The steward authorized activation for both Head and Market on 2026-10-22 UTC.
Activation is recorded through each repository's variable, not a webhook in code.

Schedules scan registered pending releases twice hourly (best effort, not an
instant chain watcher). Published/edited releases also trigger a check.
After each version's four wallet steps, export the Studio evidence and attach
it once to that version's official release as `supporter-evidence.json`, or pass
its public JSON to the dispatch's registration input if no evidence exists.
Both unchanged Studio exports and identity-bound envelopes are supported;
on-chain verification must still succeed. Do not re-register an existing asset.
The preparation manifest must identify that repository/version and its minted
metadata URI. Unprepared releases, or prepared releases without evidence, are
not announced. The obsolete Market v0.3.0 artwork has no evidence and is skipped.

Announcements include the product/version, front artwork, $10 USDC Base price,
creator, release date, release notes and exact purchase link. They describe a
dated artifact supporting development, not ownership of the project or a promise
of profit. Mention parsing is disabled.

For **each subsequent repository**, copy this workflow, retain the reviewed
notifier commit pin, save `DISCORD_SUPPORTER_WEBHOOK` privately, set
`SUPPORTER_DISCORD_ENABLED=true` only after authorization, register its own
prepared manifest/evidence and dispatch once. Never copy another product's
metadata/token/listing IDs. New repositories are not opted in automatically.
Adding a secret alone does **not** install a notifier or discover arbitrary mints.
Configure each personal repository's secret privately when it is adopted;
do not commit a shared webhook in a config file.

Rotate a leaked URL by deleting/recreating the webhook in Discord, then
updating every configured repository secret. A webhook requires no Discord bot
token, wallet key or broad server-administrator permission.

## Duplicate protection and uncertain delivery

Delivery writes `supporter-discord-pending.json` to the release **before**
contacting Discord. A successful acknowledgement saves
`supporter-discord-sent.json` with the message ID. Reruns with a matching sent
marker make no Discord request. Never delete these assets to force an automatic
retry. A pending marker without a sent marker stops delivery: check the lobby
first, then reconcile the acknowledgement/marker with the steward. This favors
avoiding duplicate posts over blindly retrying an ambiguous network failure.
