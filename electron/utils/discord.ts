import { Client, type SetActivity } from "@kostya-main/discord-rpc";

const dateElapsed = Date.now();

const clientId = "1461691220454543484";
const client = new Client({ clientId });

let rpcActivity: SetActivity = {
  startTimestamp: dateElapsed,
  details: "Choosing Version",
  largeImageKey: "butterlauncher",
  largeImageText: "Butter Launcher",
  buttons: [
    {
      label: "Play Free Hytale",
      url: "https://butterlauncher.tech",
    },
  ],
};

const formatYMD = (d: Date) => {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
};

export const setChoosingVersionActivity = () => {
  setActivity({
    startTimestamp: dateElapsed,
    details: "Choosing Version",
    state: undefined,
    // No small image while in launcher UI.
    smallImageKey: undefined,
    smallImageText: undefined,
  });
};

export const setPlayingActivity = (version: GameVersion) => {
  const date = formatYMD(new Date());
  const build = `Build-${version.build_index}_${date} ${version.type}`;
  setActivity({
    startTimestamp: Date.now(),
    details: "Playing Hytale No-Premium",
    state: build,
    // Show small bubble with Hytale icon while playing.
    smallImageKey: "hytale",
    smallImageText: "Hytale",
  });
};

export const setActivity = (activity?: SetActivity) => {
  rpcActivity = {
    ...rpcActivity,
    ...activity,
  };

  client.user?.setActivity(rpcActivity).catch((err: any) => {
    console.log("Discord RPC error:", err);
  });
};

export const connectRPC = async () => {
  client
    .login()
    .then(() => {
      console.log("Discord RPC connected");
      setChoosingVersionActivity();
    })
    .catch((err: any) => {
      console.log("Discord RPC error:", err);
    });
};

export const clearActivity = () => {
  client.user?.clearActivity();
};

export const disconnectRPC = async () => {
  try {
    await client.user?.clearActivity();
  } catch {
    // ignore
  }

  // Destroy/close the IPC connection to Discord so presence doesn't linger.
  try {
    (client as any).destroy?.();
  } catch {
    // ignore
  }
};

// on RPC is ready
client.on("ready", () => {
  setChoosingVersionActivity();
});
