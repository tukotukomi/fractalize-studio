# Fractalize relay (Cloudflare Worker)

Forwards small control messages between the desktop fractal and a phone
controller so the phone can drive the filter panel and camera roll. See
`worker.js` for the rules (one host + one remote per room, size/rate caps,
allowed origins). Nothing is stored or logged.

## One-time setup

1. Create a free Cloudflare account at https://dash.cloudflare.com/sign-up
   (no domain needed -- the Worker gets a free `*.workers.dev` address).
2. Install Node.js LTS from https://nodejs.org (includes `npm`/`npx`).
3. In a terminal, from this `relay/` folder:

   ```
   npx wrangler login
   npx wrangler deploy
   ```

   `login` opens a browser to authorize; `deploy` uploads `worker.js` and
   creates the `Room` Durable Object (see `wrangler.toml`). It prints the
   Worker's address, like `https://fractalize-relay.<you>.workers.dev`.
4. Put that address in `../relay-config.js`, switching `https://` to
   `wss://`:

   ```js
   window.FRACTALIZE_RELAY_URL = "wss://fractalize-relay.<you>.workers.dev";
   ```

   Commit and push. The "Control from your phone" button then appears in
   the fractal's settings panel on fractalize.studio.

## Notes

- Allowed browser origins are listed at the top of `worker.js`
  (fractalize.studio, plus localhost for testing). Edit and re-run
  `npx wrangler deploy` if the site's address ever changes.
- Cost: normally free / a few dollars at most. In the Cloudflare
  dashboard you can set usage notifications under Billing.
- Redeploying after any change to `worker.js` is the same
  `npx wrangler deploy`.
