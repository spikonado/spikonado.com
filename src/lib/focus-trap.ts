const FOCUSABLE_SELECTOR = [
	'a[href]',
	'button:not([disabled])',
	'textarea:not([disabled])',
	'input:not([disabled])',
	'select:not([disabled])',
	'[tabindex]:not([tabindex="-1"])'
].join(',');

function getFocusable(container: HTMLElement): HTMLElement[] {
	return [...container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)].filter(
		(element) => element.offsetParent !== null || element === document.activeElement
	);
}

/** Trap focus inside a modal container and restore it when disposed. */
export function trapFocus(container: HTMLElement): () => void {
	const previouslyFocused =
		document.activeElement instanceof HTMLElement ? document.activeElement : null;

	if (!container.hasAttribute('tabindex')) {
		container.tabIndex = -1;
	}

	const focusable = getFocusable(container);
	(focusable[0] ?? container).focus({ preventScroll: true });

	const onKeyDown = (event: KeyboardEvent) => {
		if (event.key !== 'Tab') {
			return;
		}

		const items = getFocusable(container);
		if (items.length === 0) {
			event.preventDefault();
			container.focus({ preventScroll: true });
			return;
		}

		const first = items[0];
		const last = items[items.length - 1];

		if (event.shiftKey) {
			if (document.activeElement === first || document.activeElement === container) {
				event.preventDefault();
				last.focus();
			}
			return;
		}

		if (document.activeElement === last) {
			event.preventDefault();
			first.focus();
		}
	};

	container.addEventListener('keydown', onKeyDown);

	return () => {
		container.removeEventListener('keydown', onKeyDown);
		previouslyFocused?.focus({ preventScroll: true });
	};
}
