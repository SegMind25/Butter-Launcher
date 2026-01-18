import fs from "fs";
import path from "path";
import { INSTALLED_MANIFEST_FILENAME, readInstallManifest, writeInstallManifest } from "./manifest";

const BUILD_DIR_PREFIX = "build-";

export const getGameRootDir = (baseDir: string) => path.join(baseDir, "game");

export const getLatestDir = (baseDir: string) => path.join(getGameRootDir(baseDir), "latest");

export const getReleaseChannelDir = (baseDir: string) =>
  path.join(getGameRootDir(baseDir), "release");

export const getPreReleaseChannelDir = (baseDir: string) =>
  path.join(getGameRootDir(baseDir), "pre-release");

export const getReleaseBuildDir = (baseDir: string, buildIndex: number) =>
  path.join(getReleaseChannelDir(baseDir), `${BUILD_DIR_PREFIX}${buildIndex}`);

export const getPreReleaseBuildDir = (baseDir: string, buildIndex: number) =>
  path.join(getPreReleaseChannelDir(baseDir), `${BUILD_DIR_PREFIX}${buildIndex}`);

const isLegacyChannelInstall = (channelDir: string) => {
  // Old layout installed directly into game/<type>/Client + Server.
  return fs.existsSync(path.join(channelDir, "Client")) || fs.existsSync(path.join(channelDir, "Server"));
};

export const migrateLegacyChannelInstallIfNeeded = (baseDir: string, versionType: GameVersion["type"]) => {
  try {
    const channelDir =
      versionType === "release" ? getReleaseChannelDir(baseDir) : getPreReleaseChannelDir(baseDir);

    if (!fs.existsSync(channelDir)) return;
    if (!isLegacyChannelInstall(channelDir)) return;

    // Old manifest lived at game/<type>/.butter-installed.json
    const legacyManifestPath = path.join(channelDir, INSTALLED_MANIFEST_FILENAME);
    if (!fs.existsSync(legacyManifestPath)) return;

    const legacy = readInstallManifest(channelDir);
    if (!legacy) return;

    const buildDir =
      versionType === "release"
        ? getReleaseBuildDir(baseDir, legacy.build_index)
        : getPreReleaseBuildDir(baseDir, legacy.build_index);

    if (!fs.existsSync(buildDir)) fs.mkdirSync(buildDir, { recursive: true });

    // Move everything except existing build-* folders into buildDir.
    const entries = fs.readdirSync(channelDir);
    for (const name of entries) {
      if (name.startsWith(BUILD_DIR_PREFIX)) continue;
      const from = path.join(channelDir, name);
      const to = path.join(buildDir, name);

      if (fs.existsSync(to)) continue;

      try {
        fs.renameSync(from, to);
      } catch {
        // Fallback to copy for cross-device or locked cases
        try {
          fs.cpSync(from, to, { recursive: true });
          fs.rmSync(from, { recursive: true, force: true });
        } catch {
          // ignore
        }
      }
    }

    // Ensure manifest exists inside the build dir (new layout).
    writeInstallManifest(buildDir, {
      build_index: legacy.build_index,
      type: legacy.type,
      build_name: legacy.build_name,
    });

    // Clean up leftover legacy manifest if still present.
    try {
      const leftover = path.join(channelDir, INSTALLED_MANIFEST_FILENAME);
      if (fs.existsSync(leftover)) fs.unlinkSync(leftover);
    } catch {
      // ignore
    }
  } catch {
    // ignore best-effort migration
  }
};

export const resolveInstallDir = (baseDir: string, version: GameVersion): string => {
  if (version.type === "pre-release") {
    return getPreReleaseBuildDir(baseDir, version.build_index);
  }

  // Latest alias is only used for latest RELEASE.
  if (version.type === "release" && version.isLatest) {
    return getLatestDir(baseDir);
  }

  return getReleaseBuildDir(baseDir, version.build_index);
};

// For launching/patching: prefer the existing latest alias if it matches the build.
// This keeps older "latest" installs launchable even after newer builds appear.
export const resolveExistingInstallDir = (baseDir: string, version: GameVersion): string => {
  if (version.type === "release") {
    try {
      const latestDir = getLatestDir(baseDir);
      const manifest = readInstallManifest(latestDir);
      if (manifest?.build_index === version.build_index) return latestDir;
    } catch {
      // ignore
    }
  }

  return resolveInstallDir(baseDir, version);
};

export const resolveClientPath = (installDir: string) => {
  const os = process.platform;
  const clientName = os === "win32" ? "HytaleClient.exe" : "HytaleClient";
  return path.join(installDir, "Client", clientName);
};

export const resolveServerPath = (installDir: string) =>
  path.join(installDir, "Server", "HytaleServer.jar");
