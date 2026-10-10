const fs = require("node:fs");
const { Readable, Transform } = require("node:stream");
const { pipeline } = require("node:stream/promises");

const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
const DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000;

async function downloadLockedAsset(url, destination) {
  if (new URL(url).protocol !== "https:") throw new Error("Locked asset URL must use HTTPS");
  const partial = `${destination}.part`;
  fs.rmSync(partial, { force: true });
  try {
    const response = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "zicode-studio-desktop-build" },
      signal: AbortSignal.timeout(DOWNLOAD_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    if (!response.body || new URL(response.url).protocol !== "https:") {
      throw new Error("Locked asset response is unavailable or not HTTPS");
    }
    let received = 0;
    const limit = new Transform({
      transform(chunk, _encoding, callback) {
        received += chunk.length;
        callback(
          received > MAX_ARCHIVE_BYTES
            ? new Error("Locked asset exceeds the download size limit")
            : null,
          chunk,
        );
      },
    });
    await pipeline(
      Readable.fromWeb(response.body),
      limit,
      fs.createWriteStream(partial, { flags: "wx" }),
    );
    fs.renameSync(partial, destination);
  } catch (error) {
    fs.rmSync(partial, { force: true });
    throw error;
  }
}

module.exports = { downloadLockedAsset, MAX_ARCHIVE_BYTES };
