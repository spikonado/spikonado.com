/** Shared PostHog event names and property contracts for the marketing site. */

/** Desktop download CTA (primary or alternate platform). */
export const SPROCKET_DOWNLOAD_CLICKED_EVENT = 'sprocket_download_clicked';

/** User copied the `npx` install command. */
export const INSTALL_COMMAND_COPIED_EVENT = 'install_command_copied';

/** Named marketing CTA (nav, hero links, product learn-more, etc.). */
export const CTA_CLICKED_EVENT = 'cta_clicked';

/** Outbound link to GitHub, social, npm, etc. */
export const EXTERNAL_LINK_CLICKED_EVENT = 'external_link_clicked';

/** Key homepage/product section entered the viewport (once per page load). */
export const SECTION_VIEWED_EVENT = 'section_viewed';

/** Product screenshot lightbox opened. */
export const PRODUCT_MEDIA_OPENED_EVENT = 'product_media_opened';

/** Newsletter / build-log subscription form submitted (before server response). */
export const NEWSLETTER_SUBSCRIBE_SUBMITTED_EVENT = 'newsletter_subscribe_submitted';

/** PostHog event when a build-log / newsletter subscription succeeds. */
export const NEWSLETTER_SUBSCRIBED_EVENT = 'newsletter_subscribed';

/** PostHog event when a build-log / newsletter subscription fails. */
export const NEWSLETTER_SUBSCRIBE_FAILED_EVENT = 'newsletter_subscribe_failed';

export const NEWSLETTER_FORM = 'build_log' as const;

/** Placement of an interactive element on the page. */
export type AnalyticsLocation =
	| 'navbar'
	| 'navbar_mobile'
	| 'home_hero'
	| 'home_sprocket'
	| 'home_platform'
	| 'home_vario'
	| 'home_build_log'
	| 'sprocket_page'
	| 'footer'
	| 'privacy';

export type AnalyticsProperties = Record<string, string | number | boolean | null | undefined>;
