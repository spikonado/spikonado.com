<script lang="ts">
	import { resolve } from '$app/paths';
	import logo from '$lib/assets/logo.png';
	import github_logo from '$lib/assets/github_logo.svg';
	import x_logo from '$lib/assets/x_logo.svg';
	import youtube_logo from '$lib/assets/youtube_logo.svg';
	import instagram_logo from '$lib/assets/instagram_logo.svg';
	import facebook_logo from '$lib/assets/facebook_logo.svg';
	import { cn } from '$lib/utils';
	import { marketingSectionOverlayClass, marketingSectionShellClass } from '$lib/styles/marketing';

	const companyLinks = [
		{ label: 'About', path: '/' },
		{ label: 'Privacy Policy', path: '/' },
		{ label: 'Terms of Service', path: '/' }
	] as const;

	const socialLinks = [
		{ label: 'GitHub', href: 'https://github.com/spikonado', src: github_logo },
		{ label: 'X', href: 'https://x.com/spikonado', src: x_logo },
		{ label: 'YouTube', href: 'https://youtube.com/spikonado', src: youtube_logo },
		{ label: 'Instagram', href: 'https://instagram.com/spikonado', src: instagram_logo },
		{ label: 'Facebook', href: 'https://facebook.com/spikonado', src: facebook_logo }
	] as const;

	const columnBaseClass = 'flex flex-col items-center gap-4 md:items-start';
</script>

<footer
	class={cn(
		marketingSectionShellClass,
		'flex min-h-[60vh] flex-col justify-between border-t px-6 pt-20 pb-12 sm:px-8 sm:pt-24'
	)}
>
	<!-- Background Decorations -->
	<div class={marketingSectionOverlayClass}></div>

	<div
		class="relative mx-auto grid w-full max-w-7xl grid-cols-1 gap-12 text-center md:grid-cols-[minmax(0,2fr)_minmax(14rem,1fr)] md:gap-16 md:text-left"
	>
		<!-- Brand Section -->
		<div class={columnBaseClass}>
			<a
				href={resolve('/')}
				class="flex items-center gap-2 transition-transform duration-150 hover:scale-105"
			>
				<img loading="lazy" src={logo} alt="Spikonado" class="h-8 w-8" />
				<span class="font-serif text-2xl tracking-tight text-foreground"> Spikonado </span>
			</a>
			<p class="text-muted-foreground">
				Empowering creators, learners, and researchers with mind-blowing open-source hardware and
				software.
			</p>
		</div>

		<!-- Navigation Section -->
		<div class={columnBaseClass}>
			<h3 class="text-sm font-semibold tracking-wider text-muted-foreground/50 uppercase">
				Company
			</h3>
			<ul class="space-y-2">
				{#each companyLinks as link (link.label)}
					<li>
						<a href={resolve(link.path)} class="text-foreground hover:text-muted-foreground">
							{link.label}
						</a>
					</li>
				{/each}
			</ul>
		</div>
	</div>

	<div
		class="relative mx-auto mt-12 flex w-full max-w-7xl flex-col items-center justify-between gap-4 border-t border-border/10 pt-12 text-sm text-muted-foreground md:flex-row"
	>
		<p>&copy; {new Date().getFullYear()} Spikonado Technologies</p>
		<div class="flex items-center gap-6">
			<!-- eslint-disable svelte/no-navigation-without-resolve -->
			{#each socialLinks as link (link.label)}
				<a
					href={link.href}
					target="_blank"
					rel="noopener noreferrer"
					class="transition-transform duration-150 hover:scale-105"
				>
					<img loading="lazy" src={link.src} alt={link.label} class="h-6" />
				</a>
			{/each}
			<!-- eslint-enable svelte/no-navigation-without-resolve -->
		</div>
	</div>
</footer>
