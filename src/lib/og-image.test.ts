import { describe, expect, test } from 'bun:test';
import { pickOgFontUrl } from './og-font.ts';

const faces = [
	{
		weight: '400',
		src: [
			{ url: '/_astro/fonts/regular.woff2', format: 'woff2' },
			{ url: '/_astro/fonts/regular.woff', format: 'woff' }
		]
	},
	{
		weight: '600',
		src: [{ url: '/_astro/fonts/semibold.woff', format: 'woff' }]
	}
];

describe('pickOgFontUrl', () => {
	test('prefers the woff source for the requested weight', () => {
		expect(pickOgFontUrl(faces, 400)).toBe('/_astro/fonts/regular.woff');
		expect(pickOgFontUrl(faces, 600)).toBe('/_astro/fonts/semibold.woff');
	});

	test('throws when the Fonts API has no matching face', () => {
		expect(() => pickOgFontUrl(undefined, 400)).toThrow(/no data/);
		expect(() => pickOgFontUrl([], 400)).toThrow(/no data/);
		expect(() =>
			pickOgFontUrl(
				faces.filter((face) => face.weight === '400'),
				600
			)
		).toThrow(/weight 600/);
	});
});
