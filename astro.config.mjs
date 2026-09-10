// @ts-check

import { defineConfig, fontProviders } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	site: 'https://spikonado.com',
	integrations: [
		sitemap({
			filter: (page) => !page.includes('/api/')
		}),
		svelte()
	],
	adapter: vercel(),
	// Satori cannot read woff2; these static faces are only for prerendered OG images.
	fonts: [
		{
			provider: fontProviders.fontsource(),
			name: 'IBM Plex Sans',
			cssVariable: '--font-ibm-plex-sans-og',
			weights: [400, 600],
			styles: ['normal'],
			subsets: ['latin'],
			formats: ['woff']
		}
	],

	vite: {
		plugins: [tailwindcss()]
	}
});
