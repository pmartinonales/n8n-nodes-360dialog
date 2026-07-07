# n8n-nodes-360dialog

This is an n8n community node for the [360dialog](https://www.360dialog.com/) WhatsApp Business Messaging API. It lets you send WhatsApp messages from your workflows and trigger workflows when WhatsApp messages arrive.

[n8n](https://n8n.io/) is a [fair-code licensed](https://docs.n8n.io/reference/license/) workflow automation platform.

[Installation](#installation)
[Credentials](#credentials)
[Operations](#operations)
[Trigger](#trigger)
[Compatibility](#compatibility)
[Resources](#resources)

## Installation

Follow the [installation guide](https://docs.n8n.io/integrations/community-nodes/installation/) in the n8n community nodes documentation. The package name is `n8n-nodes-360dialog`.

## Credentials

Create a **360dialog API** credential with your Messaging API key. Generate or copy the key in the [360dialog Hub](https://hub.360dialog.com/) under WhatsApp Accounts → API Keys. The key is sent as the `D360-API-KEY` header on every request, and the credential test calls the `/health_status` endpoint.

## Operations

The **360dialog** node supports:

### Message

- **Send Text** — plain text message with an optional link preview.
- **Send Media** — image, video, document or audio from a publicly reachable HTTPS URL, with optional caption and (for documents) filename.
- **Send Template** — approved template messages, usable outside the 24-hour customer service window. Pick the template from a live dropdown (approved templates only, one entry per name + language) and the node generates the input fields automatically from the template definition (`/message_templates`): one field per body variable (positional `{{1}}` or named `{{order_id}}`), header text variable or header media URL, and dynamic URL button / copy-code coupon values. Meta's `components[]` payload is assembled for you — URL button values are percent-encoded automatically.

### Account

- **Get Health Status** — checks the health of your Messaging API channel.

Recipient phone numbers are normalized automatically (leading `+`, spaces, dashes and parentheses are stripped).

If a free-form message is rejected because the 24-hour customer service window has closed (error 131047), the node surfaces a clear error suggesting the Send Template operation.

## Trigger

The **360dialog Trigger** node starts a workflow when a WhatsApp user sends a message to your number.

- **Webhook lifecycle**: 360dialog delivers events to a single webhook URL per number (`POST /v1/configs/webhook`). Activating the workflow points that webhook at n8n and remembers the previously configured URL; deactivating restores it. Only one active consumer per number can receive events at a time.
- **Outbound echo filtering**: the webhook also carries the business's own outbound messages — these are dropped, so workflows that reply to messages don't trigger themselves in a loop.
- **Deduplication**: webhook delivery is at-least-once. The trigger remembers recently seen WhatsApp message IDs (24 hours, last 500) in workflow static data and ignores redeliveries.
- **Timestamps** are converted from Unix epoch seconds to ISO-8601 UTC.
- Status update events (sent/delivered/read/failed) are acknowledged but do not trigger the workflow.

## Compatibility

Requires n8n 1.x. Built and tested against the 360dialog Cloud API hosting (`waba-v2.360dialog.io`).

## Resources

- [n8n community nodes documentation](https://docs.n8n.io/integrations/community-nodes/)
- [360dialog Messaging API documentation](https://docs.360dialog.com/docs/messaging-api)
