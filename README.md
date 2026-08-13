# Chatterbox

A minimal AI chat panel for Obsidian. Attach the notes you choose as context, talk to a model
through OpenRouter, and go back and edit any earlier message without ever losing the original
conversation.

Not intended for the community plugin store.

## Develop

```
npm install
npm run dev      # esbuild watch, rebuilds main.js on save
npm run build    # type check + production build
npm run lint
```

Clone into `<vault>/.obsidian/plugins/chatterbox/` so a build lands where Obsidian loads it,
then reload the plugin from Settings → Community plugins.

## Release

Installed via [BRAT](https://github.com/TfTHacker/obsidian42-brat). Pushing a tag builds and
publishes a GitHub release with `main.js`, `manifest.json`, and `styles.css`.

```
npm version patch    # bumps package.json + manifest.json
git push --follow-tags
```

The tag must be the bare version number — `0.2.0`, not `v0.2.0`.
