export const SPROCKET_NPM_COMMAND = 'npx @spikonado/sprocket';
export const SPROCKET_GITHUB_URL = 'https://github.com/spikonado/sprocket';
export const SPROCKET_RELEASES_LATEST_URL = `${SPROCKET_GITHUB_URL}/releases/latest`;
export const SPROCKET_NPM_URL = 'https://www.npmjs.com/package/@spikonado/sprocket';

/** Stable identifiers matching GitHub desktop asset filenames. */
export type SprocketDesktopPlatform =
	'mac-arm64' | 'mac-x64' | 'win-x64' | 'linux-x86_64' | 'linux-arm64';

export interface SprocketDesktopAsset {
	platform: SprocketDesktopPlatform;
	label: string;
	shortLabel: string;
	filename: string;
	url: string;
}

export interface SprocketRelease {
	version: string;
	tagName: string;
	htmlUrl: string;
	assets: SprocketDesktopAsset[];
}

export interface DetectedDesktopTarget {
	platform: SprocketDesktopPlatform | null;
	osLabel: string;
}

/** Brand mark family for download CTAs. */
export type SprocketOsFamily = 'mac' | 'windows' | 'linux';

export function osFamilyForPlatform(
	platform: SprocketDesktopPlatform | null
): SprocketOsFamily | null {
	if (!platform) {
		return null;
	}
	if (platform.startsWith('mac-')) {
		return 'mac';
	}
	if (platform.startsWith('win-')) {
		return 'windows';
	}
	return 'linux';
}

const DESKTOP_ASSET_RULES: {
	platform: SprocketDesktopPlatform;
	match: RegExp;
	label: string;
	shortLabel: string;
}[] = [
	{
		platform: 'mac-arm64',
		match: /sprocket-desktop-[\d.]+-mac-arm64\.dmg$/i,
		label: 'macOS (Apple Silicon)',
		shortLabel: 'Apple Silicon'
	},
	{
		platform: 'mac-x64',
		match: /sprocket-desktop-[\d.]+-mac-x64\.dmg$/i,
		label: 'macOS (Intel)',
		shortLabel: 'Intel Mac'
	},
	{
		platform: 'win-x64',
		match: /sprocket-desktop-[\d.]+-win-x64\.exe$/i,
		label: 'Windows',
		shortLabel: 'Windows'
	},
	{
		platform: 'linux-x86_64',
		match: /sprocket-desktop-[\d.]+-linux-x86_64\.AppImage$/i,
		label: 'Linux (x64)',
		shortLabel: 'Linux x64'
	},
	{
		platform: 'linux-arm64',
		match: /sprocket-desktop-[\d.]+-linux-arm64\.AppImage$/i,
		label: 'Linux (ARM64)',
		shortLabel: 'Linux ARM'
	}
];

interface GitHubReleaseAsset {
	name?: string;
	browser_download_url?: string;
}

interface GitHubRelease {
	tag_name?: string;
	name?: string;
	html_url?: string;
	assets?: GitHubReleaseAsset[];
}

export function parseSprocketDesktopAssets(
	assets: GitHubReleaseAsset[] | undefined
): SprocketDesktopAsset[] {
	if (!assets?.length) {
		return [];
	}

	const parsed: SprocketDesktopAsset[] = [];

	for (const rule of DESKTOP_ASSET_RULES) {
		const asset = assets.find(
			(candidate) => typeof candidate.name === 'string' && rule.match.test(candidate.name)
		);
		if (!asset?.name || !asset.browser_download_url) {
			continue;
		}
		parsed.push({
			platform: rule.platform,
			label: rule.label,
			shortLabel: rule.shortLabel,
			filename: asset.name,
			url: asset.browser_download_url
		});
	}

	return parsed;
}

export function pickDesktopAsset(
	assets: SprocketDesktopAsset[],
	platform: SprocketDesktopPlatform | null
): SprocketDesktopAsset | null {
	if (!platform) {
		return null;
	}
	return assets.find((asset) => asset.platform === platform) ?? null;
}

export function otherDesktopAssets(
	assets: SprocketDesktopAsset[],
	platform: SprocketDesktopPlatform | null
): SprocketDesktopAsset[] {
	if (!platform) {
		return assets;
	}
	return assets.filter((asset) => asset.platform !== platform);
}

type NavigatorLike = {
	userAgent: string;
	platform: string;
	maxTouchPoints?: number;
	userAgentData?: {
		platform?: string;
		getHighEntropyValues?: (hints: string[]) => Promise<{
			architecture?: string;
			platform?: string;
		}>;
	};
};

/**
 * Best-effort desktop target from the browser environment.
 * Mobile OSes (Android/iOS) return null — they are not desktop download targets.
 * Defaults modern Macs to Apple Silicon and Linux to x64 when arch is unknown.
 */
export function detectDesktopTarget(
	nav: NavigatorLike = typeof navigator === 'undefined'
		? { userAgent: '', platform: '' }
		: navigator,
	architectureHint = ''
): DetectedDesktopTarget {
	const ua = nav.userAgent ?? '';
	const platform = nav.platform ?? '';
	const uaDataPlatform = nav.userAgentData?.platform?.toLowerCase() ?? '';
	const architecture = architectureHint.toLowerCase();

	// Android UAs / navigator.platform often contain "Linux" — exclude mobiles first.
	const isMobile =
		uaDataPlatform === 'android' ||
		/android/i.test(ua) ||
		/iphone|ipad|ipod/i.test(ua) ||
		(/mac/i.test(platform) && (nav.maxTouchPoints ?? 0) > 1);
	if (isMobile) {
		return { platform: null, osLabel: 'your device' };
	}

	const isWindows =
		uaDataPlatform.includes('windows') || /win/i.test(platform) || /windows/i.test(ua);
	if (isWindows) {
		return { platform: 'win-x64', osLabel: 'Windows' };
	}

	const isMac =
		uaDataPlatform.includes('mac') || /mac/i.test(platform) || /macintosh|mac os x/i.test(ua);
	if (isMac) {
		// Safari still reports "Intel Mac OS X" on Apple Silicon, so only trust
		// Client Hints architecture — default to arm64 for modern Macs.
		const isIntel = architecture === 'x86' || architecture === 'x86_64';
		if (isIntel) {
			return { platform: 'mac-x64', osLabel: 'macOS' };
		}
		return { platform: 'mac-arm64', osLabel: 'macOS' };
	}

	const isLinux = uaDataPlatform.includes('linux') || /linux/i.test(platform) || /linux/i.test(ua);
	if (isLinux) {
		const isArm =
			architecture === 'arm' ||
			architecture === 'arm64' ||
			/\baarch64\b/i.test(ua) ||
			/\barm64\b/i.test(ua);
		if (isArm) {
			return { platform: 'linux-arm64', osLabel: 'Linux' };
		}
		return { platform: 'linux-x86_64', osLabel: 'Linux' };
	}

	return { platform: null, osLabel: 'your OS' };
}

export async function detectDesktopTargetAsync(
	nav: NavigatorLike = typeof navigator === 'undefined'
		? { userAgent: '', platform: '' }
		: navigator
): Promise<DetectedDesktopTarget> {
	let architecture = '';
	try {
		const values = await nav.userAgentData?.getHighEntropyValues?.(['architecture', 'platform']);
		if (values?.architecture) {
			architecture = values.architecture;
		}
	} catch {
		// Keep the empty default when Client Hints are unavailable.
	}
	return detectDesktopTarget(nav, architecture);
}

export async function fetchLatestSprocketRelease(
	fetchImpl: typeof fetch = fetch
): Promise<SprocketRelease | null> {
	try {
		const response = await fetchImpl(
			'https://api.github.com/repos/spikonado/sprocket/releases/latest',
			{
				headers: {
					Accept: 'application/vnd.github+json',
					'User-Agent': 'spikonado.com'
				}
			}
		);

		if (!response.ok) {
			return null;
		}

		const data = (await response.json()) as GitHubRelease;
		const assets = parseSprocketDesktopAssets(data.assets);
		if (!data.tag_name || assets.length === 0) {
			return null;
		}

		const version = data.tag_name.replace(/^v/, '');

		return {
			version,
			tagName: data.tag_name,
			htmlUrl: data.html_url ?? SPROCKET_RELEASES_LATEST_URL,
			assets
		};
	} catch {
		return null;
	}
}
