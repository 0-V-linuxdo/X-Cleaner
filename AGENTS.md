# X Cleaner agent notes

## Releasing a build

- `bun test`, `bunx tsc --noEmit` and `bun run build` must all pass before pushing.
- Commit `dist/X Cleaner.user.js` and `dist/X Cleaner.meta.js` with the change. Script managers update from
  `main` through `@updateURL` / `@downloadURL`, so an unbuilt commit never reaches users.
- Keep `@name` and `@namespace` unchanged: the script manager identifies the installed script by them, and a
  change installs a second copy instead of updating.

## Updating the script in the browser (Helium)

- Open the raw `@downloadURL` in a new tab and confirm the update in Violentmonkey (暴力猴).
- After the update, close every page you opened: the test pages (x.com tabs opened for checks) and all
  Violentmonkey pages (install / update / dashboard tabs). Leave the user's own tabs alone.
- Never press the final confirm of X's native block dialog, and never post, block or change settings on X.
