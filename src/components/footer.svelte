<script lang="ts">
	import logo from '@/assets/logo.png';
	import github_logo from '@/assets/github_logo.svg';
	import x_logo from '@/assets/x_logo.svg';
	import youtube_logo from '@/assets/youtube_logo.svg';
	import instagram_logo from '@/assets/instagram_logo.svg';
	import facebook_logo from '@/assets/facebook_logo.svg';
	import { cn } from '@/utils';
	import {
		marketingBrandClass,
		marketingSectionBodyClass,
		marketingSectionOverlayClass,
		marketingSectionShellClass
	} from '@/styles/marketing';

	const productLinks = [
		{ label: 'Sprocket', path: '/#sprocket' },
		{ label: 'Vario', path: '/#vario' }
	] as const;

	const companyLinks = [
		{ label: 'Privacy Policy', path: '/' },
		{ label: 'Terms of Service', path: '/' }
	] as const;

	const socialLinks = [
		{ label: 'GitHub', href: 'https://github.com/spikonado', src: github_logo.src },
		{ label: 'X', href: 'https://x.com/spikonado', src: x_logo.src },
		{ label: 'YouTube', href: 'https://youtube.com/spikonado', src: youtube_logo.src },
		{ label: 'Instagram', href: 'https://instagram.com/spikonado', src: instagram_logo.src },
		{ label: 'Facebook', href: 'https://facebook.com/spikonado', src: facebook_logo.src }
	] as const;

	const linkListClass = 'space-y-3';
	const linkClass =
		'font-sans text-lg text-foreground transition-colors hover:text-muted-foreground md:text-xl';
	const columnLabelClass =
		'font-sans text-sm font-medium tracking-wide text-muted-foreground uppercase';
</script>

<footer
	class={cn(
		marketingSectionShellClass,
		'flex min-h-[60vh] flex-col justify-between border-t px-6 pt-24 pb-12 sm:px-8 sm:pt-28'
	)}
>
	<div class={marketingSectionOverlayClass}></div>

	<div
		class="relative mx-auto grid w-full max-w-7xl grid-cols-1 gap-16 text-center md:grid-cols-[minmax(0,2fr)_minmax(12rem,1fr)_minmax(12rem,1fr)] md:gap-20 md:text-left"
	>
		<div class="flex flex-col items-center gap-6 md:items-start">
			<a
				href="/"
				class="flex items-center gap-3 transition-transform duration-150 hover:scale-105"
			>
				<img loading="lazy" src={logo.src} alt="Spikonado" class="h-9 w-9" />
				<span class={cn(marketingBrandClass, 'text-3xl')}>Spikonado</span>
			</a>
			<p class={marketingSectionBodyClass}>
				Everyone should be able to build their own robots as fast as possible.
			</p>
		</div>

		<div class="flex flex-col items-center gap-5 md:items-start">
			<h3 class={columnLabelClass}>Products</h3>
			<ul class={linkListClass}>
				{#each productLinks as link (link.label)}
					<li>
						<a href={link.path} class={cn(linkClass, 'font-brand')}>{link.label}</a>
					</li>
				{/each}
			</ul>
		</div>

		<div class="flex flex-col items-center gap-5 md:items-start">
			<h3 class={columnLabelClass}>Company</h3>
			<ul class={linkListClass}>
				{#each companyLinks as link (link.label)}
					<li>
						<a href={link.path} class={linkClass}>{link.label}</a>
					</li>
				{/each}
			</ul>
		</div>
	</div>

	<div
		class="relative mx-auto mt-20 flex w-full max-w-7xl flex-col items-center justify-between gap-6 border-t border-border/10 pt-10 text-base text-muted-foreground md:flex-row md:pt-12"
	>
		<p class="font-sans">&copy; {new Date().getFullYear()} Spikonado</p>
		<div class="flex items-center gap-7">
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			{#each socialLinks as link (link.label)}
				<a
					href={link.href}
					target="_blank"
					rel="noopener noreferrer"
					class="transition-transform duration-150 hover:scale-105"
				>
					<img loading="lazy" src={link.src} alt={link.label} class="h-8 w-8" />
				</a>
			{/each}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</div>
</footer>
