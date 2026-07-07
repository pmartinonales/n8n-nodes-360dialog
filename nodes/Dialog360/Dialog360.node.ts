import type {
	IDataObject,
	IExecuteFunctions,
	ILoadOptionsFunctions,
	INodeExecutionData,
	INodePropertyOptions,
	INodeType,
	INodeTypeDescription,
} from 'n8n-workflow';
import { NodeApiError, NodeConnectionTypes, NodeOperationError } from 'n8n-workflow';

import {
	buildComponents,
	dialog360ApiRequest,
	normalizePhone,
	simplifySendResponse,
	type TemplateDef,
	type TemplateInputs,
} from './GenericFunctions';

// Programmatic style: Send Template requires dependent API calls (fetch the
// template definition, then reassemble Meta's components[] from flat inputs),
// which declarative routing cannot express.
export class Dialog360 implements INodeType {
	description: INodeTypeDescription = {
		displayName: '360dialog',
		name: 'dialog360',
		icon: { light: 'file:dialog360.svg', dark: 'file:dialog360.dark.svg' },
		group: ['output'],
		version: 1,
		subtitle: '={{$parameter["operation"] + ": " + $parameter["resource"]}}',
		description: 'Send WhatsApp messages via the 360dialog Messaging API',
		defaults: {
			name: '360dialog',
		},
		usableAsTool: true,
		inputs: [NodeConnectionTypes.Main],
		outputs: [NodeConnectionTypes.Main],
		credentials: [
			{
				name: 'dialog360Api',
				required: true,
			},
		],
		properties: [
			{
				displayName: 'Resource',
				name: 'resource',
				type: 'options',
				noDataExpression: true,
				options: [
					{ name: 'Account', value: 'account' },
					{ name: 'Message', value: 'message' },
				],
				default: 'message',
			},

			// ----------------------------------
			//         message operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
				options: [
					{
						name: 'Send Media',
						value: 'sendMedia',
						description: 'Send an image, video, document or audio message from a public URL',
						action: 'Send a media message',
					},
					{
						name: 'Send Template',
						value: 'sendTemplate',
						description:
							'Send an approved template message (works outside the 24-hour customer service window)',
						action: 'Send a template message',
					},
					{
						name: 'Send Text',
						value: 'sendText',
						description: 'Send a plain text message',
						action: 'Send a text message',
					},
				],
				default: 'sendText',
			},

			// ----------------------------------
			//         account operations
			// ----------------------------------
			{
				displayName: 'Operation',
				name: 'operation',
				type: 'options',
				noDataExpression: true,
				displayOptions: {
					show: {
						resource: ['account'],
					},
				},
				options: [
					{
						name: 'Get Health Status',
						value: 'getHealthStatus',
						description: 'Check the health status of your Messaging API channel',
						action: 'Get the health status',
					},
				],
				default: 'getHealthStatus',
			},

			// ----------------------------------
			//         shared: recipient
			// ----------------------------------
			{
				displayName: 'Recipient Phone Number',
				name: 'to',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. 491701234567',
				description:
					'Full number in international format, digits only, no + or spaces. + , spaces and dashes are stripped automatically.',
				displayOptions: {
					show: {
						resource: ['message'],
					},
				},
			},

			// ----------------------------------
			//         message:sendText
			// ----------------------------------
			{
				displayName: 'Message Text',
				name: 'body',
				type: 'string',
				typeOptions: {
					rows: 3,
				},
				required: true,
				default: '',
				description: 'The text content of the WhatsApp message to send',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendText'],
					},
				},
			},
			{
				displayName: 'Show Link Preview',
				name: 'previewUrl',
				type: 'boolean',
				default: false,
				description: 'Whether to render a preview card for the first URL in the message',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendText'],
					},
				},
			},

			// ----------------------------------
			//         message:sendMedia
			// ----------------------------------
			{
				displayName: 'Media Type',
				name: 'mediaType',
				type: 'options',
				options: [
					{ name: 'Audio', value: 'audio' },
					{ name: 'Document', value: 'document' },
					{ name: 'Image', value: 'image' },
					{ name: 'Video', value: 'video' },
				],
				default: 'image',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendMedia'],
					},
				},
			},
			{
				displayName: 'Media URL',
				name: 'link',
				type: 'string',
				required: true,
				default: '',
				placeholder: 'e.g. https://example.com/image.jpg',
				description:
					'Publicly reachable HTTPS URL to the file. Signed or expiring URLs may fail.',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendMedia'],
					},
				},
			},
			{
				displayName: 'Caption',
				name: 'caption',
				type: 'string',
				default: '',
				description: 'Optional caption shown under the media',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendMedia'],
						mediaType: ['image', 'video', 'document'],
					},
				},
			},
			{
				displayName: 'Filename',
				name: 'filename',
				type: 'string',
				default: '',
				placeholder: 'e.g. invoice.pdf',
				description: 'Filename shown to the recipient',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendMedia'],
						mediaType: ['document'],
					},
				},
			},

			// ----------------------------------
			//         message:sendTemplate
			// ----------------------------------
			{
				displayName: 'Template Name or ID',
				name: 'template',
				type: 'options',
				typeOptions: {
					loadOptionsMethod: 'getTemplates',
				},
				required: true,
				default: '',
				description:
					'The approved template to send. Choose from the list, or specify an ID using an <a href="https://docs.n8n.io/code/expressions/">expression</a>.',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendTemplate'],
					},
				},
			},
			{
				displayName: 'Body Variables',
				name: 'bodyVariables',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Variable',
				description:
					'Values for the template body variables, in order. For templates with named variables ({{order_id}}), set the matching name.',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendTemplate'],
					},
				},
				options: [
					{
						displayName: 'Variable',
						name: 'variables',
						values: [
							{
								displayName: 'Name',
								name: 'name',
								type: 'string',
								default: '',
								description:
									'Only needed for named variables like {{order_id}}. Leave empty for positional variables like {{1}}.',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
			{
				displayName: 'Header Text Variable',
				name: 'headerTextVariable',
				type: 'string',
				default: '',
				description: 'Value for the header text variable, if the template header has one',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendTemplate'],
					},
				},
			},
			{
				displayName: 'Header Media URL',
				name: 'headerMediaUrl',
				type: 'string',
				default: '',
				placeholder: 'e.g. https://example.com/header.jpg',
				description:
					'Publicly reachable HTTPS URL for the header media, if the template has an image, video or document header',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendTemplate'],
					},
				},
			},
			{
				displayName: 'Button Parameters',
				name: 'buttonParameters',
				type: 'fixedCollection',
				typeOptions: {
					multipleValues: true,
				},
				default: {},
				placeholder: 'Add Button Parameter',
				description: 'Values for dynamic URL buttons and copy-code coupon buttons',
				displayOptions: {
					show: {
						resource: ['message'],
						operation: ['sendTemplate'],
					},
				},
				options: [
					{
						displayName: 'Parameter',
						name: 'parameters',
						values: [
							{
								displayName: 'Button Index',
								name: 'index',
								type: 'number',
								default: 0,
								description: 'Position of the button in the template, starting at 0',
							},
							{
								displayName: 'Type',
								name: 'type',
								type: 'options',
								options: [
									{ name: 'Copy Code', value: 'copyCode' },
									{ name: 'URL Variable', value: 'url' },
								],
								default: 'url',
							},
							{
								displayName: 'Value',
								name: 'value',
								type: 'string',
								default: '',
							},
						],
					},
				],
			},
		],
	};

	methods = {
		loadOptions: {
			async getTemplates(this: ILoadOptionsFunctions): Promise<INodePropertyOptions[]> {
				const response = await dialog360ApiRequest.call(this, 'GET', '/v1/configs/templates');
				const templates = (response.waba_templates as TemplateDef[] | undefined) ?? [];
				return templates
					.filter((t) => String(t.status).toLowerCase() === 'approved')
					.map((t) => ({
						name: `${t.name} — ${t.language} (${t.category ?? 'template'})`,
						value: `${t.name}|${t.language}`,
					}))
					.sort((a, b) => a.name.localeCompare(b.name));
			},
		},
	};

	async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
		const items = this.getInputData();
		const returnData: INodeExecutionData[] = [];

		for (let i = 0; i < items.length; i++) {
			try {
				const resource = this.getNodeParameter('resource', i) as string;
				const operation = this.getNodeParameter('operation', i) as string;
				let responseData: IDataObject;

				if (resource === 'account' && operation === 'getHealthStatus') {
					responseData = await dialog360ApiRequest.call(this, 'GET', '/health_status');
				} else if (resource === 'message') {
					const to = normalizePhone(this.getNodeParameter('to', i) as string);

					if (operation === 'sendText') {
						responseData = await dialog360ApiRequest.call(this, 'POST', '/messages', {
							messaging_product: 'whatsapp',
							recipient_type: 'individual',
							to,
							type: 'text',
							text: {
								body: this.getNodeParameter('body', i) as string,
								preview_url: this.getNodeParameter('previewUrl', i) as boolean,
							},
						});
					} else if (operation === 'sendMedia') {
						const mediaType = this.getNodeParameter('mediaType', i) as string;
						const media: IDataObject = { link: this.getNodeParameter('link', i) as string };
						if (['image', 'video', 'document'].includes(mediaType)) {
							const caption = this.getNodeParameter('caption', i, '') as string;
							if (caption) media.caption = caption;
						}
						if (mediaType === 'document') {
							const filename = this.getNodeParameter('filename', i, '') as string;
							if (filename) media.filename = filename;
						}
						responseData = await dialog360ApiRequest.call(this, 'POST', '/messages', {
							messaging_product: 'whatsapp',
							recipient_type: 'individual',
							to,
							type: mediaType,
							[mediaType]: media,
						});
					} else if (operation === 'sendTemplate') {
						const composite = this.getNodeParameter('template', i) as string;
						const [name, language] = composite.split('|');

						const listResponse = await dialog360ApiRequest.call(
							this,
							'GET',
							'/v1/configs/templates',
						);
						const templates = (listResponse.waba_templates as TemplateDef[] | undefined) ?? [];
						const templateDef = templates.find(
							(t) =>
								t.name === name &&
								t.language === language &&
								String(t.status).toLowerCase() === 'approved',
						);
						if (!templateDef) {
							throw new NodeOperationError(
								this.getNode(),
								`Template "${name}" (${language}) was not found or is not approved. Only approved templates can be sent.`,
								{ itemIndex: i },
							);
						}

						const bodyVariablesCollection = this.getNodeParameter(
							'bodyVariables',
							i,
							{},
						) as IDataObject;
						const buttonParametersCollection = this.getNodeParameter(
							'buttonParameters',
							i,
							{},
						) as IDataObject;
						const inputs: TemplateInputs = {
							bodyVariables: (bodyVariablesCollection.variables as TemplateInputs['bodyVariables']) ?? [],
							headerTextVariable: this.getNodeParameter('headerTextVariable', i, '') as string,
							headerMediaUrl: this.getNodeParameter('headerMediaUrl', i, '') as string,
							buttonParameters:
								(buttonParametersCollection.parameters as TemplateInputs['buttonParameters']) ?? [],
						};

						const components = buildComponents(templateDef, inputs);
						const template: IDataObject = { name, language: { code: language } };
						if (components.length) {
							template.components = components;
						}

						responseData = await dialog360ApiRequest.call(this, 'POST', '/messages', {
							messaging_product: 'whatsapp',
							recipient_type: 'individual',
							to,
							type: 'template',
							template,
						});
					} else {
						throw new NodeOperationError(this.getNode(), `Unknown operation "${operation}"`, {
							itemIndex: i,
						});
					}

					responseData = simplifySendResponse(responseData);
				} else {
					throw new NodeOperationError(this.getNode(), `Unknown resource "${resource}"`, {
						itemIndex: i,
					});
				}

				returnData.push({
					json: responseData,
					pairedItem: { item: i },
				});
			} catch (error) {
				if (this.continueOnFail()) {
					returnData.push({
						json: { error: (error as Error).message },
						pairedItem: { item: i },
					});
					continue;
				}
				// dialog360ApiRequest already wraps API failures in NodeApiError.
				if (error instanceof NodeApiError || error instanceof NodeOperationError) {
					// eslint-disable-next-line @n8n/community-nodes/require-node-api-error -- already a wrapped n8n error; re-wrapping would mangle it
					throw error;
				}
				throw new NodeOperationError(this.getNode(), error as Error, { itemIndex: i });
			}
		}

		return [returnData];
	}
}
