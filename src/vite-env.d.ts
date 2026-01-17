/// <reference types="vite/client" />

type VersionType = "release" | "pre-release";

type GameVersion = {
  url: string;
  type: VersionType;
  build_index: number;
  build_name: string;
  patch_url?: string;
  patch_hash?: string;
  hasFix?: boolean;
  fixURL?: string;
  installed?: boolean;
};

type VersionDetails = {
  name: string;
  url?: string;
  hash?: string;
};

type VersionDetailsRoot = {
  last_updated: string;
  latest_release_id: number;
  latest_prerelease_id: number;
  versions: Record<string, VersionDetails>;
  pre_releases: Record<string, VersionDetails>;
};

type InstallProgress = {
  phase: string;
  percent: number;
  total?: number;
  current?: number;
};
