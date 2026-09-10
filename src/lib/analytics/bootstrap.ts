import { PUBLIC_POSTHOG_KEY } from 'astro:env/client';
import posthog from 'posthog-js';
import { SECTION_VIEWED_EVENT, type AnalyticsProperties } from '@/lib/analytics/events';

const PH_CAPTURE_ATTR = 'data-ph-capture';
const PH_SECTION_ATTR = 'data-ph-section';
const PH_PROP_PREFIX = 'data-ph-';

let captureInstalled = false;
let posthogInitialized = false;

function propsFromElement(element: HTMLElement): AnalyticsProperties {
	const props: AnalyticsProperties = {};

	for (const attr of element.attributes) {
		if (!attr.name.startsWith(PH_PROP_PREFIX) || attr.name === PH_CAPTURE_ATTR) {
			continue;
		}
		const key = attr.name.slice(PH_PROP_PREFIX.length).replace(/-/g, '_');
		if (key) {
			props[key] = attr.value;
		}
	}

	return props;
}

function isSameTabNavigationHref(href: string | null): boolean {
	if (!href) {
		return false;
	}
	const normalizedHref = href.trim().toLowerCase();
	if (
		normalizedHref.startsWith('#') ||
		normalizedHref.startsWith('javascript:') ||
		normalizedHref.startsWith('data:') ||
		normalizedHref.startsWith('vbscript:')
	) {
		return false;
	}
	return true;
}

/** Capture after ensuring the SDK is initialized (survives same-tab navigation via beacon). */
export function captureAnalyticsEvent(
	event: string,
	properties?: AnalyticsProperties,
	options?: { sendInstantly?: boolean }
): void {
	if (!PUBLIC_POSTHOG_KEY?.trim()) {
		return;
	}

	initPostHogAnalytics();

	posthog.capture(
		event,
		properties,
		options?.sendInstantly ? { send_instantly: true, transport: 'sendBeacon' } : undefined
	);
}

function wireDelegatedClicks(): void {
	document.addEventListener(
		'click',
		(event) => {
			const target = event.target;
			if (!(target instanceof Element)) {
				return;
			}

			const el = target.closest<HTMLElement>(`[${PH_CAPTURE_ATTR}]`);
			if (!el) {
				return;
			}

			const eventName = el.getAttribute(PH_CAPTURE_ATTR)?.trim();
			if (!eventName) {
				return;
			}

			const props = propsFromElement(el);
			const href = el.getAttribute('href');
			if (href && props.href === undefined) {
				props.href = href;
			}

			// Plain primary clicks on same-tab links unload the document; beacon immediately.
			const modifiedClick =
				event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0;
			const navigatesAway =
				!modifiedClick &&
				el.tagName === 'A' &&
				isSameTabNavigationHref(href) &&
				el.getAttribute('target') !== '_blank';

			captureAnalyticsEvent(eventName, props, { sendInstantly: navigatesAway });
		},
		{ capture: true }
	);
}

function wireSectionViews(): void {
	const sections = document.querySelectorAll<HTMLElement>(`[${PH_SECTION_ATTR}]`);
	if (sections.length === 0 || typeof IntersectionObserver === 'undefined') {
		return;
	}

	const seen = new Set<string>();

	const observer = new IntersectionObserver(
		(entries) => {
			for (const entry of entries) {
				if (!entry.isIntersecting) {
					continue;
				}
				const el = entry.target;
				if (!(el instanceof HTMLElement)) {
					continue;
				}
				const section = el.getAttribute(PH_SECTION_ATTR)?.trim();
				if (!section || seen.has(section)) {
					continue;
				}
				seen.add(section);
				captureAnalyticsEvent(SECTION_VIEWED_EVENT, {
					section,
					path: window.location.pathname
				});
				observer.unobserve(el);
			}
		},
		{ threshold: 0.35, rootMargin: '0px 0px -10% 0px' }
	);

	for (const section of sections) {
		observer.observe(section);
	}
}

/** Attach conversion click capture (safe to call before or after init). */
export function installAnalyticsCapture(): void {
	if (captureInstalled || typeof document === 'undefined') {
		return;
	}
	if (!PUBLIC_POSTHOG_KEY?.trim()) {
		return;
	}

	captureInstalled = true;
	wireDelegatedClicks();
}

/**
 * Initialize PostHog immediately so conversion captures can use sendBeacon
 * before a same-tab navigation unloads the document.
 */
export function initPostHogAnalytics(): void {
	if (posthogInitialized) {
		return;
	}

	const posthogKey = PUBLIC_POSTHOG_KEY?.trim();
	if (!posthogKey) {
		return;
	}

	installAnalyticsCapture();

	posthog.init(posthogKey, {
		api_host: 'https://kpg.spikonado.com',
		ui_host: 'https://eu.posthog.com',
		defaults: '2026-01-30',
		person_profiles: 'identified_only',
		capture_exceptions: true,
		capture_performance: { web_vitals: true, network_timing: true },
		// Link same-origin API captures (newsletter) to browser sessions / replays.
		tracing_headers: [window.location.hostname],
		loaded: (client) => {
			client.register({
				site: 'spikonado_marketing',
				app_surface: 'website'
			});
		}
	});

	posthogInitialized = true;
	wireSectionViews();
}
