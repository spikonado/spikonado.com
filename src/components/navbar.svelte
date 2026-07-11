<script lang="ts">
	import logo from '@/assets/logo.png';
	import github from '@/assets/github_logo.svg';
	import { marketingBrandClass } from '@/styles/marketing';
	import { cn } from '@/utils';
</script>

<header class="fixed top-0 z-50 h-14 w-full bg-background/80 backdrop-blur-md">
	<div
		class="relative mx-auto flex h-full max-w-screen-2xl items-center justify-between px-4 sm:px-8"
	>
		<a
			href="/"
			class="group flex items-center space-x-2 transition-transform duration-150 hover:scale-[1.02]"
		>
			<img src={logo.src} alt="Spikonado" class="h-8 w-8" />
			<span class={cn(marketingBrandClass, 'hidden text-2xl sm:block')}> Spikonado </span>
		</a>

		<a
			href="https://github.com/spikonado"
			target="_blank"
			rel="noopener noreferrer"
			class="flex items-center"
		>
			<img
				loading="lazy"
				src={github.src}
				alt="GitHub"
				class="h-8 w-8 transition-transform duration-150 hover:scale-105"
			/>
		</a>
	</div>
</header>
