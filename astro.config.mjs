// @ts-check

import { defineConfig } from 'astro/config';
import mdx from '@astrojs/mdx';
import sitemap from '@astrojs/sitemap';
import svelte from '@astrojs/svelte';
import tailwindcss from '@tailwindcss/vite';
import vercel from '@astrojs/vercel';

// https://astro.build/config
export default defineConfig({
	site: 'https://spikonado.com',
	integrations: [mdx(), sitemap(), svelte()],
	adapter: vercel(),

	vite: {
		plugins: [tailwindcss()],
		resolve: {
			noExternal: ['@lucide/svelte', 'bits-ui', 'runed', 'svelte-toolbelt']
		}
	}
});
