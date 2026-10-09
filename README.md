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

## Pricing checkout

`/pricing` uses BillingSDK's source-installed pricing table, the Sprocket Convex deployment, WorkOS AuthKit, and Dodo hosted checkout.

Plan allowances and Dodo prices are read live from Sprocket via `pricing:getPublicCatalog`. The checked-in typed API lives at `src/lib/convex/api.ts` ([Convex multiple repos](https://docs.convex.dev/production/multiple-repos)).

Plan-specific model-access copy comes from the operator-owned catalog `features`; the website does not invent model names or assume equal access across tiers.

Generate from the checked-out backend's registered validators and pin its actual
commit. Push that backend commit before this website so CI can fetch the pin:

```bash
bun run sync:convex-api --source /path/to/sprocket-worktree
bun run sync:convex-api --check --source /path/to/sprocket-worktree
```

Set `PUBLIC_CONVEX_URL` and `PUBLIC_DODO_CHECKOUT_MODE` (`test` or `live`) to match the backend deployment. Checkout and recovered links validate the mode returned by the backend before redirecting. Returning from or reloading an unpaid checkout offers **Continue checkout** using the same account-owned hosted link.

Set server-only `WORKOS_API_KEY` for the WorkOS environment selected by that deployment's `WORKOS_CLIENT_ID`, and `WORKOS_COOKIE_PASSWORD` to a random secret of at least 32 characters. Keep the password stable across deployments and instances. Generate it with `openssl rand -base64 32`. Use separate secrets for Preview and Production, then redeploy. Never prefix these secrets with `PUBLIC_`.

Register the website's `/pricing/callback` URL in WorkOS Redirects, `/api/pricing/sign-in` as its Initiate login URI, and `/pricing` as an allowed Sign-out URI. No custom WorkOS domain or browser CORS allowlist is needed. Remove the old `PUBLIC_WORKOS_DEV_MODE` and `PUBLIC_WORKOS_API_HOSTNAME` settings.

Vercel exchanges and refreshes tokens server-side using an encrypted, host-only HttpOnly cookie with 30-day browser retention. WorkOS's session lifetime and inactivity limits still apply. The browser holds only a short-lived Convex access token in memory. Failed session restoration stops checkout resumption instead of starting another sign-in.

Merchant settings, deployment order, and launch tests are maintained in the Sprocket project artifact **Dodo dashboard setup for Sprocket** (`ks74f9xxtjp9hmgj0ackvxk9698f0f2g`). Dodo's **Allow Multiple Subscriptions** setting must be off; the website does not locally gate purchases by subscription status.

Regenerate the contract when public signatures change and commit both `src/lib/convex/api.ts` and `billing-contract.json`. Without `--source`, the command renders only the existing pinned snapshot; `--prod` is not supported.
