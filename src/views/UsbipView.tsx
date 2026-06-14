import { useRef, useState } from "react";

import { useStream } from "../api/stream";
import { useApi, useIsMobile, useNavigationGuard } from "../app/context";
import { showError } from "../app/errorStore";
import { useDismiss } from "../app/hooks";
import { useI18n, type MessageKey, type Translate } from "../app/i18n";
import { Icon } from "../components/Icon";
import { StreamStates } from "../components/StreamBanner";
import {
  DataLine,
  DetailSection,
  DetailShell,
  Dialog,
  EmptyState,
  MenuLabel,
  Spinner,
} from "../components/ui";
import {
  USBBackend,
  USBDeviceState,
  type USBDeviceDescriptor,
  type USBIPServerStatus,
} from "../gen/daemon/started_service_pb";
import { bcdToVersion, usbClassTriplet, usbSpeedLabel } from "../lib/usbInfo";
import { formatVidPid } from "../lib/webusb";
import {
  useUsbipProvider,
  type PermittedDevice,
  type ProvidedDevice,
  type ProvidedDeviceState,
  type UsbipProvider,
} from "../lib/usbipProvider";
import { ToolsPageHeader } from "./ToolsView";

export function UsbipView(props: { tag: string }) {
  const api = useApi();
  const { t } = useI18n();
  const isMobile = useIsMobile();
  const usbip = useStream(api.usbip);
  const provider = useUsbipProvider(api.config, props.tag);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const [detailKey, setDetailKey] = useState<string | null>(null);

  const sharing = provider.devices.some((device) => device.state !== "error") || provider.reconnectPending;

  useNavigationGuard(sharing, (proceed) => setPendingLeave(() => proceed));

  const server = usbip.data.servers.find((entry) => entry.serverTag === props.tag);
  const title =
    usbip.data.servers.length > 1 && props.tag ? t("USB/IP: {tag}", { tag: props.tag }) : t("USB/IP");

  const rows = server ? mergeDeviceRows(server, provider, t) : [];
  const selected = detailKey !== null ? (rows.find((row) => row.key === detailKey && row.descriptor) ?? null) : null;
  const detail = selected && (
    <DetailShell
      backLabel={t("USB/IP")}
      title={selected.name}
      onClose={() => setDetailKey(null)}
    >
      <UsbDeviceDetailBody row={selected} />
    </DetailShell>
  );

  if (isMobile && detail) {
    return detail;
  }

  return (
    <div className="page">
      <ToolsPageHeader
        title={title}
        actions={server && provider.available ? <AddDeviceMenu provider={provider} /> : undefined}
      />
      <StreamStates
        snapshot={usbip}
        subject="USB/IP servers"
        loaded={usbip.data.loaded}
        empty={!server}
        emptyIcon="usb"
        emptyMessage={t("No usbip-server found")}
      />
      {server && (
        <div className="settings-stack">
          <DevicesSection provider={provider} rows={rows} onOpen={setDetailKey} />
        </div>
      )}
      {detail}
      {pendingLeave && (
        <Dialog onClose={() => setPendingLeave(null)}>
          <h3>{t("Stop sharing devices?")}</h3>
          <p className="dialog-message">
            {t("Leaving this screen stops sharing the USB devices you're providing.")}
          </p>
          <div className="row-actions dialog-actions">
            <button className="button" onClick={() => setPendingLeave(null)}>
              {t("Cancel")}
            </button>
            <button
              className="button primary"
              onClick={() => {
                const proceed = pendingLeave;
                setPendingLeave(null);
                proceed();
              }}
            >
              {t("Leave")}
            </button>
          </div>
        </Dialog>
      )}
    </div>
  );
}

interface DeviceRow {
  key: string;
  name: string;
  vidPid?: string;
  busId?: string;
  backend?: string;
  state?: { label: string; tone: string };
  error?: string;
  descriptor?: USBDeviceDescriptor;
  onDetach?: () => void;
}

const PROVIDED_STATE: Record<ProvidedDeviceState, { tone: string; key: MessageKey }> = {
  attaching: { tone: "medium", key: "Attaching..." },
  ready: { tone: "good", key: "Ready" },
  error: { tone: "bad", key: "Error" },
};

function serverState(state: USBDeviceState, t: Translate): { label: string; tone: string } | undefined {
  switch (state) {
    case USBDeviceState.USB_DEVICE_STATE_IDLE:
      return { label: t("Idle"), tone: "good" };
    case USBDeviceState.USB_DEVICE_STATE_ATTACHED:
      return { label: t("Attached"), tone: "medium" };
    case USBDeviceState.USB_DEVICE_STATE_UNAVAILABLE:
      return { label: t("Unavailable"), tone: "bad" };
  }
}

function backendLabel(backend: USBBackend): string | undefined {
  switch (backend) {
    case USBBackend.USB_BACKEND_LINUX_SYSFS:
      return "linux-sysfs";
    case USBBackend.USB_BACKEND_DYNAMIC:
      return "dynamic";
    case USBBackend.USB_BACKEND_DARWIN_IOKIT:
      return "darwin-iokit";
    case USBBackend.USB_BACKEND_WINDOWS_VBOXUSB:
      return "windows-vboxusb";
    default:
      return undefined;
  }
}

function mergeDeviceRows(server: USBIPServerStatus, provider: UsbipProvider, t: Translate): DeviceRow[] {
  const providedByBusId = new Map<string, ProvidedDevice>();
  for (const device of provider.devices) {
    if (device.state === "ready" && device.busId) {
      providedByBusId.set(device.busId, device);
    }
  }
  const matched = new Set<string>();
  const detachedBusIds = new Set(provider.detachedBusIds);

  const rows: DeviceRow[] = [];
  for (const device of server.devices) {
    const descriptor = device.descriptor;
    const provided = device.busId ? providedByBusId.get(device.busId) : undefined;
    if (!provided && detachedBusIds.has(device.busId)) {
      continue;
    }
    if (provided) {
      matched.add(provided.deviceId);
    }
    rows.push({
      key: device.stableId || device.busId,
      name:
        descriptor?.product ||
        (descriptor ? formatVidPid(descriptor.vendorId, descriptor.productId) : device.busId),
      vidPid: descriptor ? formatVidPid(descriptor.vendorId, descriptor.productId) : undefined,
      busId: device.busId,
      backend: backendLabel(device.backend),
      state: serverState(device.state, t),
      descriptor,
      onDetach: provided ? () => provider.detach(provided.deviceId) : undefined,
    });
  }

  for (const device of provider.devices) {
    if (matched.has(device.deviceId)) {
      continue;
    }
    rows.push({
      key: `provided-${device.deviceId}`,
      name: device.label,
      vidPid: formatVidPid(device.vendorId, device.productId),
      busId: device.state === "ready" ? device.busId : undefined,
      state: { label: t(PROVIDED_STATE[device.state].key), tone: PROVIDED_STATE[device.state].tone },
      error: device.state === "error" ? device.error : undefined,
      onDetach: () => provider.detach(device.deviceId),
    });
  }

  return rows;
}

function DevicesSection({
  provider,
  rows,
  onOpen,
}: {
  provider: UsbipProvider;
  rows: DeviceRow[];
  onOpen: (key: string) => void;
}) {
  const { t } = useI18n();

  return (
    <div>
      <div className="list-section-title">{t("Devices")}</div>
      <div className="usbip-list">
        {provider.endError && (
          <div className="banner error">
            <Icon name="warning_amber" />
            <div>{provider.endError}</div>
          </div>
        )}
        {rows.length === 0 ? (
          <EmptyState icon="usb">
            {provider.available
              ? t("Pick a USB device to share it through this usbip-server.")
              : t("No devices shared yet.")}
          </EmptyState>
        ) : (
          rows.map((row) => <DeviceItem key={row.key} row={row} onOpen={onOpen} />)
        )}
      </div>
      {!provider.available && (
        <div className="hint" style={{ padding: "8px 4px 0" }}>
          {provider.reason === "insecure"
            ? t("WebUSB requires a secure context. Open the dashboard via localhost or over HTTPS.")
            : t(
                "To provide devices, use a Chromium-based browser with the sing-box dashboard, or the sing-box graphical client on macOS or Android.",
              )}
        </div>
      )}
    </div>
  );
}

function AddDeviceMenu({ provider }: { provider: UsbipProvider }) {
  const { t } = useI18n();
  const [open, setOpen] = useState(false);
  const [permitted, setPermitted] = useState<PermittedDevice[] | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useDismiss(ref, open, () => setOpen(false));

  const toggle = () => {
    if (open) {
      setOpen(false);
      return;
    }
    setPermitted(null);
    setOpen(true);
    void provider.listPermitted().then(setPermitted, () => setPermitted([]));
  };

  const pick = (entry: PermittedDevice) => {
    setOpen(false);
    void provider.attachPermitted(entry.device).catch(showError);
  };

  const pickOther = () => {
    setOpen(false);
    void provider.connectNew().catch(showError);
  };

  return (
    <div className="menu-anchor" ref={ref}>
      <button
        className={open ? "icon-button active" : "icon-button"}
        title={t("Connect USB device")}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={toggle}
      >
        <Icon name="add" size={18} />
      </button>
      {open && (
        <div className="menu align-right usbip-add-menu">
          {permitted === null ? (
            <div className="usbip-add-loading">
              <Spinner />
            </div>
          ) : (
            <>
              {permitted.length > 0 && <MenuLabel>{t("Authorized devices")}</MenuLabel>}
              {permitted.map((entry, index) => (
                <button
                  key={`${entry.vidPid}-${index}`}
                  type="button"
                  className="menu-item"
                  disabled={entry.attached}
                  onClick={() => pick(entry)}
                >
                  <span className="menu-check">
                    {entry.attached && <Icon name="check" size={13} />}
                  </span>
                  <span className="usbip-add-label">{entry.label}</span>
                  <span className="usbip-add-vidpid">{entry.vidPid}</span>
                </button>
              ))}
              {permitted.length > 0 && <div className="menu-divider" />}
              <button type="button" className="menu-item" onClick={pickOther}>
                <span className="menu-check">
                  <Icon name="add" size={13} />
                </span>
                {t("Other device…")}
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function DeviceItem({ row, onOpen }: { row: DeviceRow; onOpen: (key: string) => void }) {
  const { t } = useI18n();
  const body = (
    <>
      <div className="usbip-item-head">
        <span className={`state-dot ${row.state?.tone ?? ""}`} />
        <span className="usbip-name">{row.state ? `${row.name}:` : row.name}</span>
        {row.state && <span className="usbip-subtitle">{row.state.label}</span>}
      </div>
      {row.error && <div className="usbip-error">{row.error}</div>}
    </>
  );
  return (
    <div className="usbip-item">
      {row.descriptor ? (
        <button className="usbip-item-main" onClick={() => onOpen(row.key)}>
          {body}
        </button>
      ) : (
        <div className="usbip-item-main static">{body}</div>
      )}
      {row.onDetach && (
        <button
          className="icon-button danger usbip-detach"
          title={t("Detach")}
          aria-label={t("Detach")}
          onClick={row.onDetach}
        >
          <Icon name="usb_off" size={18} />
        </button>
      )}
    </div>
  );
}

function UsbDeviceDetailBody({ row }: { row: DeviceRow }) {
  const { t } = useI18n();
  const descriptor = row.descriptor;
  if (!descriptor) {
    return null;
  }
  const speed = usbSpeedLabel(descriptor.speed);
  return (
    <>
      <DetailSection title={t("Identity")}>
        {descriptor.product && <DataLine label={t("Product")} value={descriptor.product} />}
        {row.vidPid && <DataLine label="VID:PID" value={row.vidPid} mono />}
        {descriptor.serial && <DataLine label={t("Serial number")} value={descriptor.serial} mono />}
        {descriptor.bcdDevice > 0 && (
          <DataLine label={t("Version")} value={bcdToVersion(descriptor.bcdDevice)} mono />
        )}
      </DetailSection>
      <DetailSection title={t("Connection")}>
        {row.busId && <DataLine label={t("Bus ID")} value={row.busId} mono />}
        {row.backend && <DataLine label={t("Backend")} value={row.backend} mono />}
        {speed && <DataLine label={t("Speed")} value={speed} />}
        {(descriptor.busNum > 0 || descriptor.devNum > 0) && (
          <DataLine label={t("Bus / Device")} value={`${descriptor.busNum} · ${descriptor.devNum}`} mono />
        )}
      </DetailSection>
      <DetailSection title={t("Class & Interfaces")}>
        <DataLine
          label={t("Device class")}
          value={
            descriptor.deviceClass === 0
              ? t("Defined at interface level")
              : usbClassTriplet(descriptor.deviceClass, descriptor.deviceSubClass, descriptor.deviceProtocol)
          }
          mono={descriptor.deviceClass !== 0}
        />
        {descriptor.numConfigurations > 0 && (
          <DataLine
            label={t("Configurations")}
            value={
              descriptor.configurationValue > 0
                ? t("{n} (active #{active})", {
                    n: descriptor.numConfigurations,
                    active: descriptor.configurationValue,
                  })
                : String(descriptor.numConfigurations)
            }
            mono
          />
        )}
        {descriptor.interfaces.map((iface, index) => (
          <DataLine
            key={index}
            label={t("Interface {n}", { n: index + 1 })}
            value={usbClassTriplet(iface.interfaceClass, iface.interfaceSubClass, iface.interfaceProtocol)}
            mono
          />
        ))}
      </DetailSection>
    </>
  );
}
