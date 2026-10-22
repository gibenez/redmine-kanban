# Pinned browser assets

## Redmine logo

`public/branding/redmine-logo.png` is the unmodified **Redmine Fluid Icon** from
[Redmine's logo page](https://www.redmine.org/projects/redmine/wiki/Logo), downloaded from
https://www.redmine.org/attachments/download/3462/redmine_fluid_icon.png.
Copyright (C) 2009 Martin Herr, licensed under
[Creative Commons Attribution-Share Alike 2.5 Generic](https://creativecommons.org/licenses/by-sa/2.5/).
Attribution is also distributed in `public/branding/REDMINE-LOGO-LICENSE.txt`.
The logo is served locally, without third-party runtime requests; it is displayed at a
smaller size but the asset is not modified. Use does not imply endorsement by Redmine.

SHA-256: `2d70f2e2780cd182615f6d706491d153559b1ad8dba1c3a07193876c66b8ffbf`.

## Board libraries

The application uses the **unmodified jKanban 1.3.1 browser distribution**, from the npm `jkanban@1.3.1` package, sourced from https://github.com/riktar/jkanban (Apache-2.0). It is vendored instead of installing jKanban's legacy npm watch/build dependency tree. The classic browser script exposes `window.jKanban`; application code remains ES modules. jKanban supplies the actual board and Dragula drag/drop implementation, not just styling.

| Asset | SHA-256 |
| --- | --- |
| `public/vendor/jkanban.min.js` | `db33f3fdeff17604b47b3c76ada05c3e3843bc31b7f4850db46536cd01bafa6b` |
| `public/vendor/jkanban.min.css` | `d2a4144d1fbefb3ff1f45ad1650192e6633ac10086ba55d11c77a3d08cece549` |
| `public/vendor/dragula.min.css` | `91b8ce3fade464207e97186cb0dfa1e6a0c22d22c8ec484fdffaf64bf8cf09de` |

Dragula CSS is from `dragula@3.7.3` (MIT). jKanban's bundle includes Dragula and its dependencies: contra, crossvent, atoa, ticky, and custom-event. License notices are in `public/vendor/jkanban.LICENSE`, `dragula.LICENSE`, and `BUNDLED-LICENSES.md`.

To update: retrieve upstream npm packages in a temporary directory (`npm pack jkanban@<version>` and `npm pack dragula@<version>`), inspect their distribution and licenses, replace the assets, update hashes/notices here, and run unit, browser and Docker smoke tests. Never fetch third-party assets at application runtime.

`npm audit` covers the installed development/build dependencies, **not vendored JavaScript**. Upstream/vendor security review remains necessary when updating these assets. API-derived text must always be escaped before entering jKanban's HTML-based rendering interface.
