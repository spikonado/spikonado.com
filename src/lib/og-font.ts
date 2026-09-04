export const OG_FONT_CSS_VARIABLE = '--font-ibm-plex-sans-og';

export type OgFontFace = {
	weight?: string;
	src: Array<{ url: string; format?: string }>;
};

/** Prefer the Satori-safe woff face for a configured weight. */
export function pickOgFontUrl(faces: OgFontFace[] | undefined, weight: 400 | 600): string {
	if (!faces?.length) {
		throw new Error(`Fonts API: no data for ${OG_FONT_CSS_VARIABLE}`);
	}

	const weightStr = String(weight);
	const face = faces.find((candidate) => candidate.weight === weightStr);
	if (!face) {
		throw new Error(`Fonts API: no IBM Plex Sans face for weight ${weight}`);
	}

	const source = face.src.find((entry) => entry.format === 'woff') ?? face.src[0];
	if (!source?.url) {
		throw new Error(`Fonts API: missing source for IBM Plex Sans ${weight}`);
	}

	return source.url;
}
