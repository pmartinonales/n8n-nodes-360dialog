import type {
	IDataObject,
	IHookFunctions,
	INodeType,
	INodeTypeDescription,
	IWebhookFunctions,
	IWebhookResponseData,
} from 'n8n-workflow';
import { NodeConnectionTypes } from 'n8n-workflow';

import { dialog360ApiRequest, epochToIso } from './GenericFunctions';

const MEDIA_TYPES = ['image', 'video', 'document', 'audio', 'sticker'] as const;
const DEDUPE_TTL_MS = 24 * 60 * 60 * 1000;
const DEDUPE_MAX_ENTRIES = 500;

const digits = (v: unknown): string => String(v ?? '').replace(/\D/g, '');

// eslint-disable-next-line @n8n/community-nodes/node-usable-as-tool -- trigger nodes cannot be AI agent tools; the property only accepts `true`
export class Dialog360Trigger implements INodeType {
	description: INodeTypeDescription = {
		displayName: '360dialog Trigger',
		name: 'dialog360Trigger',
		icon: { light: 'file:dialog360.svg', dark: 'file:dialog360.dark.svg' },
		group: ['trigger'],
		version: 1,
		subtitle: '=Message Received',
		description: 'Starts the workflow when a WhatsApp message arrives via 360dialog',
		defaults: {
			name: '360dialog Trigger',
		},
		inputs: [],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'dialog360Api',
				required: true,
			},
		],
		webhooks: [
			{
				name: 'default',
				httpMethod: 'POST',
				responseMode: 'onReceived',
				path: 'webhook',
			},
		],
		properties: [
			{
				displayName: 'Event',
				name: 'event',
				type: 'options',
				options: [
					{
						name: 'Message Received',
						value: 'messageReceived',
						description: 'A WhatsApp user sent a message to your number',
					},
				],
				default: 'messageReceived',
			},
			{
				displayName:
					'360dialog delivers events to a single webhook URL per number. Activating this workflow points that webhook at n8n; the previous URL is restored when the workflow is deactivated.',
				name: 'webhookNotice',
				type: 'notice',
				default: '',
			},
		],
	};

	webhookMethods = {
		default: {
			async checkExists(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const config = await dialog360ApiRequest.call(this, 'GET', '/v1/configs/webhook');
				return config.url === webhookUrl;
			},

			async create(this: IHookFunctions): Promise<boolean> {
				const webhookUrl = this.getNodeWebhookUrl('default');
				const staticData = this.getWorkflowStaticData('node');

				// Remember the currently configured webhook so deactivation can
				// restore it. 360dialog has ONE webhook per number.
				const current = await dialog360ApiRequest.call(this, 'GET', '/v1/configs/webhook');
				if (current.url && current.url !== webhookUrl) {
					staticData.previousWebhookUrl = current.url;
				}

				await dialog360ApiRequest.call(this, 'POST', '/v1/configs/webhook', {
					url: webhookUrl,
				});
				return true;
			},

			async delete(this: IHookFunctions): Promise<boolean> {
				const staticData = this.getWorkflowStaticData('node');
				const previousUrl = staticData.previousWebhookUrl as string | undefined;

				if (previousUrl) {
					try {
						await dialog360ApiRequest.call(this, 'POST', '/v1/configs/webhook', {
							url: previousUrl,
						});
					} catch {
						// Best effort: never block workflow deactivation on a restore failure.
					}
					delete staticData.previousWebhookUrl;
				}
				return true;
			},
		},
	};

	async webhook(this: IWebhookFunctions): Promise<IWebhookResponseData> {
		const payload = this.getBodyData() as IDataObject;
		const staticData = this.getWorkflowStaticData('node');

		// Dedupe state: webhook delivery is at-least-once, so the same wamid
		// can arrive more than once.
		const now = Date.now();
		let seen = (staticData.seenMessageIds as Record<string, number> | undefined) ?? {};
		seen = Object.fromEntries(
			Object.entries(seen)
				.filter(([, ts]) => now - ts < DEDUPE_TTL_MS)
				.slice(-DEDUPE_MAX_ENTRIES),
		);

		const out: IDataObject[] = [];

		for (const entry of (payload.entry as IDataObject[] | undefined) ?? []) {
			for (const change of (entry.changes as IDataObject[] | undefined) ?? []) {
				const value = (change.value as IDataObject | undefined) ?? {};
				const messages = value.messages as IDataObject[] | undefined;
				if (!Array.isArray(messages)) {
					continue; // statuses-only payload
				}
				const metadata = (value.metadata as IDataObject | undefined) ?? {};
				const businessNumber = digits(metadata.display_phone_number);
				const contacts = value.contacts as IDataObject[] | undefined;
				const contact = contacts?.[0] ?? {};
				const profile = (contact.profile as IDataObject | undefined) ?? {};

				for (const msg of messages) {
					// Outbound echo: sent by the business number itself. Without this
					// filter, a workflow that replies re-triggers itself forever.
					if (businessNumber && digits(msg.from) === businessNumber) {
						continue;
					}
					if (msg.from_me === true) {
						continue;
					}
					// Redelivery of an already-processed message.
					const messageId = String(msg.id ?? '');
					if (messageId && seen[messageId]) {
						continue;
					}
					if (messageId) {
						seen[messageId] = now;
					}

					const flat: IDataObject = {
						messageId,
						from: msg.from,
						waId: contact.wa_id,
						contactName: profile.name,
						timestamp: epochToIso(msg.timestamp),
						type: msg.type,
					};
					const text = msg.text as IDataObject | undefined;
					if (text) {
						flat.text = text.body;
					}
					for (const mediaType of MEDIA_TYPES) {
						const media = msg[mediaType] as IDataObject | undefined;
						if (media) {
							flat[`${mediaType}Id`] = media.id;
							flat.mediaMimeType = media.mime_type;
							if (media.caption) {
								flat.caption = media.caption;
							}
						}
					}
					const location = msg.location as IDataObject | undefined;
					if (location) {
						flat.latitude = location.latitude;
						flat.longitude = location.longitude;
					}
					const button = msg.button as IDataObject | undefined;
					if (button) {
						flat.buttonText = button.text;
						flat.buttonPayload = button.payload;
					}
					const interactive = msg.interactive as IDataObject | undefined;
					if (interactive) {
						const reply = (interactive.button_reply ??
							interactive.list_reply ??
							{}) as IDataObject;
						flat.interactiveReplyId = reply.id;
						flat.interactiveReplyTitle = reply.title;
					}
					out.push(flat);
				}
			}
		}

		staticData.seenMessageIds = seen;

		if (!out.length) {
			// Acknowledge with 200 but do not start the workflow (statuses,
			// echoes and duplicates end up here).
			return {};
		}

		return {
			workflowData: [this.helpers.returnJsonArray(out)],
		};
	}
}
