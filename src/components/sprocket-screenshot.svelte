<script lang="ts">
	import fallback from '@/assets/sprocket.webp';
	import { inertBackground, portal, trapFocus } from '@/lib/focus-trap';
	import { SPROCKET_IMAGE_REMOTE_URL } from '@/lib/sprocket-image';

	interface Props {
		class?: string;
		alt?: string;
	}

	let {
		class: className = 'h-auto w-full',
		alt = 'Sprocket engineering agent interface showing multi-step work across a project'
	}: Props = $props();

	let src = $state(SPROCKET_IMAGE_REMOTE_URL);
	let usingFallback = $state(false);
	let open = $state(false);
	let dialog: HTMLDivElement | undefined = $state();
	let trigger: HTMLButtonElement | undefined = $state();

	function handleError() {
		if (usingFallback) {
			return;
		}
		usingFallback = true;
		src = fallback.src;
	}

	function openLightbox() {
		open = true;
	}

	function closeLightbox() {
		open = false;
	}

	$effect(() => {
		if (!open || !dialog) {
			return;
		}

		const previousOverflow = document.body.style.overflow;
		document.body.style.overflow = 'hidden';
		// Dialog is portaled to body, so page chrome can safely be inert for SR browse mode.
		const releaseBackground = inertBackground(dialog);
		const releaseFocus = trapFocus(dialog);

		const onKeyDown = (event: KeyboardEvent) => {
			if (event.key === 'Escape') {
				closeLightbox();
			}
		};
		window.addEventListener('keydown', onKeyDown);

		return () => {
			document.body.style.overflow = previousOverflow;
			releaseBackground();
			releaseFocus();
			window.removeEventListener('keydown', onKeyDown);
		};
	});
</script>

<button
	bind:this={trigger}
	type="button"
	class="block w-full cursor-zoom-in border-0 bg-transparent p-0 text-left"
	aria-label="View Sprocket screenshot full size"
	onclick={openLightbox}
>
	<img
		{src}
		{alt}
		class={className}
		loading="lazy"
		decoding="async"
		referrerpolicy="no-referrer"
		onerror={handleError}
	/>
</button>

{#if open}
	<div
		bind:this={dialog}
		use:portal
		class="fixed inset-0 z-100 flex items-center justify-center p-4 sm:p-8"
		role="dialog"
		aria-modal="true"
		aria-label="Sprocket screenshot"
		tabindex="-1"
	>
		<button
			type="button"
			class="absolute inset-0 bg-ink/90"
			aria-label="Close full size image"
			onclick={closeLightbox}
		></button>

		<button
			type="button"
			class="absolute top-4 right-4 z-10 inline-flex h-10 w-10 items-center justify-center rounded-full border border-white/20 bg-ink/60 text-white transition-colors hover:bg-ink/80 focus-visible:ring-2 focus-visible:ring-white/50 focus-visible:outline-none"
			aria-label="Close full size image"
			onclick={closeLightbox}
		>
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
		</button>

		<img
			{src}
			{alt}
			class="relative z-10 max-h-[min(92svh,100%)] max-w-full rounded-lg object-contain shadow-2xl"
			referrerpolicy="no-referrer"
			onerror={handleError}
		/>
	</div>
{/if}
