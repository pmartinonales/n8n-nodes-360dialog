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
		// 131047: free-form message outside the 24h customer service window.
		if (JSON.stringify((error as JsonObject).cause ?? {}).includes('131047')) {
			throw new NodeApiError(this.getNode(), error as JsonObject, {
				message: 'The 24-hour customer service window for this recipient has closed',
				description: 'Use the Send Template operation to re-engage this recipient.',
			});
		}
		throw new NodeApiError(this.getNode(), error as JsonObject);
	}
}

// WhatsApp expects digits only: no +, spaces, dashes or parentheses.
export function normalizePhone(raw: string): string {
	return String(raw ?? '').replace(/[+\s\-()]/g, '');
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
}

export interface TemplateDef {
	name: string;
	language: string;
	status: string;
	category?: string;
	components?: TemplateComponentDef[];
}

export interface TemplateInputs {
	bodyVariables: Array<{ name?: string; value: string }>;
	headerTextVariable?: string;
	headerMediaUrl?: string;
	buttonParameters: Array<{ index: number; type: string; value: string }>;
}

function textParam(variable: string, value: string): IDataObject {
	const param: IDataObject = { type: 'text', text: value ?? '' };
	if (!isPositional(variable)) {
		param.parameter_name = variable;
	}
	return param;
}

// Reassembles the flat user inputs into Meta's components[] send format.
// Components without any parameters are omitted entirely.
export function buildComponents(templateDef: TemplateDef, inputs: TemplateInputs): IDataObject[] {
	const components: IDataObject[] = [];

	for (const c of templateDef.components ?? []) {
		const ctype = String(c.type ?? '').toUpperCase();

		if (ctype === 'BODY') {
			const vars = extractVariables(c.text);
			if (vars.length) {
				const parameters = vars.map((v, i) => {
					const named = inputs.bodyVariables.find((b) => b.name === v);
					const positional = inputs.bodyVariables[i];
					const value = (isPositional(v) ? positional?.value : (named ?? positional)?.value) ?? '';
					return textParam(v, value);
				});
				components.push({ type: 'body', parameters });
			}
		} else if (ctype === 'HEADER') {
			const format = String(c.format ?? 'TEXT').toUpperCase();

			if (format === 'TEXT') {
				const vars = extractVariables(c.text);
				if (vars.length && inputs.headerTextVariable) {
					components.push({
						type: 'header',
						parameters: [textParam(vars[0], inputs.headerTextVariable)],
					});
				}
			} else if (['IMAGE', 'VIDEO', 'DOCUMENT'].includes(format) && inputs.headerMediaUrl) {
				const mediaKey = format.toLowerCase();
				components.push({
					type: 'header',
					parameters: [{ type: mediaKey, [mediaKey]: { link: inputs.headerMediaUrl } }],
				});
			}
		} else if (ctype === 'BUTTONS') {
			(c.buttons ?? []).forEach((btn, index) => {
				const btype = String(btn.type ?? '').toUpperCase();
				const provided = inputs.buttonParameters.find((p) => Number(p.index) === index);

				if (btype === 'URL' && /\{\{.+?\}\}/.test(btn.url ?? '') && provided?.value) {
					components.push({
						type: 'button',
						sub_type: 'url',
						index: String(index),
						// Meta rejects unencoded specials in dynamic URL-button values.
						parameters: [{ type: 'text', text: encodeURIComponent(provided.value) }],
					});
				} else if (btype === 'COPY_CODE' && provided?.value) {
					components.push({
						type: 'button',
						sub_type: 'copy_code',
						index: String(index),
						parameters: [{ type: 'coupon_code', coupon_code: provided.value }],
					});
				}
			});
		}
		// FOOTER and other static components take no parameters.
	}

	return components;
}

// Flattens a message send response, exposing the ids downstream steps need.
export function simplifySendResponse(response: IDataObject): IDataObject {
	const messages = response.messages as IDataObject[] | undefined;
	const contacts = response.contacts as IDataObject[] | undefined;
	return {
		...response,
		messageId: messages?.[0]?.id,
		waId: contacts?.[0]?.wa_id,
	};
}
