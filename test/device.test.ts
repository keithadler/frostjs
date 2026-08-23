import { describe, expect, it } from "vitest";
import { parseSource } from "../src/extract/ast.js";
import { extract } from "../src/extract/index.js";

const caps = (src: string) => extract(parseSource("t.js", src)).map((u) => u.capability);

describe("device: positives", () => {
  it("File System Access pickers, bare and via window", () => {
    expect(caps("showOpenFilePicker()")).toEqual(["device.filesystem"]);
    expect(caps("await window.showSaveFilePicker(opts)")).toEqual(["device.filesystem"]);
    expect(caps("showDirectoryPicker()")).toEqual(["device.filesystem"]);
  });

  it("navigator hardware members", () => {
    expect(caps("navigator.usb.requestDevice()")).toEqual(["device.usb"]);
    expect(caps("navigator.bluetooth.requestDevice(f)")).toEqual(["device.bluetooth"]);
    expect(caps("navigator.serial.requestPort()")).toEqual(["device.serial"]);
    expect(caps("navigator.hid.requestDevice(o)")).toEqual(["device.hid"]);
    expect(caps("navigator.wakeLock.request('screen')")).toEqual(["device.wakelock"]);
    expect(caps("navigator.requestMIDIAccess()")).toEqual(["device.midi"]);
    expect(caps("window.navigator.usb")).toEqual(["device.usb"]);
  });

  it("Notification", () => {
    expect(caps('new Notification("hi")')).toEqual(["device.notification"]);
    expect(caps("Notification.requestPermission()")).toEqual(["device.notification"]);
    expect(caps("if (Notification.permission === 'granted') {}")).toEqual(["device.notification"]);
    expect(caps("window.Notification.requestPermission()")).toEqual(["device.notification"]);
  });
});

describe("device: must stay quiet", () => {
  it("other objects and names", () => {
    expect(caps("app.usb.send(); this.serial = 1; obj.showSaveFilePicker()")).toEqual([]);
    expect(caps("const usb = {}; usb.requestDevice()")).toEqual([]);
    expect(caps("myNotification.close(); notifications.push(x)")).toEqual([]);
  });

  it("shadowed globals", () => {
    expect(caps("function showOpenFilePicker() {} showOpenFilePicker()")).toEqual([]);
    expect(caps("const Notification = Toast; new Notification(x)")).toEqual([]);
  });

  it("declarations and keys", () => {
    expect(caps("const o = { usb: 1, showSaveFilePicker: 2 }; function bluetooth() {}")).toEqual([]);
  });
});
