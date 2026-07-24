<script lang="ts">
	import logo from '@/assets/logo.png';
	import github from '@/assets/github_logo.svg';
	import { marketingBrandClass, marketingButtonPrimaryClass } from '@/styles/marketing';
	import { cn } from '@/utils';

	const navLinks = [
		{ label: 'Sprocket', href: '/sprocket' },
		{ label: 'Vario', href: '/#vario' },
		{ label: 'Build log', href: '/#build-log' }
	] as const;

	let menuOpen = $state(false);

	function closeMenu() {
		menuOpen = false;
	}

	function toggleMenu() {
		menuOpen = !menuOpen;
	}

	$effect(() => {
		if (!menuOpen) {
			return;
		}

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				closeMenu();
			}
		};

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		window.addEventListener('keydown', onKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			window.removeEventListener('keydown', onKeyDown);
		};
	});
</script>

<header class="fixed top-0 z-50 w-full border-b border-border/40 bg-background/80 backdrop-blur-md">
	<div
		class="relative mx-auto flex h-14 max-w-6xl items-center justify-between gap-3 px-4 sm:px-6 lg:px-8"
	>
		<a
			href="/"
			class="group flex min-w-0 items-center gap-2 transition-transform duration-150 hover:scale-[1.02]"
			onclick={closeMenu}
		>
			<img src={logo.src} alt="" class="h-8 w-8 shrink-0" />
			<span class={cn(marketingBrandClass, 'truncate text-xl sm:text-2xl')}>Spikonado</span>
		</a>

		<nav
			class="absolute left-1/2 hidden -translate-x-1/2 items-center gap-6 md:flex"
			aria-label="Primary"
		>
			{#each navLinks as link (link.label)}
				<a
					href={link.href}
					class="font-sans text-sm font-medium text-muted-foreground transition-colors hover:text-foreground"
				>
					{link.label}
				</a>
			{/each}
		</nav>

		<div class="flex shrink-0 items-center gap-2 sm:gap-3">
			<a
				href="https://github.com/spikonado"
				target="_blank"
				rel="noopener noreferrer"
				class="hidden items-center gap-2 rounded-lg border border-border bg-surface px-2.5 py-1.5 font-sans text-sm font-medium text-foreground shadow-sm transition-colors hover:bg-accent-soft md:inline-flex"
			>
				<img src={github.src} alt="" class="h-4 w-4" />
				<span>GitHub</span>
			</a>
			<a
				href="/#sprocket"
				class={cn(marketingButtonPrimaryClass, 'hidden text-sm whitespace-nowrap md:inline-flex')}
			>
				Start building
			</a>

			<button
				type="button"
				class="inline-flex h-10 w-10 items-center justify-center rounded-lg border border-border bg-surface text-foreground transition-colors hover:bg-accent-soft focus-visible:ring-2 focus-visible:ring-ring/50 focus-visible:outline-none md:hidden"
				aria-label={menuOpen ? 'Close menu' : 'Open menu'}
				aria-expanded={menuOpen}
				aria-controls="mobile-nav"
				onclick={toggleMenu}
			>
				{#if menuOpen}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						class="h-5 w-5"
						aria-hidden="true"
					>
						<path d="M6 6l12 12M18 6L6 18" />
					</svg>
				{:else}
					<svg
						xmlns="http://www.w3.org/2000/svg"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						class="h-5 w-5"
						aria-hidden="true"
					>
						<path d="M4 7h16M4 12h16M4 17h16" />
					</svg>
				{/if}
			</button>
		</div>
	</div>

	{#if menuOpen}
		<div
			id="mobile-nav"
			class="border-t border-border/40 bg-background md:hidden"
			role="dialog"
			aria-modal="true"
			aria-label="Site navigation"
		>
			<nav class="mx-auto flex max-w-6xl flex-col gap-1 px-4 py-4 sm:px-6" aria-label="Mobile">
				{#each navLinks as link (link.label)}
					<a
						href={link.href}
						class="rounded-xl px-3 py-3 font-sans text-base font-medium text-foreground transition-colors hover:bg-accent-soft"
						onclick={closeMenu}
					>
						{link.label}
					</a>
				{/each}

				<div class="mt-3 flex flex-col gap-3 border-t border-border/50 pt-4">
					<a
						href="https://github.com/spikonado"
						target="_blank"
						rel="noopener noreferrer"
						class="inline-flex items-center justify-center gap-2 rounded-xl border border-border bg-surface px-4 py-3 font-sans text-base font-medium text-foreground transition-colors hover:bg-accent-soft"
						onclick={closeMenu}
					>
						<img src={github.src} alt="" class="h-5 w-5" />
						<span>GitHub</span>
					</a>
					<a
						href="/#sprocket"
						class={cn(marketingButtonPrimaryClass, 'w-full py-3 text-base')}
						onclick={closeMenu}
					>
						Start building
					</a>
				</div>
			</nav>
		</div>
	{/if}
</header>
