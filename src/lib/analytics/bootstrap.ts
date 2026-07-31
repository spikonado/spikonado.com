import posthog from 'posthog-js';
import { SECTION_VIEWED_EVENT, type AnalyticsProperties } from '@/lib/analytics/events';

const PH_CAPTURE_ATTR = 'data-ph-capture';
const PH_SECTION_ATTR = 'data-ph-section';
const PH_PROP_PREFIX = 'data-ph-';

type PendingCapture = {
	event: string;
	properties?: AnalyticsProperties;
};

let captureInstalled = false;
let posthogInitialized = false;
const pendingCaptures: PendingCapture[] = [];

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

/** Capture now, or queue until `initPostHogAnalytics` finishes. */
export function captureAnalyticsEvent(event: string, properties?: AnalyticsProperties): void {
	if (!import.meta.env.PUBLIC_POSTHOG_KEY?.trim()) {
		return;
	}

	if (posthogInitialized) {
		posthog.capture(event, properties);
		return;
	}

	pendingCaptures.push({ event, properties });
}

function flushPendingCaptures(): void {
	while (pendingCaptures.length > 0) {
		const next = pendingCaptures.shift();
		if (!next) {
			break;
		}
		posthog.capture(next.event, next.properties);
	}
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

			captureAnalyticsEvent(eventName, props);
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

/**
 * Attach conversion click capture immediately (before idle PostHog init).
 * Early clicks are queued until `initPostHogAnalytics` runs.
 */
export function installAnalyticsCapture(): void {
	if (captureInstalled || typeof document === 'undefined') {
		return;
	}
	if (!import.meta.env.PUBLIC_POSTHOG_KEY?.trim()) {
		return;
	}

	captureInstalled = true;
	wireDelegatedClicks();
}

/** Initialize PostHog, flush any queued early conversions, then wire section views. */
export function initPostHogAnalytics(): void {
	const posthogKey = import.meta.env.PUBLIC_POSTHOG_KEY?.trim();
	if (!posthogKey) {
		pendingCaptures.length = 0;
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
	flushPendingCaptures();
	wireSectionViews();
}
