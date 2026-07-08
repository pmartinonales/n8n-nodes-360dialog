/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency; tests are excluded from the published package (files: ["dist"]) */
import type { IDataObject, IWebhookFunctions } from 'n8n-workflow';
import { describe, expect, it } from 'vitest';

import { Dialog360Trigger } from '../nodes/Dialog360/Dialog360Trigger.node';

const makeContext = (body: IDataObject, staticData: IDataObject = {}) =>
	({
		getBodyData: () => body,
		getWorkflowStaticData: () => staticData,
		helpers: {
			returnJsonArray: (items: IDataObject[]) => items.map((json) => ({ json })),
		},
	}) as unknown as IWebhookFunctions;

const envelope = (value: IDataObject): IDataObject => ({
	object: 'whatsapp_business_account',
	entry: [
		{
			id: 'WABA',
			changes: [
				{
					value: {
						messaging_product: 'whatsapp',
						metadata: { display_phone_number: '4915199999999', phone_number_id: 'PNID' },
						...value,
					},
					field: 'messages',
				},
			],
		},
	],
});

const trigger = new Dialog360Trigger();

const emitted = async (body: IDataObject, staticData: IDataObject = {}) => {
	const result = await trigger.webhook.call(makeContext(body, staticData));
	return (result.workflowData?.[0] ?? []).map((item) => item.json as IDataObject);
};

describe('Dialog360Trigger webhook', () => {
	it('emits BSUID-only inbound messages (hidden phone) keyed on fromUserId', async () => {
		const out = await emitted(
			envelope({
				contacts: [
					{ profile: { name: 'Jane', username: 'jane_doe' }, user_id: 'BR.13491208655302741918' },
				],
				messages: [
					{
						id: 'wamid.bsuid1',
						from_user_id: 'BR.13491208655302741918',
						timestamp: '1720000000',
						type: 'text',
						text: { body: 'hi' },
					},
				],
			}),
		);
		expect(out).toHaveLength(1);
		expect(out[0]).toMatchObject({
			fromUserId: 'BR.13491208655302741918',
			userId: 'BR.13491208655302741918',
			username: 'jane_doe',
			text: 'hi',
		});
		expect(out[0].from).toBeUndefined();
		expect(out[0].waId).toBeUndefined();
	});

	it('emits both identifier families when the phone is visible', async () => {
		const out = await emitted(
			envelope({
				contacts: [
					{
						profile: { name: 'Jane' },
						wa_id: '34680989836',
						user_id: 'ES.98765432109876543210',
						parent_user_id: 'ES.ENT.111222333',
					},
				],
				messages: [
					{
						id: 'wamid.vis1',
						from: '34680989836',
						from_user_id: 'ES.98765432109876543210',
						timestamp: '1720000001',
						type: 'text',
						text: { body: 'hola' },
					},
				],
			}),
		);
		expect(out[0]).toMatchObject({
			from: '34680989836',
			waId: '34680989836',
			fromUserId: 'ES.98765432109876543210',
			parentUserId: 'ES.ENT.111222333',
			timestamp: '2024-07-03T09:46:41.000Z',
		});
	});

	it('flattens phone-change system events', async () => {
		const out = await emitted(
			envelope({
				messages: [
					{
						id: 'wamid.sys1',
						timestamp: '1720000002',
						type: 'system',
						system: {
							body: 'User changed phone number',
							user_id: 'ES.98765432109876543210',
							new_user_id: 'ES.55555555555555555555',
						},
					},
				],
			}),
		);
		expect(out[0]).toMatchObject({
			type: 'system',
			oldUserId: 'ES.98765432109876543210',
			newUserId: 'ES.55555555555555555555',
		});
	});

	it('drops the business own outbound echoes', async () => {
		const out = await emitted(
			envelope({
				contacts: [{ profile: { name: 'Biz' }, wa_id: '4915199999999' }],
				messages: [
					{
						id: 'wamid.echo1',
						from: '4915199999999',
						timestamp: '1720000003',
						type: 'text',
						text: { body: 'auto-reply from the business' },
					},
				],
			}),
		);
		expect(out).toHaveLength(0);
	});

	it('ignores statuses-only payloads', async () => {
		const out = await emitted(
			envelope({
				statuses: [
					{
						id: 'wamid.st1',
						status: 'delivered',
						timestamp: '1720000004',
						recipient_user_id: 'BR.13491208655302741918',
					},
				],
			}),
		);
		expect(out).toHaveLength(0);
	});

	it('deduplicates redeliveries of the same wamid via static data', async () => {
		const staticData: IDataObject = {};
		const payload = envelope({
			contacts: [{ profile: { name: 'Jane' }, user_id: 'BR.13491208655302741918' }],
			messages: [
				{
					id: 'wamid.dup1',
					from_user_id: 'BR.13491208655302741918',
					timestamp: '1720000005',
					type: 'text',
					text: { body: 'once' },
				},
			],
		});
		expect(await emitted(payload, staticData)).toHaveLength(1);
		expect(await emitted(payload, staticData)).toHaveLength(0);
	});
});
