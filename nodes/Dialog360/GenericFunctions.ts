import type {
	IDataObject,
	IExecuteFunctions,
	IHookFunctions,
	IHttpRequestMethods,
	ILoadOptionsFunctions,
	IWebhookFunctions,
	JsonObject,
} from 'n8n-workflow';
import { NodeApiError } from 'n8n-workflow';

export const BASE_URL = 'https://waba-v2.360dialog.io';

export async function dialog360ApiRequest(
	this: IExecuteFunctions | ILoadOptionsFunctions | IHookFunctions | IWebhookFunctions,
	method: IHttpRequestMethods,
	endpoint: string,
	body?: IDataObject,
): Promise<IDataObject> {
	try {
		return (await this.helpers.httpRequestWithAuthentication.call(this, 'dialog360Api', {
			method,
			url: `${BASE_URL}${endpoint}`,
			body,
			json: true,
		})) as IDataObject;
	} catch (error) {
		const causeText = JSON.stringify((error as JsonObject).cause ?? {});
		// 131047: free-form message outside the 24h customer service window.
		if (causeText.includes('131047')) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: 'The 24-hour customer service window for this recipient has closed',
				description: 'Use the Send Template operation to re-engage this recipient.',
			});
		}
		// 131009: malformed, foreign-portfolio or retired BSUID.
		if (causeText.includes('131009')) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: 'The recipient identifier was rejected (error 131009)',
				description:
					'If you sent to a user ID (BSUID), it may be malformed, belong to another business portfolio, or have been retired by a phone change. Re-resolve the identity — watch for "system" events on the 360dialog Trigger announcing a new user ID.',
			});
		}
		// 131062: authentication templates cannot be sent to a BSUID.
		if (causeText.includes('131062')) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: 'Authentication templates cannot be sent to a user ID (error 131062)',
				description: 'Address this recipient by phone number to send authentication templates.',
			});
		}
		// Surface 360dialog's own error text instead of a generic status message.
		const cause = ((error as IDataObject).cause ?? error) as IDataObject;
		const response = (cause.response ?? {}) as IDataObject;
		const responseBody = response.body ?? response.data ?? cause.errorResponse;
		if (responseBody) {
			const apiMessage =
				typeof responseBody === 'string'
					? responseBody
					: String(
							(responseBody as IDataObject).error ??
								((responseBody as IDataObject).meta as IDataObject | undefined)
									?.developer_message ??
								JSON.stringify(responseBody),
						);
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: `360dialog error: ${apiMessage}`,
			});
		}
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

// WhatsApp expects digits only: no +, spaces, dashes or parentheses.
export function normalizePhone(raw: string): string {
	return String(raw ?? '').replace(/[+\s\-()]/g, '');
}

// Business-Scoped User ID: XX.<18-20 digits>, or XX.ENT.<digits> for parent
// BSUIDs. Unambiguous vs phone numbers, so the recipient field auto-detects.
export function isBsuid(value: string): boolean {
	return /^[A-Z]{2}\.(ENT\.)?\d+$/i.test(String(value ?? '').trim());
}

// POST /messages addresses phones via `to` and BSUIDs via `recipient`
// (if both were present, `to` would win — so exactly one is set).
export function recipientFields(rawRecipient: string): IDataObject {
	const value = String(rawRecipient ?? '').trim();
	if (isBsuid(value)) {
		return { recipient: value };
	}
	return { to: normalizePhone(value) };
}

// WhatsApp webhooks carry timestamps as Unix epoch seconds.
export function epochToIso(ts: unknown): string | undefined {
	if (ts === null || ts === undefined || ts === '') return undefined;
	if (/^\d+$/.test(String(ts))) {
		return new Date(Number(ts) * 1000).toISOString();
	}
	return String(ts);
}

// Returns the raw variable tokens from a template string, e.g.
// "Use {{1}} by {{expiry_date}}" -> ['1', 'expiry_date'].
export function extractVariables(text?: string): string[] {
	const vars: string[] = [];
	const re = /\{\{\s*([^}]+?)\s*\}\}/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text ?? '')) !== null) {
		vars.push(match[1]);
	}
	return vars;
}

// Positional params ({{1}}) vs Meta named params ({{order_id}}).
export function isPositional(variable: string): boolean {
	return /^\d+$/.test(variable);
}

export interface TemplateComponentDef {
	type: string;
	format?: string;
	text?: string;
	url?: string;
	buttons?: Array<{ type: string; text?: string; url?: string }>;
	example?: IDataObject;
}

export interface TemplateDef {
	name: string;
	language: string;
	status: string;
	category?: string;
	components?: TemplateComponentDef[];
}

const MAX_TEMPLATE_PAGES = 20;

// GET /message_templates returns { data: [...], paging: { cursors, next } }.
export async function fetchApprovedTemplates(
	this: IExecuteFunctions | ILoadOptionsFunctions,
): Promise<TemplateDef[]> {
	const all: TemplateDef[] = [];
	let after: string | undefined;

	for (let page = 0; page < MAX_TEMPLATE_PAGES; page++) {
		const endpoint = after
			? `/message_templates?after=${encodeURIComponent(after)}`
			: '/message_templates';
		const response = await dialog360ApiRequest.call(this, 'GET', endpoint);
		all.push(...(((response.data as TemplateDef[] | undefined) ?? []) as TemplateDef[]));

		const paging = response.paging as IDataObject | undefined;
		const cursors = paging?.cursors as IDataObject | undefined;
		after = paging?.next ? (cursors?.after as string | undefined) : undefined;
		if (!after) break;
	}

	return all.filter((t) => String(t.status).toUpperCase() === 'APPROVED');
}

export interface TemplateFieldDescriptor {
	id: string;
	label: string;
	required: boolean;
}

const hasVariable = (text?: string): boolean => /\{\{.+?\}\}/.test(text ?? '');

const truncate = (text: string, max = 60): string =>
	text.length > max ? `${text.slice(0, max - 1)}…` : text;

// One input field per fillable slot in the template. The ids are stable keys
// that buildComponents() maps back onto Meta's components[] format.
export function templateFieldDescriptors(templateDef: TemplateDef): TemplateFieldDescriptor[] {
	const fields: TemplateFieldDescriptor[] = [];

	for (const c of templateDef.components ?? []) {
		const ctype = String(c.type ?? '').toUpperCase();

		if (ctype === 'BODY') {
			for (const v of extractVariables(c.text)) {
				fields.push({
					id: `body_${v}`,
					label: isPositional(v)
						? `Body {{${v}}} — “${truncate(c.text ?? '')}”`
						: `Body: ${v}`,
					required: true,
				});
			}
		} else if (ctype === 'HEADER') {
			const format = String(c.format ?? 'TEXT').toUpperCase();
			if (format === 'TEXT') {
				const vars = extractVariables(c.text);
				if (vars.length) {
					fields.push({
						id: 'header_text',
						label: `Header {{${vars[0]}}} — “${truncate(c.text ?? '')}”`,
						required: true,
					});
				}
			} else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format)) {
				fields.push({
					id: 'header_media_url',
					label: `Header ${format.toLowerCase()} URL`,
					required: true,
				});
			}
		} else if (ctype === 'BUTTONS') {
			(c.buttons ?? []).forEach((btn, index) => {
				const btype = String(btn.type ?? '').toUpperCase();
				if (btype === 'URL' && hasVariable(btn.url)) {
					fields.push({
						id: `button_${index}_url`,
						label: `Button “${btn.text ?? index}” URL variable`,
						required: true,
					});
				} else if (btype === 'COPY_CODE') {
					fields.push({
						id: `button_${index}_copy_code`,
						label: `Button “${btn.text ?? index}” coupon code`,
						required: true,
					});
				}
			});
		}
		// FOOTER and static components need no input.
	}

	return fields;
}

function textParam(variable: string, value: string): IDataObject {
	const param: IDataObject = { type: 'text', text: value ?? '' };
	if (!isPositional(variable)) {
		param.parameter_name = variable;
	}
	return param;
}

// Reassembles the values collected for templateFieldDescriptors() ids into
// Meta's components[] send format. Components without parameters are omitted.
export function buildComponents(
	templateDef: TemplateDef,
	values: Record<string, string>,
): IDataObject[] {
	const components: IDataObject[] = [];

	for (const c of templateDef.components ?? []) {
		const ctype = String(c.type ?? '').toUpperCase();

		if (ctype === 'BODY') {
			const vars = extractVariables(c.text);
			if (vars.length) {
				components.push({
					type: 'body',
					parameters: vars.map((v) => textParam(v, String(values[`body_${v}`] ?? ''))),
				});
			}
		} else if (ctype === 'HEADER') {
			const format = String(c.format ?? 'TEXT').toUpperCase();

			if (format === 'TEXT') {
				const vars = extractVariables(c.text);
				if (vars.length && values.header_text) {
					components.push({
						type: 'header',
						parameters: [textParam(vars[0], String(values.header_text))],
					});
				}
			} else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format) && values.header_media_url) {
				const mediaKey = format.toLowerCase();
				components.push({
					type: 'header',
					parameters: [{ type: mediaKey, [mediaKey]: { link: values.header_media_url } }],
				});
			}
		} else if (ctype === 'BUTTONS') {
			(c.buttons ?? []).forEach((btn, index) => {
				const btype = String(btn.type ?? '').toUpperCase();
				const urlValue = values[`button_${index}_url`];
				const codeValue = values[`button_${index}_copy_code`];

				if (btype === 'URL' && hasVariable(btn.url) && urlValue) {
					components.push({
						type: 'button',
						sub_type: 'url',
						index: String(index),
						// Meta rejects unencoded specials in dynamic URL-button values.
						parameters: [{ type: 'text', text: encodeURIComponent(urlValue) }],
					});
				} else if (btype === 'COPY_CODE' && codeValue) {
					components.push({
						type: 'button',
						sub_type: 'copy_code',
						index: String(index),
						parameters: [{ type: 'coupon_code', coupon_code: codeValue }],
					});
				}
			});
		}
		// FOOTER and other static components take no parameters.
	}

	return components;
}

// Flattens a message send response, exposing the ids downstream steps need.
// Phone-addressed sends return contacts[0].wa_id, BSUID-addressed sends
// return contacts[0].user_id — never both.
export function simplifySendResponse(response: IDataObject): IDataObject {
	const messages = response.messages as IDataObject[] | undefined;
	const contacts = response.contacts as IDataObject[] | undefined;
	return {
		...response,
		messageId: messages?.[0]?.id,
		waId: contacts?.[0]?.wa_id,
		userId: contacts?.[0]?.user_id,
	};
}
