// Stands in for Node.js modules (fs, path) in the browser's bundle
// (next.config.ts, turbopack.resolveAlias). The code block's PHP formatter
// (@prettier/plugin-php's browser build) imports them only to find a
// composer.json, which never runs there (code-format.ts sets the PHP version).
const empty = {};
export default empty;
