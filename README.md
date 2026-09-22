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

`/pricing` uses BillingSDK's source-installed pricing table, the Sprocket Convex deployment, WorkOS AuthKit, and Dodo overlay checkout.

Plan allowances and Dodo prices are read live from Sprocket via `pricing:getPublicCatalog`. The checked-in typed API lives at `src/lib/convex/api.ts` ([Convex multiple repos](https://docs.convex.dev/production/multiple-repos)).

Refresh a full deployment dump (gitignored) after Sprocket Convex deploys, then update the curated `api.ts` surface if signatures changed:

```bash
bun run sync:convex-api
# or: bun run sync:convex-api -- --prod
```

Release checklist (Sprocket Convex + WorkOS + Dodo):

1. Create the recurring products in Dodo. Set each product ID on its Convex `tiers` row as `monthlyProductId` or `annualProductId`. Every tier row becomes a pricing card, and an omitted product makes that interval unavailable.
2. Set Convex env: `DODO_PAYMENTS_API_KEY`, `DODO_PAYMENTS_ENVIRONMENT`, `DODO_PAYMENTS_WEBHOOK_SECRET`, `SPROCKET_MARKETING_ORIGIN=https://spikonado.com`, `WORKOS_CLIENT_ID`.
3. Point the Dodo webhook at `https://<deployment>.convex.site/dodopayments-webhook`.
4. In WorkOS AuthKit, allow CORS origin `https://spikonado.com` and redirect URI `https://spikonado.com/pricing/callback` (keep localhost + desktop loopback entries).
5. Deploy marketing with the production Sprocket `PUBLIC_CONVEX_URL` and matching `PUBLIC_DODO_CHECKOUT_MODE` (`test` or `live`).
6. Run `bun run sync:convex-api` and commit the updated `src/lib/convex/api.ts` when public Convex function signatures change.
