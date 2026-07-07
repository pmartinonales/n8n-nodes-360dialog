import type {
	IAuthenticateGeneric,
	ICredentialTestRequest,
	ICredentialType,
	Icon,
	INodeProperties,
} from 'n8n-workflow';

export class Dialog360Api implements ICredentialType {
	name = 'dialog360Api';

	displayName = '360dialog API';

	documentationUrl = 'https://docs.360dialog.com/docs/messaging-api';

	icon: Icon = {
		light: 'file:../nodes/Dialog360/dialog360.svg',
		dark: 'file:../nodes/Dialog360/dialog360.dark.svg',
	};

	properties: INodeProperties[] = [
		{
			displayName: 'API Key',
			name: 'apiKey',
			type: 'string',
			typeOptions: {
				password: true,
			},
			required: true,
			default: '',
			description:
				'Your 360dialog Messaging API key. Generate or copy it in the 360dialog Hub under WhatsApp Accounts → API Keys.',
		},
	];

	authenticate: IAuthenticateGeneric = {
		type: 'generic',
		properties: {
			headers: {
				'D360-API-KEY': '={{$credentials.apiKey}}',
			},
		},
	};

	// /health_status returns 401 on a missing or invalid key, unlike /health
	// which ignores authentication entirely.
	test: ICredentialTestRequest = {
		request: {
			baseURL: 'https://waba-v2.360dialog.io',
			url: '/health_status',
			method: 'GET',
		},
	};
}
