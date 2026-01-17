import { BrowserWindow } from "electron";
import { checkGameInstallation } from "./check";
import { join, dirname } from "path";
import { exec } from "child_process";
import fs from "fs";
import { genUUID } from "./uuid";
import { installGame } from "./install";

export const launchGame = async (
  baseDir: string,
  version: GameVersion,
  username: string,
  win: BrowserWindow,
  retryCount: number = 0,
  customUUID: string | null = null
) => {
  if (retryCount > 1) {
    console.error("Failed to launch game, maximum retry count reached");
    return;
  }

  let { client, server, jre } = checkGameInstallation(baseDir, version);
  if (!client || !server || !jre) {
    console.log("Game not installed, missing:", { client, server, jre });
    const installResult = await installGame(baseDir, version, win);
    if (!installResult) {
      console.error("Game installation failed, retrying...");
      launchGame(baseDir, version, username, win, retryCount + 1);
    } else {
      launchGame(baseDir, version, username, win);
    }
    return;
  }

  const userDir = join(baseDir, "UserData");
  if (!fs.existsSync(userDir)) fs.mkdirSync(userDir);

  const normalizeUuid = (raw: string): string | null => {
    const trimmed = raw.trim();
    if (!trimmed) return null;

    const compact = trimmed.replace(/-/g, "");
    if (/^[0-9a-fA-F]{32}$/.test(compact)) {
      const lower = compact.toLowerCase();
      return `${lower.slice(0, 8)}-${lower.slice(8, 12)}-${lower.slice(12, 16)}-${lower.slice(16, 20)}-${lower.slice(20)}`;
    }

    if (/^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/.test(trimmed)) {
      return trimmed.toLowerCase();
    }

    return null;
  };

  const uuidToUse = customUUID ? normalizeUuid(customUUID) : null;

  const args = [
    "--app-dir",
    join(dirname(client), ".."),
    "--user-dir",
    userDir,
    "--java-exec",
    jre,
    "--auth-mode offline",
    "--uuid",
    uuidToUse ?? genUUID(username),
    "--name",
    username,
  ];

  win.webContents.send("launched");
  exec(`"${client}" ${args.join(" ")}`, (error) => {
    if (error) {
      console.error(`Error launching game: ${error.message}`);
      win.webContents.send("launch-error");
      return;
    }
    win.webContents.send("launch-finished");
  });
};
