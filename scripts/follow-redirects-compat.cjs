const fs = require("node:fs");
const path = require("node:path");

// Pi's compiled Bun runtime rejects follow-redirects' prototype-only error
// instances as captureStackTrace targets on a cold Jiti import. Capture into a
// genuine Error, then retain the stack on the library's original error object.
// Keep the library's classes, codes, causes and messages intact.
function patchFollowRedirectsSource(source) {
  const target = "Error.captureStackTrace(this, this.constructor);";
  if (source.split(target).length !== 2 || !source.includes("function createErrorType(")) {
    throw new Error("follow-redirects stack capture changed; review Bun compatibility before bundling");
  }
  return source.replace(target, [
    "var stackHolder = new Error();",
    "Error.captureStackTrace(stackHolder, this.constructor);",
    'Object.defineProperty(this, "stack", { value: stackHolder.stack, configurable: true, writable: true });',
  ].join("\n"));
}

function followRedirectsCompatPlugin() {
  return {
    name: "studio-follow-redirects-stack-compat",
    setup(build) {
      build.onLoad({ filter: /[/\\]follow-redirects[/\\]index\.js$/ }, (args) => ({
        contents: patchFollowRedirectsSource(fs.readFileSync(args.path, "utf8")),
        loader: "js",
        resolveDir: path.dirname(args.path),
      }));
    },
  };
}

module.exports = { patchFollowRedirectsSource, followRedirectsCompatPlugin };
