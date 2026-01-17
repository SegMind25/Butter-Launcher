import fs from "fs";
import path from "path";
import crypto from "node:crypto";
import stream from "node:stream";
import { promisify } from "util";
import { BrowserWindow } from "electron";

const pipeline = promisify(stream.pipeline);

const FETCH_TIMEOUT_MS = 45_000;

const normalizeHash = (h: string) => h.trim().toUpperCase();

const sha256File = (filePath: string): Promise<string> => {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const input = fs.createReadStream(filePath);
    input.on("error", reject);
    input.on("data", (chunk) => hash.update(chunk));
    input.on("end", () => resolve(hash.digest("hex")));
  });
};

const getClientPath = (gameDir: string, version: GameVersion) => {
  const os = process.platform;
  const clientName = os === "win32" ? "HytaleClient.exe" : "HytaleClient";
  return path.join(gameDir, "game", version.type, "Client", clientName);
};

const downloadFileWithProgress = async (
  url: string,
  outPath: string,
  win: BrowserWindow,
  progressChannel: "install-progress" | "online-patch-progress",
) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  const response = await fetch(url, { signal: controller.signal }).finally(() => {
    clearTimeout(timeout);
  });
  if (!response.ok) throw new Error(`Failed to download patch: ${response.status}`);
  if (!response.body) throw new Error("No response body");

  const contentLength = response.headers.get("content-length");
  const totalLength = contentLength ? parseInt(contentLength, 10) : 0;
  let downloadedLength = 0;

  const progressStream = new stream.PassThrough();
  progressStream.on("data", (chunk) => {
    downloadedLength += chunk.length;

    const percent =
      totalLength > 0
        ? Math.round((downloadedLength / totalLength) * 100)
        : -1;

    win.webContents.send(progressChannel, {
      phase: "online-patch",
      percent,
      total: totalLength > 0 ? totalLength : undefined,
      current: downloadedLength,
    });
  });

  // Initial state (indeterminate if content-length missing)
  win.webContents.send(progressChannel, {
    phase: "online-patch",
    percent: totalLength > 0 ? 0 : -1,
    total: totalLength > 0 ? totalLength : undefined,
    current: 0,
  });

  await pipeline(
    // @ts-ignore
    stream.Readable.fromWeb(response.body),
    progressStream,
    fs.createWriteStream(outPath),
  );

  win.webContents.send(progressChannel, {
    phase: "online-patch",
    percent: 100,
    total: totalLength > 0 ? totalLength : undefined,
    current: downloadedLength,
  });
};

export const patchOnlineClientIfNeeded = async (
  gameDir: string,
  version: GameVersion,
  win: BrowserWindow,
  progressChannel: "install-progress" | "online-patch-progress" = "online-patch-progress",
): Promise<"patched" | "skipped" | "up-to-date"> => {
  const url = version.patch_url;
  const expectedHash = version.patch_hash;

  // Requirement: if build not in list OR missing url/hash, don't patch.
  if (!url || !expectedHash) return "skipped";

  const clientPath = getClientPath(gameDir, version);
  if (!fs.existsSync(clientPath)) return "skipped";

  try {
    const currentHash = await sha256File(clientPath).catch(() => null);
    if (currentHash && normalizeHash(currentHash) === normalizeHash(expectedHash)) {
      return "up-to-date";
    }

    const tempPath = path.join(
      path.dirname(clientPath),
      `temp_online_patch_${version.build_index}${process.platform === "win32" ? ".exe" : ""}`,
    );

    await downloadFileWithProgress(url, tempPath, win, progressChannel);

    const downloadedHash = await sha256File(tempPath);
    if (normalizeHash(downloadedHash) !== normalizeHash(expectedHash)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
      throw new Error("Patch hash mismatch (SHA256)");
    }

    // Replace the executable.
    try {
      fs.unlinkSync(clientPath);
    } catch {
      // ignore
    }

    try {
      fs.renameSync(tempPath, clientPath);
    } catch {
      // Windows can be picky; fallback to copy.
      fs.copyFileSync(tempPath, clientPath);
      try {
        fs.unlinkSync(tempPath);
      } catch {
        // ignore
      }
    }

    return "patched";
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    win.webContents.send("online-patch-error", msg);
    return "skipped";
  }
};
