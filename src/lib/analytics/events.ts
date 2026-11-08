/** Every custom PostHog event and its properties. Autocapture covers plain clicks. */
export type AnalyticsEvents = {
	section_viewed: { section: string };
	sprocket_download_clicked: {
		variant: 'primary' | 'alternate' | 'all_releases';
		platform: string;
		filename?: string;
		release_tag?: string;
	};
	install_command_copied: { command: string };
	product_media_opened: { media: 'sprocket_screenshot' };
	newsletter_subscribe_submitted: Record<string, never>;
	newsletter_subscribed: Record<string, never>;
	newsletter_subscribe_failed: { reason: string; source: 'client' | 'server' };
};

export type AnalyticsEvent = keyof AnalyticsEvents;
