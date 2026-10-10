# Brand images for home-assistant/brands

Home Assistant shows integration icons from the [home-assistant/brands](https://github.com/home-assistant/brands) repository. Until that PR is merged, HACS and the integration page show a placeholder (the CI workflow ignores the HACS `brands` check for that reason).

The folder `custom_integrations/tohuus_hub/` here has exactly the layout the brands repository expects:

| File | Size |
|---|---|
| `icon.png` / `icon@2x.png` | 256×256 / 512×512 |
| `logo.png` / `logo@2x.png` | 256 / 512 px high, icon + wordmark |
| `dark_logo.png` / `dark_logo@2x.png` | same, light wordmark for dark themes |

## Pull request

1. Fork `home-assistant/brands`.
2. Copy `custom_integrations/tohuus_hub/` from here into the fork's `custom_integrations/` folder.
3. Open a PR titled "Add ToHuus Hub (tohuus_hub)", link this repository. The checks verify sizes and that the domain exists in a public custom integration.

## Regenerate

From the ToHuus Hub repository root (needs `sharp` and the Geist font from its `node_modules`):

```sh
node ha-integration/scripts/render_brand.mjs
```

It renders from `web/public/icon.svg` and also refreshes `custom_components/tohuus_hub/icon.png` and `logo.png`.
