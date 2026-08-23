import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

// Read from package.json so there is exactly one place the version lives.
const pkg = require("../package.json") as { version: string };

export const VERSION: string = pkg.version;
