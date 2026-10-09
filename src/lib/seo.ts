export const SITE_NAME = 'Spikonado';
export const SITE_URL = 'https://spikonado.com';
export const TWITTER_HANDLE = '@spikonado';

/** Stable social preview image generated at build time (`src/pages/og.png.ts`). */
export const DEFAULT_OG_IMAGE = '/og.png';

export const DEFAULT_TITLE = 'Spikonado | Build hardware and software with Sprocket';
export const DEFAULT_DESCRIPTION =
	'An AI engineering agent that works in your project folder. Research components, develop software, create schematics and build documents, and delegate work to subagents.';
export const SPROCKET_DESCRIPTION =
	'Sprocket is an AI engineering agent for hardware and software. Work in your project folder, delegate tasks to subagents, and review code, schematics, and previews.';

export const ORGANIZATION_SAME_AS = [
	'https://github.com/spikonado',
	'https://x.com/spikonado',
	'https://youtube.com/spikonado',
	'https://instagram.com/spikonado',
	'https://facebook.com/spikonado'
] as const;

export function absoluteUrl(pathnameOrUrl: string, site: URL | string = SITE_URL): string {
	return new URL(pathnameOrUrl, site).href;
}

export function titleWithBrand(pageTitle: string): string {
	if (pageTitle.includes(SITE_NAME)) {
		return pageTitle;
	}
	return `${pageTitle} | ${SITE_NAME}`;
}
