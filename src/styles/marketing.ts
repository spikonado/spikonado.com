// Shared surface styling for full-width marketing sections and the footer shell.
export const marketingSectionShellClass = 'relative overflow-hidden bg-background border-border/10';

// Decorative top-to-bottom wash used behind section content.
export const marketingSectionOverlayClass =
	'pointer-events-none absolute inset-0 bg-linear-to-b from-blue-500/5 to-transparent';

const marketingHeadingBaseClass =
	'text-6xl font-normal leading-[1.05] tracking-tight text-foreground md:text-7xl lg:text-8xl';

// Large sans heading used for the homepage hero.
export const marketingSectionHeadingClass = `font-sans ${marketingHeadingBaseClass}`;

// Product titles (Sprocket, Vario) share the brand typeface.
export const marketingProductHeadingClass = `font-brand ${marketingHeadingBaseClass}`;

// Shared supporting copy style for the homepage and footer.
export const marketingSectionBodyClass =
	'max-w-3xl text-xl leading-relaxed text-muted-foreground md:text-2xl';

// Spacing for a block of supporting copy under a marketing heading.
export const marketingSectionBodyStackClass = 'mt-8 space-y-3';

// Blue treatment for emphasized words in marketing headlines.
export const marketingAccentTextClass = 'text-blue-400';

// Blue underline treatment for emphasized body phrases.
export const marketingAccentEmphClass = `${marketingAccentTextClass} font-medium underline`;

// Brand wordmark used in the navbar and footer.
export const marketingBrandClass = 'font-brand font-normal tracking-tight text-foreground';
