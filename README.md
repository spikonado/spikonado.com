# [spikonado.com](https://spikonado.com)

## Running Locally

### Nix

Install Nix: https://nixos.org/nix/download.html

#### 1. Clone the repository

```bash
git clone https://github.com/spikonado/spikonado.com.git
cd spikonado.com
```

#### 2. Activate the nix environment

```bash
nix develop
```

#### 3. Start the website

```bash
bun install
bun dev
```

## Analytics

PostHog autocapture records clicks, pageviews, and outbound links. Tag a page region with `data-ph-capture-attribute-section="<name>"` so its clicks carry a `section` property. Regions inside `<main>` also send `section_viewed`. Add custom events to `src/lib/analytics/events.ts` and send them with `track()` in the browser or `trackServerEvent()` in API routes.

Environment:

- `PUBLIC_POSTHOG_KEY`: the PostHog project token.
- `POSTHOG_PERSONAL_API_KEY` and `POSTHOG_PROJECT_ID`: build-time only. When both are set, the build uploads source maps for error tracking. The key needs write access to error tracking.

## Pricing checkout

`/pricing` reads plans and Dodo prices from the Sprocket Convex deployment, signs users in with WorkOS AuthKit, and redirects to Dodo hosted checkout.

`src/lib/convex/api.ts` types the backend functions the site calls. Update it by hand when their signatures change in `spikonado/sprocket` ([Convex multiple repos](https://docs.convex.dev/production/multiple-repos)).

Environment:

- `PUBLIC_CONVEX_URL`: the Sprocket Convex deployment. It also selects the Dodo test or live mode.
- `WORKOS_API_KEY`: server-only key for the WorkOS environment that deployment uses.
- `WORKOS_COOKIE_PASSWORD`: server-only secret of at least 32 characters (`openssl rand -base64 32`). Keep it stable across deployments, because changing it signs everyone out.

In WorkOS, register `/pricing/callback` as a Redirect URI, `/api/pricing/sign-in` as the Initiate login URI, and `/pricing` as a Sign-out URI.

Dodo's **Allow Multiple Subscriptions** setting must be off. The website does not block purchases based on subscription status.
