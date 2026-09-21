// @ts-check

import { defineConfig } from 'astro/config';
import react from '@astrojs/react';
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
		react(),
		svelte()
	],
	adapter: vercel(),

	vite: {
		plugins: [tailwindcss()]
	}
});
