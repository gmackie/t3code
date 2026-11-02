import { ipcRenderer } from "electron";

import {
  PASSKEY_BRIDGE_ARGUMENT,
  SECURITY_KEY_NOTICE_ARGUMENT,
  SECURITY_KEY_REQUEST_CHANNEL,
} from "./preview/GuestProtocol.ts";
import { installPasskeyBridge } from "./preview/PasskeyBridge.ts";
import { installSecurityKeyNotice } from "./preview/SecurityKeyNotice.ts";
import "./preview/PickPreload.ts";

// Electron hands webPreferences.additionalArguments to sandboxed preloads in process.argv.
if (process.argv.includes(PASSKEY_BRIDGE_ARGUMENT)) {
  installPasskeyBridge((channel, publicKey) => ipcRenderer.invoke(channel, publicKey));
} else if (process.argv.includes(SECURITY_KEY_NOTICE_ARGUMENT)) {
  installSecurityKeyNotice((phase) => ipcRenderer.send(SECURITY_KEY_REQUEST_CHANNEL, phase));
}
