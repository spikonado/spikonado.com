<script lang="ts">
	import { resolve } from '$app/paths';
	import * as NavigationMenu from '$lib/components/ui/navigation-menu/index.js';
	import logo from '$lib/assets/logo.png';
	import github from '$lib/assets/github_logo.svg';
</script>

<header class="fixed top-0 z-50 h-14 w-full bg-background/80 backdrop-blur-md">
	<div
		class="relative mx-auto flex h-full max-w-screen-2xl items-center justify-between px-4 sm:px-8"
	>
		<a
			href={resolve('/')}
			class="group flex items-center space-x-2 transition-transform duration-150 hover:scale-102"
		>
			<img src={logo} alt="Spikonado" class="h-8 w-8" />
			<span class="hidden font-serif text-2xl tracking-tight text-foreground sm:block">
				Spikonado
			</span>
		</a>

		<div class="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2">
			<NavigationMenu.Root>
				<NavigationMenu.List class="flex items-center gap-6">
					<NavigationMenu.Item>
						<NavigationMenu.Link
							href={resolve('/')}
							class="text-base text-foreground hover:bg-transparent hover:text-muted-foreground focus:bg-transparent sm:text-lg"
						>
							About
						</NavigationMenu.Link>
					</NavigationMenu.Item>
				</NavigationMenu.List>
			</NavigationMenu.Root>
		</div>

		<a
			href="https://github.com/spikonado"
			target="_blank"
			rel="noopener noreferrer"
			class="flex items-center"
		>
			<img
				loading="lazy"
				src={github}
				alt="GitHub"
				class="h-8 w-8 transition-transform duration-150 hover:scale-105"
			/>
		</a>
	</div>
</header>
