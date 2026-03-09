<script lang="ts">
	import { onMount, onDestroy } from 'svelte';
	import { fly } from 'svelte/transition';
	import { cubicOut } from 'svelte/easing';

	interface Props {
		words: string[];
		interval: number;
		class?: string;
	}

	let { words, interval, class: className = '' }: Props = $props();

	let currentIndex = $state(0);
	let queue = $state<number[]>([]);
	let intervalId: ReturnType<typeof setInterval>;

	// Find longest word to maintain container width
	const longestWord = $derived(
		words.length > 0 ? [...words].sort((a, b) => b.length - a.length)[0] : ''
	);

	function shuffle(array: number[]) {
		for (let i = array.length - 1; i > 0; i--) {
			const j = Math.floor(Math.random() * (i + 1));
			[array[i], array[j]] = [array[j], array[i]];
		}
		return array;
	}

	function rotateWord() {
		if (words.length <= 1) return;

		// Refill queue if empty
		if (queue.length === 0) {
			const indices = Array.from({ length: words.length }, (_, i) => i);
			shuffle(indices);

			// Avoid immediate repetition (back-to-back duplicates)
			if (indices[0] === currentIndex) {
				const last = indices.length - 1;
				[indices[0], indices[last]] = [indices[last], indices[0]];
			}
			queue = indices;
		}

		const next = queue.shift();
		if (next !== undefined) {
			currentIndex = next;
		}
	}

	$effect(() => {
		// Reset queue if words array changes drastically (length check is a simple proxy)
		// and ensure currentIndex is valid
		if (currentIndex >= words.length) {
			currentIndex = 0;
			queue = [];
		}
	});

	onMount(() => {
		// Initial setup:
		// We start with one word displayed (currentIndex 0).
		// The queue should contain ALL OTHER words to satisfy "show every word at least once".
		const remainingIndices = Array.from({ length: words.length }, (_, i) => i).filter(
			(i) => i !== currentIndex
		);
		queue = shuffle(remainingIndices);

		intervalId = setInterval(rotateWord, interval);
	});

	onDestroy(() => {
		if (intervalId) clearInterval(intervalId);
	});
</script>

<div class="relative inline-grid {className}">
	{#key currentIndex}
		<span
			class="col-start-1 row-start-1"
			in:fly={{ y: 20, duration: 300, easing: cubicOut }}
			out:fly={{ y: -20, duration: 300, easing: cubicOut }}
		>
			{words[currentIndex] ?? ''}
		</span>
	{/key}
	<!-- Invisible placeholder to maintain width -->
	<span class="pointer-events-none invisible col-start-1 row-start-1 opacity-0 select-none">
		{longestWord}
	</span>
</div>
