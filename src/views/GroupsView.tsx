import { useState } from "react";

import { proxyDisplayType, urlTestDelayTone } from "../api/format";
import { useStream } from "../api/stream";
import { useApi } from "../app/context";
import { showError } from "../app/errorStore";
import { useI18n } from "../app/i18n";
import { Icon } from "../components/Icon";
import { StreamBanner } from "../components/StreamBanner";
import { Badge, Card, EmptyState, Spinner } from "../components/ui";
import type { Group, GroupItem } from "../gen/daemon/started_service_pb";

export function GroupsView() {
  const api = useApi();
  const { t } = useI18n();
  const groups = useStream(api.groups);

  return (
    <div className="page">
      <div className="page-header">
        <h1 className="page-title">{t("Groups")}</h1>
      </div>
      <StreamBanner snapshot={groups} subject="groups" />
      {groups.data.loaded && groups.data.groups.length === 0 && (
        <EmptyState icon="folder">{t("Empty groups")}</EmptyState>
      )}
      {!groups.data.loaded && groups.phase !== "error" && <EmptyState>{t("Loading...")}</EmptyState>}
      {groups.data.groups.map((group) => (
        <GroupCard key={group.tag} group={group} />
      ))}
    </div>
  );
}

function GroupCard(props: { group: Group }) {
  const api = useApi();
  const { t } = useI18n();
  const group = props.group;
  const [expandOverride, setExpandOverride] = useState<boolean | null>(null);
  const [testing, setTesting] = useState(false);
  const [pendingSelection, setPendingSelection] = useState<string | null>(null);

  const expanded = expandOverride ?? group.isExpand;
  const selected = pendingSelection ?? group.selected;
  if (pendingSelection !== null && group.selected === pendingSelection) {
    setPendingSelection(null);
  }

  const toggleExpand = () => {
    const next = !expanded;
    setExpandOverride(next);
    api.setGroupExpand(group.tag, next).catch(() => setExpandOverride(null));
  };

  const runURLTest = () => {
    setTesting(true);
    api
      .urlTest(group.tag)
      .catch(showError)
      .finally(() => setTesting(false));
  };

  const selectItem = (item: GroupItem) => {
    if (!group.selectable || item.tag === selected) {
      return;
    }
    setPendingSelection(item.tag);
    api.selectOutbound(group.tag, item.tag).catch((error: unknown) => {
      setPendingSelection(null);
      showError(error);
    });
  };

  return (
    <div className="group-card">
      <Card
        title={
          <>
            {group.tag}
            <span style={{ marginLeft: 8, color: "var(--text-faint)", fontWeight: 500 }}>
              {proxyDisplayType(group.type)}
            </span>
          </>
        }
        actions={
          <>
            <Badge>{group.items.length}</Badge>
            <button className="icon-button" title={t("URL test")} onClick={runURLTest} disabled={testing}>
              {testing ? <Spinner /> : <Icon name="speed" />}
            </button>
            <button
              className="icon-button"
              title={expanded ? t("Collapse") : t("Expand")}
              onClick={toggleExpand}
            >
              <Icon name={expanded ? "expand_less" : "expand_more"} />
            </button>
          </>
        }
      >
        {expanded ? (
          <div className="group-items">
            {group.items.map((item) => (
              <button
                key={item.tag}
                className={item.tag === selected ? "group-item selected" : "group-item"}
                onClick={() => selectItem(item)}
              >
                <span className="item-tag">{item.tag}</span>
                <span className="item-meta">
                  <span>{proxyDisplayType(item.type)}</span>
                  {item.urlTestDelay > 0 && (
                    <span className={`delay-text ${urlTestDelayTone(item.urlTestDelay)}`}>
                      {item.urlTestDelay}ms
                    </span>
                  )}
                </span>
              </button>
            ))}
          </div>
        ) : (
          <div className="group-dots">
            {group.items.map((item) => {
              const tone = item.urlTestDelay > 0 ? urlTestDelayTone(item.urlTestDelay) : "";
              const isSelected = item.tag === selected ? " selected" : "";
              return (
                <span
                  key={item.tag}
                  className={`group-dot ${tone}${isSelected}`}
                  title={`${item.tag}${item.urlTestDelay > 0 ? ` (${item.urlTestDelay}ms)` : ""}`}
                />
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}
