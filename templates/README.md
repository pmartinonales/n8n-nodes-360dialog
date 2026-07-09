# Workflow templates

Templates for the [n8n creator portal](https://creators.n8n.io/) built on the
`@pmartino/n8n-nodes-360dialog` community node package.

## Send automatic WhatsApp text replies with 360dialog

File: [`auto-reply-to-whatsapp-messages-with-360dialog.json`](./auto-reply-to-whatsapp-messages-with-360dialog.json)

Paste the JSON into the **Template Code** field of the creator portal
submission form (or import it into n8n first to grab a screenshot).

### Suggested submission metadata

**Name**

> Send automatic WhatsApp text replies with 360dialog

**Description**

> ### Who's it for
>
> Anyone running WhatsApp on the 360dialog Messaging API who wants to reply
> automatically to every incoming message — support inboxes, lead capture, or
> as the starting point for a WhatsApp chatbot.
>
> ### How it works
>
> 1. The **360dialog Trigger** fires whenever a WhatsApp user sends a message
>    to your business number. It outputs a flat item with the sender's
>    Business-Scoped User ID (`fromUserId`), the message text, contact name
>    and more, and it filters out outbound echoes and duplicate webhook
>    deliveries so the workflow never replies to itself.
> 2. The **360dialog** node sends the text "Hey from n8n, by 360dialog" back
>    to the sender, addressed by `fromUserId` — this works even when the
>    sender hides their phone number behind a WhatsApp username.
>
> ### How to set up
>
> 1. Install the community node package `@pmartino/n8n-nodes-360dialog`
>    (Settings → Community Nodes).
> 2. Create a **360dialog API** credential with the API key from your
>    360dialog Hub and select it on both nodes.
> 3. Activate the workflow — the trigger registers the webhook with 360dialog
>    automatically (and restores the previous webhook URL on deactivation).
>
> ### Requirements
>
> - A 360dialog Messaging API account with an API key
> - The `@pmartino/n8n-nodes-360dialog` community node package
