/* eslint-disable @n8n/community-nodes/no-restricted-imports -- vitest is a devDependency; tests are excluded from the published package (files: ["dist"]) */
import { describe, expect, it } from 'vitest';

import {
	buildComponents,
	epochToIso,
	extractVariables,
	isBsuid,
	isPositional,
	normalizePhone,
	recipientFields,
	simplifySendResponse,
	templateFieldDescriptors,
	type TemplateDef,
} from '../nodes/Dialog360/GenericFunctions';

describe('normalizePhone', () => {
	it('strips +, spaces, dashes and parentheses', () => {
		expect(normalizePhone('+49 (170) 123-4567')).toBe('491701234567');
	});
});

describe('epochToIso', () => {
	it('converts WhatsApp epoch seconds to ISO-8601 UTC', () => {
		expect(epochToIso('1720000000')).toBe('2024-07-03T09:46:40.000Z');
	});

	it('passes through already-formatted values and empties', () => {
		expect(epochToIso('2024-07-03T09:46:40Z')).toBe('2024-07-03T09:46:40Z');
		expect(epochToIso('')).toBeUndefined();
	});
});

describe('isBsuid', () => {
	it('accepts BSUIDs and parent BSUIDs', () => {
		expect(isBsuid('BR.13491208655302741918')).toBe(true);
		expect(isBsuid('ES.ENT.12345')).toBe(true);
	});

	it('rejects phone numbers and junk', () => {
		expect(isBsuid('491701234567')).toBe(false);
		expect(isBsuid('BR.')).toBe(false);
		expect(isBsuid('')).toBe(false);
	});
});

describe('recipientFields', () => {
	it('routes phones to `to`, normalized', () => {
		expect(recipientFields('+49 170 1234567', '')).toEqual({
			fields: { to: '491701234567' },
		});
	});

	it('routes BSUIDs to `recipient`', () => {
		expect(recipientFields('', 'BR.13491208655302741918')).toEqual({
			fields: { recipient: 'BR.13491208655302741918' },
		});
	});

	it('includes both when both are provided', () => {
		expect(recipientFields('491701234567', 'BR.13491208655302741918')).toEqual({
			fields: { to: '491701234567', recipient: 'BR.13491208655302741918' },
		});
	});

	it('errors when neither is provided', () => {
		expect(recipientFields('', '').error).toMatch(/Provide a phone number/);
	});

	it('errors on misplaced identifiers', () => {
		expect(recipientFields('BR.13491208655302741918', '').error).toMatch(/digits only/);
		expect(recipientFields('', '491701234567').error).toMatch(/Business-Scoped User ID/);
	});
});

describe('extractVariables / isPositional', () => {
	it('extracts positional and named variables', () => {
		expect(extractVariables('Hi {{1}}, order {{order_id}} ships {{2}}.')).toEqual([
			'1',
			'order_id',
			'2',
		]);
		expect(isPositional('1')).toBe(true);
		expect(isPositional('order_id')).toBe(false);
	});
});

const templateDef: TemplateDef = {
	name: 'order_update',
	language: 'en_US',
	status: 'APPROVED',
	components: [
		{ type: 'HEADER', format: 'IMAGE' },
		{ type: 'BODY', text: 'Hi {{1}}, order {{order_id}} ships {{2}}.' },
		{
			type: 'BUTTONS',
			buttons: [
				{ type: 'QUICK_REPLY', text: 'Stop' },
				{ type: 'URL', text: 'Track', url: 'https://x.com/{{1}}' },
				{ type: 'COPY_CODE', text: 'Copy code' },
			],
		},
		{ type: 'FOOTER', text: 'bye' },
	],
};

describe('templateFieldDescriptors', () => {
	it('generates one field per fillable slot with stable ids', () => {
		const ids = templateFieldDescriptors(templateDef).map((f) => f.id);
		expect(ids).toEqual([
			'header_media_url',
			'body_1',
			'body_order_id',
			'body_2',
			'button_1_url',
			'button_2_copy_code',
		]);
	});

	it('generates no fields for a variable-free template', () => {
		expect(
			templateFieldDescriptors({
				name: 't',
				language: 'en',
				status: 'APPROVED',
				components: [{ type: 'BODY', text: 'Static reminder.' }],
			}),
		).toEqual([]);
	});
});

describe('buildComponents', () => {
	it('assembles header, positional/named body params and buttons', () => {
		expect(
			buildComponents(templateDef, {
				header_media_url: 'https://cdn.example.com/a.jpg',
				body_1: 'Jane',
				body_order_id: 'A-1',
				body_2: 'Friday',
				button_1_url: 'code 25|x',
				button_2_copy_code: '25OFF',
			}),
		).toEqual([
			{
				type: 'header',
				parameters: [{ type: 'image', image: { link: 'https://cdn.example.com/a.jpg' } }],
			},
			{
				type: 'body',
				parameters: [
					{ type: 'text', text: 'Jane' },
					{ type: 'text', text: 'A-1', parameter_name: 'order_id' },
					{ type: 'text', text: 'Friday' },
				],
			},
			{
				type: 'button',
				sub_type: 'url',
				index: '1',
				// percent-encoded: Meta rejects unencoded specials
				parameters: [{ type: 'text', text: 'code%2025%7Cx' }],
			},
			{
				type: 'button',
				sub_type: 'copy_code',
				index: '2',
				parameters: [{ type: 'coupon_code', coupon_code: '25OFF' }],
			},
		]);
	});

	it('returns an empty array for a no-params template', () => {
		expect(
			buildComponents(
				{
					name: 't',
					language: 'en',
					status: 'APPROVED',
					components: [{ type: 'BODY', text: 'Static.' }, { type: 'FOOTER', text: 'bye' }],
				},
				{},
			),
		).toEqual([]);
	});
});

describe('simplifySendResponse', () => {
	it('exposes wa_id for phone-addressed sends', () => {
		expect(
			simplifySendResponse({
				contacts: [{ input: '491701234567', wa_id: '491701234567' }],
				messages: [{ id: 'wamid.a' }],
			}),
		).toMatchObject({ messageId: 'wamid.a', waId: '491701234567', userId: undefined });
	});

	it('exposes user_id for BSUID-addressed sends', () => {
		expect(
			simplifySendResponse({
				contacts: [{ input: 'BR.134', user_id: 'BR.134' }],
				messages: [{ id: 'wamid.b' }],
			}),
		).toMatchObject({ messageId: 'wamid.b', waId: undefined, userId: 'BR.134' });
	});
});
