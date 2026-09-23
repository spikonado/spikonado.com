// @ts-check

import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	site: 'https://spikonado.com',
	// No Astro.session usage on this site, so leave the session runtime out of the SSR bundle.
	session: false,
	integrations: [
		sitemap({
			filter: (page) => !page.includes('/api/')
		}),
		svelte()
	],
	adapter: vercel(),

	vite: {
		plugins: [tailwindcss()]
	}
});
