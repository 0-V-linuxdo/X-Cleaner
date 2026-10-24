# X Cleaner agent notes

## Releasing a build

- `bun test`, `bunx tsc --noEmit` and `bun run build` must all pass before pushing.
- Commit `dist/X Cleaner.user.js` and `dist/X Cleaner.meta.js` with the change. Script managers update from
  `main` through `@updateURL` / `@downloadURL`, so an unbuilt commit never reaches users.
- Keep `@name` and `@namespace` unchanged: the script manager identifies the installed script by them, and a
  change installs a second copy instead of updating.
- After the push, purge jsDelivr so the install link serves the new build:
  `curl -s "https://purge.jsdelivr.net/gh/0-V-linuxdo/X-Cleaner@heads/main/dist/X%20Cleaner.user.js"`.
  The cloud sandbox blocks that host; run the same `fetch` from an `about:blank` tab in Helium instead
  (x.com's CSP blocks it there), then fetch the jsDelivr file and check its `@version`.
- Links people click to install use jsDelivr (`INSTALL_URL` in `build.ts`), never GitHub raw: raw sends
  `Content-Security-Policy: sandbox`, so Tampermonkey on Chrome only shows the source. `@updateURL` /
  `@downloadURL` stay on raw so a CDN cache never hides a new `@version`.

## Updating the script in the browser (Helium)

- Open the install link in a new tab and confirm the update in Violentmonkey (暴力猴).
- Then reload the x.com test page and check `document.documentElement.dataset.xcVersion` equals the `@version`
  just built. Only then verify features: a different value means the page still runs the old copy.
- After the update, close every page you opened: the test pages (x.com tabs opened for checks) and all
  Violentmonkey pages (install / update / dashboard tabs). Leave the user's own tabs alone.
- Never press the final confirm of X's native block dialog, and never post, block or change settings on X.
