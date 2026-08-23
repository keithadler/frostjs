import type { AnyNode } from "../ast.js";
import { match, plain, type Recognizer } from "./types.js";
import { asGlobalIn, asNamedGlobal, isIdentifier, memberName } from "./resolve.js";

/** navigator members that reach hardware or the user's device beyond fingerprinting. */
const NAVIGATOR: ReadonlyMap<string, string> = new Map([
  ["usb", "device.usb"],
  ["bluetooth", "device.bluetooth"],
  ["serial", "device.serial"],
  ["hid", "device.hid"],
  ["wakeLock", "device.wakelock"],
  ["requestMIDIAccess", "device.midi"],
]);

/** Bare/window globals that open the File System Access picker: read or write the user's real files. */
const FILE_PICKERS: ReadonlySet<string> = new Set(["showOpenFilePicker", "showSaveFilePicker", "showDirectoryPicker"]);

/**
 * Reaching the machine, not just the page: WebUSB, Web Bluetooth, Web
 * Serial, WebHID, Web MIDI and the wake lock through `navigator`; the File
 * System Access pickers, which hand back a real file or directory handle;
 * and `Notification`. These are strong capabilities a page rarely needs and
 * a policy will almost always want to deny by default.
 */
export const device: Recognizer = ({ node, binding }) => {
  if (binding) return null;
  const n = node as AnyNode;

  // showOpenFilePicker(...), window.showSaveFilePicker(...)
  const picker = asGlobalIn(n, FILE_PICKERS);
  if (picker) return match("device.filesystem", picker.r, node);

  // Notification: new Notification(...), Notification.requestPermission(), Notification.permission
  if (isIdentifier(n, "Notification"))
    return { capability: "device.notification", target: null, confidence: "certain", via: n, node };
  if (n.type === "MemberExpression" && memberName(n) === "Notification") {
    const r = asNamedGlobal(n["object"] as AnyNode, "window");
    if (r) return match("device.notification", r, node);
  }

  // navigator.usb, navigator.bluetooth, navigator.requestMIDIAccess, ...
  if (n.type !== "MemberExpression") return null;
  const cap = NAVIGATOR.get(memberName(n) ?? "");
  if (!cap) return null;
  const r = asNamedGlobal(n["object"] as AnyNode, "navigator");
  return r ? match(cap, r, node) : null;
};
