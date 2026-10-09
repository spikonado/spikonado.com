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
	fonts: [
		{
			provider: fontProviders.fontsource(),
			name: 'DM Sans',
			cssVariable: '--font-dm-sans',
			weights: ['100 1000'],
			styles: ['normal'],
			subsets: ['latin']
		},
		{
			provider: fontProviders.fontsource(),
			name: 'IBM Plex Sans',
			cssVariable: '--font-ibm-plex-sans',
			weights: ['100 700'],
			styles: ['normal'],
			subsets: ['latin']
		},
		{
			provider: fontProviders.fontsource(),
			name: 'IBM Plex Mono',
			cssVariable: '--font-ibm-plex-mono',
			weights: [400, 500],
			styles: ['normal'],
			subsets: ['latin'],
			fallbacks: ['monospace']
		}
	],

	vite: {
		plugins: [tailwindcss()]
	}
});
