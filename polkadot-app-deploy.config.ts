// SPDX-License-Identifier: MIT
//
// Product manifest for `@polkadot-community-foundation/polkadot-app-deploy`
// (the Bulletin app-deploy CLI). The tool auto-discovers this file by name
// (`polkadot-app-deploy.config.{ts,js,mjs}`, walking up from the build dir) and
// reads the default export to publish the product manifest (displayName,
// description, icon) alongside the content upload. A file named anything else is
// silently ignored — manifest publish skipped, no error.
//
// `defineConfig` is vendored as an identity function rather than imported from
// the deploy CLI: the tool is a global/npx CLI, not a package.json dependency,
// so importing from it would make config resolution fragile.
const defineConfig = <T>(config: T): T => config;

declare const process: { env?: Record<string, string | undefined> };

// APP_DOTNS_DOMAIN lets CI/preview deploys override the bare label; defaults to
// the production label. MUST match the domain the CLI is invoked with.
const domain = process.env?.APP_DOTNS_DOMAIN ?? "collectibles-webview";
const label = domain.toLowerCase().replace(/\.dot$/, "");

export default defineConfig({
  domain: `${label}.dot`,
  displayName: "Collectibles",
  description:
    "An animated gallery of the collectibles a user owns — every NFT resolved to its artwork in a swipeable, glowing collection, embedded as a native-app WebView.",
  // PLACEHOLDER ICON: the repo bundles no image assets at all (collectible
  // artwork is resolved from on-chain CIDs at runtime), so this is the shared
  // devnet build icon — white tile, black Polkadot mark, DEV label — from the
  // app icon design language. It unblocks manifest publish, which fails loudly
  // without a readable file here. Replace with bespoke artwork when there is
  // any. If this product is ever published to mainnet, swap in the unlabelled
  // production variant — the DEV label would otherwise misreport the network.
  icon: { path: "./assets/icon.png", format: "png" },
  executables: [
    {
      kind: "app",
      path: "./dist",
      appVersion: [0, 1, 0],
    },
  ],
});
