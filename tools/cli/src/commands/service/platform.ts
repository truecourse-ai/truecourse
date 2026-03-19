import { MacOSService } from "./macos.js";
import { LinuxService } from "./linux.js";
import { WindowsService } from "./windows.js";

export interface ServicePlatform {
  install(serverPath: string, logPath: string): Promise<void>;
  uninstall(): Promise<void>;
  start(): Promise<void>;
  stop(): Promise<void>;
  status(): Promise<{ running: boolean; pid?: number }>;
  isInstalled(): Promise<boolean>;
}

export function getPlatform(): ServicePlatform {
  switch (process.platform) {
    case "darwin":
      return new MacOSService();
    case "linux":
      return new LinuxService();
    case "win32":
      return new WindowsService();
    default:
      throw new Error(
        `Unsupported platform: ${process.platform}. Background service mode supports macOS, Linux, and Windows.`
      );
  }
}
