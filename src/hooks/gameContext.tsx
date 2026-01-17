import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
} from "react";
import {
  getGameVersions,
  getInstalledGameVersions,
  saveInstalledGameVersion,
} from "../utils/game";

interface GameContextType {
  gameDir: string | null;
  availableVersions: GameVersion[];
  selectedVersion: number;
  installing: boolean;
  installProgress: InstallProgress;
  patchingOnline: boolean;
  patchProgress: InstallProgress;
  launching: boolean;
  gameLaunched: boolean;
  installGame: (version: GameVersion) => void;
  launchGame: (version: GameVersion, username: string) => void;
}

export const GameContext = createContext<GameContextType | null>(null);

export const GameContextProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const [gameDir, setGameDir] = useState<string | null>(null);
  const [availableVersions, setAvailableVersions] = useState<GameVersion[]>([]);
  const [selectedVersion, setSelectedVersion] = useState<number>(0);

  const [installing, setInstalling] = useState(false);
  const [installProgress, setInstallProgress] = useState<InstallProgress>({
    phase: "download",
    percent: 0,
    total: 0,
    current: 0,
  });
  const [patchingOnline, setPatchingOnline] = useState(false);
  const [patchProgress, setPatchProgress] = useState<InstallProgress>({
    phase: "online-patch",
    percent: -1,
  });
  const [onlinePatchInFlight, setOnlinePatchInFlight] = useState(false);
  const [launching, setLaunching] = useState(false);
  const [gameLaunched, setGameLaunched] = useState(false);

  const installGame = useCallback(
    (version: GameVersion) => {
      if (!gameDir) return;

      window.ipcRenderer.send("install-game", gameDir, version);
    },
    [gameDir]
  );

  const launchGame = useCallback(
    (version: GameVersion, username: string) => {
      if (!gameDir || !version.installed) return;
      setLaunching(true);

      const customUUID = (localStorage.getItem("customUUID") || "").trim();
      const uuidArg = customUUID.length ? customUUID : null;

      window.ipcRenderer.send("launch-game", gameDir, version, username, uuidArg);
      window.ipcRenderer.once("launched", () => {
        setLaunching(false);
        setGameLaunched(true);
      });
      window.ipcRenderer.once("launch-finished", () => {
        setLaunching(false);
        setGameLaunched(false);
      });
      window.ipcRenderer.once("launch-error", () => {
        setLaunching(false);
        setGameLaunched(false);
      });
    },
    [gameDir]
  );

  const getAvailableVersions = async () => {
    const local = getInstalledGameVersions();
    setAvailableVersions(local); // set available from installed while loading remote

    let remote = await getGameVersions("release");
    if (remote.length === 0) return;

    let installedBuild: number | null = null;
    if (gameDir) {
      installedBuild = await window.ipcRenderer.invoke(
        "get-installed-build",
        gameDir,
        "release"
      );
    }

    // If there is no manifest yet (old installs), fall back to localStorage "installedVersions"
    // and treat the max build_index as the currently installed build.
    if (installedBuild == null && local.length) {
      const maxLocal = Math.max(
        ...local
          .filter((v) => v.type === "release")
          .map((v) => v.build_index)
      );
      if (Number.isFinite(maxLocal) && maxLocal > 0) installedBuild = maxLocal;
    }

    remote = remote.map((version) => {
      const installed =
        typeof installedBuild === "number" &&
        version.build_index === installedBuild;
      return {
        ...version,
        installed: !!installed,
      };
    });

    setAvailableVersions(remote);
  };

  useEffect(() => {
    if (!window.config) return;

    const bounceTimeout = 200;
    let lastUpdateProgress: number;
    const lastProgressRef = { current: null as InstallProgress | null };

    window.ipcRenderer.on("install-progress", (_, progress: InstallProgress) => {
      const now = Date.now();
      const last = lastProgressRef.current;

      // Never drop phase changes (this was causing the UI to get stuck on "Downloading...").
      const phaseChanged = !last || last.phase !== progress.phase;
      const allowThrough =
        phaseChanged ||
        progress.percent === -1 ||
        progress.percent === 100 ||
        !lastUpdateProgress ||
        now - lastUpdateProgress >= bounceTimeout;

      if (!allowThrough) return;

      lastUpdateProgress = now;
      lastProgressRef.current = progress;
      setInstallProgress(progress);
    });

    // Online client patch (startup) progress
    // Only show patching UI when a download actually starts (progress events).
    window.ipcRenderer.on(
      "online-patch-progress",
      (_, progress: InstallProgress) => {
        setPatchingOnline(true);
        setPatchProgress(progress);
      }
    );
    window.ipcRenderer.on("online-patch-finished", () => {
      setPatchingOnline(false);
      setOnlinePatchInFlight(false);
    });
    window.ipcRenderer.on("online-patch-error", (_, error: string) => {
      setPatchingOnline(false);
      setOnlinePatchInFlight(false);
      console.error("Online patch error:", error);
    });
    window.ipcRenderer.on("install-started", () => {
      setInstalling(true);
    });
    window.ipcRenderer.on("install-finished", (_, version) => {
      setInstalling(false);
      saveInstalledGameVersion(version);

      // Update in-memory list so the UI immediately switches from "Install/Update" to "Play".
      // Only one build per channel is considered installed (the currently applied one).
      setAvailableVersions((prev) => {
        const next = prev.map((v) => {
          if (v.type !== version.type) return v;
          const isInstalled = v.build_index === version.build_index;
          return { ...v, installed: isInstalled };
        });

        const idx = next.findIndex(
          (v) => v.build_index === version.build_index && v.type === version.type
        );
        if (idx !== -1) setSelectedVersion(idx);

        return next;
      });
    });
    window.ipcRenderer.on("install-error", (_, error) => {
      setInstalling(false);
      alert(`Installation failed: ${error}`);
    });

    (async () => {
      const defaultGameDirectory =
        await window.config.getDefaultGameDirectory();

      setGameDir(defaultGameDirectory);
    })();
  }, []);

  useEffect(() => {
    if (!gameDir) return;
    getAvailableVersions();
  }, [gameDir]);

  // On launcher open (and whenever the installed build changes), verify the online client patch.
  useEffect(() => {
    if (!gameDir) return;
    if (installing) return;

    const installed = availableVersions.find((v) => v.installed);
    if (!installed) return;
    if (!installed.patch_url || !installed.patch_hash) return;
    if (onlinePatchInFlight) return;

    setOnlinePatchInFlight(true);
    window.ipcRenderer.send("online-patch", gameDir, installed);
  }, [gameDir, availableVersions, installing, onlinePatchInFlight]);

  useEffect(() => {
    if (!availableVersions.length) return;
    console.log("availableVersions", availableVersions);

    // Prefer selecting the currently installed build if one exists.
    const installedIdx = availableVersions.findIndex((v) => v.installed);
    if (installedIdx !== -1) {
      setSelectedVersion(installedIdx);
      return;
    }

    // Otherwise default to latest (last in the list)
    setSelectedVersion(availableVersions.length - 1);
  }, [availableVersions]);

  useEffect(() => {
    if (!availableVersions.length) return;
    const selected = availableVersions[selectedVersion];
    if (!selected) return;
    localStorage.setItem("selectedVersionBuildIndex", selected.build_index.toString());
  }, [selectedVersion, availableVersions]);

  return (
    <GameContext.Provider
      value={{
        gameDir,
        availableVersions,
        selectedVersion,
        installing,
        installProgress,
        patchingOnline,
        patchProgress,
        launching,
        gameLaunched,
        installGame,
        launchGame,
      }}
    >
      {children}
    </GameContext.Provider>
  );
};

export const useGameContext = () => {
  const context = useContext(GameContext);
  if (!context)
    throw new Error("useGameContext must be used within a GameContextProvider");
  return context;
};
