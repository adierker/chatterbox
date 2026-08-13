import { readFileSync, writeFileSync } from 'fs';

// Sync manifest.json to the version npm just wrote into package.json.
// Run automatically by `npm version patch|minor|major`.
const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
manifest.version = process.env.npm_package_version;
writeFileSync('manifest.json', JSON.stringify(manifest, null, '\t') + '\n');
