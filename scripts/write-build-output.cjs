const { readFileSync, writeFileSync } = require("node:fs");

function writeBuildOutput(destination, contents) {
  let current;
  try {
    current = readFileSync(destination);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  // Cargo watches the modification times of packaged resources.
  if (!current?.equals(contents)) writeFileSync(destination, contents);
}

module.exports = { writeBuildOutput };
