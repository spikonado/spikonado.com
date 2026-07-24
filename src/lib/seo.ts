export const SITE_NAME = 'Spikonado';
export const SITE_URL = 'https://spikonado.com';
export const TWITTER_HANDLE = '@spikonado';

export const DEFAULT_TITLE = 'Spikonado | Build any kind of technology, faster';
export const DEFAULT_DESCRIPTION =
	'Spikonado helps anyone build apps, robots, devices, and the systems that glue them together. Start with Sprocket, an engineering agent with best-in-class web and open-source context.';

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
