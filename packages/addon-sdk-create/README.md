# @osu-idle/addon-sdk-create

Scaffold an [osu!idle](https://github.com/osu-idle/osu-idle) add-on.

```sh
npx @osu-idle/addon-sdk-create@latest my-addon
```

```
  --name "My Add-on"      display name (default: the directory name)
  --template react|plain  starting point (default: react)
  --license <spdx>        default: AGPL-3.0-only
  --force                 write into a non-empty directory
```

Then:

```sh
cd my-addon
npm install
npm run build
```

Paste the emitted file into the in-game add-on editor (Options → Add-ons →
Manage) and enable it.

The scaffolding lives in [`@osu-idle/addon-sdk`](https://www.npmjs.com/package/@osu-idle/addon-sdk),
which this package is a front door for - `osu-idle-addon init` does the same
thing from inside an existing project.

## Licence

AGPL-3.0-only.
