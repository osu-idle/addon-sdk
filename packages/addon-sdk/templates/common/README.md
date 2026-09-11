# __ADDON_NAME__

An add-on for [osu!idle](https://github.com/osu-idle/osu-idle), built with the
[osu!idle Addon SDK](https://github.com/osu-idle/addon-sdk).

## Build

```sh
npm install
npm run build
```

That emits `__OUTFILE__` - a single self-contained ES module. Paste its contents
into the in-game add-on editor (Options → Add-ons → Manage) and enable it.

`npm run dev` rebuilds on save; re-paste to see changes.

## How an add-on runs

The game imports your built file as an ES module from a Blob URL and calls its
`mount` / `unmount` exports. Nothing is injected and nothing resolves at load
time, so every dependency is bundled into that one file.

`unmount` has to genuinely undo everything, because add-ons are enabled,
disabled, updated and removed without a page reload. The SDK's `Addon` base
class records teardown for every listener, timer and overlay it hands you and
reverses it for you.

## Licence

__LICENSE__
