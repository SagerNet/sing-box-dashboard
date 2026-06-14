import { useEffect, useReducer, useRef } from "react";

import type { Server } from "../api/config";
import { showError } from "../app/errorStore";
import { useI18n, type Translate } from "../app/i18n";
import { GrpcWebSocketStream, type GrpcStatus } from "../api/websocket";
import {
  USBProviderMessageSchema,
  USBServerMessageSchema,
  type USBServerMessage,
  type USBURBRequest,
} from "../gen/daemon/started_service_pb";
import {
  buildDescriptor,
  executeUrb,
  formatVidPid,
  requestUsbDevice,
  webusbStatus,
  type WebUsbUnavailableReason,
} from "./webusb";

export type ProvidedDeviceState = "attaching" | "ready" | "error";

export interface ProvidedDevice {
  deviceId: string;
  label: string;
  vendorId: number;
  productId: number;
  state: ProvidedDeviceState;
  busId?: string;
  error?: string;
}

const DETACHED_BUS_ID_TTL_MS = 10_000;

// The identity fields used to recognise the "same" physical device across a
// disconnect/reconnect — WebUSB hands out a fresh USBDevice object each replug.
type UsbDeviceIdentity = Pick<
  USBDevice,
  "vendorId" | "productId" | "serialNumber" | "manufacturerName" | "productName"
>;

function deviceLabel(device: USBDevice): string {
  return device.productName || formatVidPid(device.vendorId, device.productId);
}

function reconnectIntent(device: USBDevice): UsbDeviceIdentity {
  return {
    vendorId: device.vendorId,
    productId: device.productId,
    serialNumber: device.serialNumber,
    manufacturerName: device.manufacturerName,
    productName: device.productName,
  };
}

function usbDevicesMatch(a: UsbDeviceIdentity, b: UsbDeviceIdentity): boolean {
  if (a.vendorId !== b.vendorId || a.productId !== b.productId) {
    return false;
  }
  if (a.serialNumber || b.serialNumber) {
    return a.serialNumber === b.serialNumber;
  }
  if (a.manufacturerName && b.manufacturerName && a.manufacturerName !== b.manufacturerName) {
    return false;
  }
  if (a.productName && b.productName && a.productName !== b.productName) {
    return false;
  }
  return true;
}

export class UsbipProviderSession {
  private stream: GrpcWebSocketStream<typeof USBProviderMessageSchema, typeof USBServerMessageSchema>;
  private nextDeviceId = 1;
  private usbDevices = new Map<string, USBDevice>();
  private reconnectIntents: UsbDeviceIdentity[] = [];
  private detachedBusIdTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private listeningToUsbEvents = false;
  readonly devices = new Map<string, ProvidedDevice>();
  closed = false;
  endError: string | null = null;

  private readonly onUsbConnect = (event: USBConnectionEvent) => {
    if (this.closed || this.exactDeviceIdForUsbDevice(event.device)) {
      return;
    }
    const intentIndex = this.reconnectIntents.findIndex((intent) =>
      usbDevicesMatch(intent, event.device),
    );
    if (intentIndex < 0) {
      return;
    }
    this.reconnectIntents.splice(intentIndex, 1);
    void this.attach(event.device).catch((error) => this.onError(error));
  };

  private readonly onUsbDisconnect = (event: USBConnectionEvent) => {
    const deviceId = this.deviceIdForDisconnectedUsbDevice(event.device);
    if (!deviceId) {
      return;
    }
    void this.removeDevice(deviceId, { rememberReconnect: true, notifyServer: true });
  };

  constructor(
    config: Server,
    private serverTag: string,
    private onUpdate: () => void,
    private onError: (error: unknown) => void,
    private translate: Translate,
  ) {
    this.stream = new GrpcWebSocketStream({
      config,
      service: "daemon.StartedService",
      method: "ProvideUSBDevices",
      requestSchema: USBProviderMessageSchema,
      responseSchema: USBServerMessageSchema,
      onMessage: (message) => this.onMessage(message),
      onEnd: (status, error) => this.onEnd(status, error),
    });
    this.addUsbEventListeners();
  }

  attachedDevices(): Set<USBDevice> {
    return new Set(this.usbDevices.values());
  }

  reconnectPending(): boolean {
    return this.reconnectIntents.length > 0;
  }

  recentlyDetachedBusIds(): string[] {
    return [...this.detachedBusIdTimers.keys()];
  }

  async attach(device: USBDevice): Promise<void> {
    if (this.closed) {
      return;
    }
    if (this.exactDeviceIdForUsbDevice(device)) {
      return;
    }
    const deviceId = `dev-${this.nextDeviceId++}`;
    const entry: ProvidedDevice = {
      deviceId,
      label: deviceLabel(device),
      vendorId: device.vendorId,
      productId: device.productId,
      state: "attaching",
    };
    this.devices.set(deviceId, entry);
    this.usbDevices.set(deviceId, device);
    this.onUpdate();
    try {
      await device.open();
      if (!device.configuration && device.configurations[0]) {
        await device.selectConfiguration(device.configurations[0].configurationValue);
      }
      await claimInterfaces(device, entry.label, this.translate);
      if (this.closed || this.usbDevices.get(deviceId) !== device) {
        await releaseDevice(device);
        return;
      }
      this.stream.send({
        message: {
          case: "attach",
          value: { serverTag: this.serverTag, descriptor: buildDescriptor(device, deviceId) },
        },
      });
    } catch (error) {
      const current = this.devices.get(deviceId) === entry;
      await releaseDevice(device);
      if (!current) {
        return;
      }
      this.devices.delete(deviceId);
      this.usbDevices.delete(deviceId);
      this.onUpdate();
      throw error;
    }
  }

  async detach(deviceId: string): Promise<void> {
    await this.removeDevice(deviceId, { rememberReconnect: false, notifyServer: true });
  }

  close(): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.removeUsbEventListeners();
    this.reconnectIntents = [];
    for (const deviceId of this.usbDevices.keys()) {
      this.stream.send({ message: { case: "detach", value: { deviceId } } });
    }
    this.stream.close();
    this.releaseAllUsbDevices();
    this.devices.clear();
    this.clearDetachedBusIds();
  }

  private releaseAllUsbDevices(): void {
    for (const device of this.usbDevices.values()) {
      void releaseDevice(device);
    }
    this.usbDevices.clear();
  }

  private async removeDevice(
    deviceId: string,
    options: { rememberReconnect: boolean; notifyServer: boolean },
  ): Promise<void> {
    const entry = this.devices.get(deviceId);
    const device = this.usbDevices.get(deviceId);
    if (!entry && !device) {
      return;
    }
    if (options.rememberReconnect && device) {
      this.reconnectIntents.push(reconnectIntent(device));
    }
    if (entry?.busId) {
      this.suppressDetachedBusId(entry.busId);
    }
    if (options.notifyServer && !this.closed) {
      this.stream.send({ message: { case: "detach", value: { deviceId } } });
    }
    this.devices.delete(deviceId);
    this.usbDevices.delete(deviceId);
    this.onUpdate();
    if (device) {
      await releaseDevice(device);
    }
  }

  private exactDeviceIdForUsbDevice(device: USBDevice): string | null {
    for (const [deviceId, activeDevice] of this.usbDevices) {
      if (activeDevice === device) {
        return deviceId;
      }
    }
    return null;
  }

  private deviceIdForDisconnectedUsbDevice(device: USBDevice): string | null {
    const exactDeviceId = this.exactDeviceIdForUsbDevice(device);
    if (exactDeviceId) {
      return exactDeviceId;
    }
    let matchedDeviceId: string | null = null;
    for (const [deviceId, activeDevice] of this.usbDevices) {
      if (!usbDevicesMatch(activeDevice, device)) {
        continue;
      }
      if (matchedDeviceId) {
        return null;
      }
      matchedDeviceId = deviceId;
    }
    return matchedDeviceId;
  }

  private suppressDetachedBusId(busId: string): void {
    this.clearDetachedBusId(busId);
    const timer = setTimeout(() => {
      this.detachedBusIdTimers.delete(busId);
      this.onUpdate();
    }, DETACHED_BUS_ID_TTL_MS);
    this.detachedBusIdTimers.set(busId, timer);
  }

  private clearDetachedBusId(busId: string): void {
    const timer = this.detachedBusIdTimers.get(busId);
    if (timer) {
      clearTimeout(timer);
      this.detachedBusIdTimers.delete(busId);
    }
  }

  private clearDetachedBusIds(): void {
    for (const timer of this.detachedBusIdTimers.values()) {
      clearTimeout(timer);
    }
    this.detachedBusIdTimers.clear();
  }

  private addUsbEventListeners(): void {
    if (typeof navigator === "undefined" || !("usb" in navigator)) {
      return;
    }
    navigator.usb.addEventListener("connect", this.onUsbConnect);
    navigator.usb.addEventListener("disconnect", this.onUsbDisconnect);
    this.listeningToUsbEvents = true;
  }

  private removeUsbEventListeners(): void {
    if (!this.listeningToUsbEvents) {
      return;
    }
    navigator.usb.removeEventListener("connect", this.onUsbConnect);
    navigator.usb.removeEventListener("disconnect", this.onUsbDisconnect);
    this.listeningToUsbEvents = false;
  }

  private onMessage(message: USBServerMessage): void {
    switch (message.message.case) {
      case "ready": {
        const ready = message.message.value;
        const entry = this.devices.get(ready.deviceId);
        if (entry) {
          entry.state = "ready";
          entry.busId = ready.busId;
          this.clearDetachedBusId(ready.busId);
          this.onUpdate();
        }
        break;
      }
      case "urbRequest":
        void this.handleUrb(message.message.value);
        break;
      case "abort":
        break;
      case "error": {
        const failure = message.message.value;
        const entry = this.devices.get(failure.deviceId);
        if (entry) {
          entry.state = "error";
          entry.error = failure.message;
          this.onUpdate();
        }
        break;
      }
    }
  }

  private async handleUrb(req: USBURBRequest): Promise<void> {
    const device = this.usbDevices.get(req.deviceId);
    if (!device) {
      return;
    }
    const result = await executeUrb(device, req);
    if (this.closed) {
      return;
    }
    if (this.usbDevices.get(req.deviceId) !== device) {
      return;
    }
    this.stream.send({
      message: {
        case: "urbResponse",
        value: {
          deviceId: req.deviceId,
          seq: req.seq,
          status: result.status,
          actualLength: result.actualLength,
          inData: result.inData,
          isoPackets: [],
        },
      },
    });
  }

  private onEnd(status: GrpcStatus | null, error?: string): void {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.removeUsbEventListeners();
    this.reconnectIntents = [];
    this.endError =
      error ??
      (status && status.code !== 0 ? status.message || `gRPC error ${status.code}` : null);
    if (this.endError) {
      for (const entry of this.devices.values()) {
        if (entry.state !== "error") {
          entry.state = "error";
          entry.error = this.endError;
        }
      }
    }
    this.releaseAllUsbDevices();
    this.clearDetachedBusIds();
    this.onUpdate();
  }
}

async function claimInterfaces(device: USBDevice, label: string, t: Translate): Promise<void> {
  const interfaces = device.configuration?.interfaces ?? [];
  let blocked = false;
  let protectedClass = false;
  await Promise.all(
    interfaces.map(async (iface) => {
      try {
        await device.claimInterface(iface.interfaceNumber);
      } catch (error) {
        console.warn(`[usbip] could not claim interface ${iface.interfaceNumber}`, error);
        blocked = true;
        if (error instanceof Error && error.name === "SecurityError") {
          protectedClass = true;
        }
      }
    }),
  );
  if (!blocked) {
    return;
  }
  throw new Error(
    protectedClass
      ? t(
          "Can't share “{label}”: the browser blocks sharing this device's interface class (such as HID, storage, audio or video).",
          { label },
        )
      : t(
          "Can't share “{label}”: another program or driver is using it. Close anything using the device, then try again.",
          { label },
        ),
  );
}

async function releaseDevice(device: USBDevice): Promise<void> {
  if (!device.opened) {
    return;
  }
  try {
    await Promise.all(
      (device.configuration?.interfaces ?? []).map((iface) =>
        device.releaseInterface(iface.interfaceNumber).catch(() => {}),
      ),
    );
    await device.close();
  } catch (error) {
    console.warn("[usbip] error releasing device", error);
  }
}

export interface PermittedDevice {
  device: USBDevice;
  label: string;
  vidPid: string;
  attached: boolean;
}

export interface UsbipProvider {
  available: boolean;
  reason?: WebUsbUnavailableReason;
  devices: ProvidedDevice[];
  endError: string | null;
  reconnectPending: boolean;
  detachedBusIds: string[];
  listPermitted: () => Promise<PermittedDevice[]>;
  attachPermitted: (device: USBDevice) => Promise<void>;
  connectNew: () => Promise<void>;
  detach: (deviceId: string) => void;
}

export function useUsbipProvider(config: Server, serverTag: string): UsbipProvider {
  const status = webusbStatus();
  const { t } = useI18n();
  const sessionRef = useRef<UsbipProviderSession | null>(null);
  const [, forceUpdate] = useReducer((n: number) => n + 1, 0);

  const translateRef = useRef(t);
  translateRef.current = t;

  useEffect(() => {
    return () => {
      sessionRef.current?.close();
      sessionRef.current = null;
    };
  }, [config, serverTag]);

  const ensureSession = (): UsbipProviderSession => {
    if (!sessionRef.current || sessionRef.current.closed) {
      sessionRef.current = new UsbipProviderSession(config, serverTag, forceUpdate, showError, (key, params) =>
        translateRef.current(key, params),
      );
    }
    return sessionRef.current;
  };

  const listPermitted = async (): Promise<PermittedDevice[]> => {
    if (!status.available) {
      return [];
    }
    let devices: USBDevice[];
    try {
      devices = await navigator.usb.getDevices();
    } catch {
      return [];
    }
    const attached = sessionRef.current?.attachedDevices() ?? new Set<USBDevice>();
    return devices.map((device) => ({
      device,
      label: deviceLabel(device),
      vidPid: formatVidPid(device.vendorId, device.productId),
      attached: attached.has(device),
    }));
  };

  const attachPermitted = async (device: USBDevice): Promise<void> => {
    if (!status.available) {
      return;
    }
    await ensureSession().attach(device);
  };

  const connectNew = async (): Promise<void> => {
    if (!status.available) {
      return;
    }
    let device: USBDevice;
    try {
      device = await requestUsbDevice();
    } catch {
      return;
    }
    await ensureSession().attach(device);
  };

  const detach = (deviceId: string) => {
    void sessionRef.current?.detach(deviceId);
  };

  return {
    available: status.available,
    reason: status.available ? undefined : status.reason,
    devices: sessionRef.current ? [...sessionRef.current.devices.values()] : [],
    endError: sessionRef.current?.endError ?? null,
    reconnectPending: sessionRef.current?.reconnectPending() ?? false,
    detachedBusIds: sessionRef.current?.recentlyDetachedBusIds() ?? [],
    listPermitted,
    attachPermitted,
    connectNew,
    detach,
  };
}
