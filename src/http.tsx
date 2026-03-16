import { useState, useEffect, useRef } from "react";
import { List, ActionPanel, Action, Icon, showToast, Toast, LaunchProps } from "@raycast/api";
import { getProbeResultKeys, getShareUrl, type ProbeResult, type HttpResult } from "./api/globalping";
import {
  formatProbeLabel,
  formatProbeListTitle,
  formatProbeSubtitle,
  getHttpStatusColor,
  formatHttpResultAsMarkdown,
  formatHttpResultsAsMarkdownTable,
} from "./utils/formatters";
import { getProbeLimitPreference } from "./utils/preferences";
import { saveQuicklink } from "./utils/storage";
import { useLocations } from "./hooks/useLocations";
import { useMeasurement } from "./hooks/useMeasurement";

interface Arguments {
  target: string;
  from: string;
  method: string;
}

// Detail view for one probe

function ProbeDetail({ probeResult, target }: { probeResult: ProbeResult; target: string }) {
  const result = probeResult.result as HttpResult;
  const probe = probeResult.probe;
  const label = formatProbeLabel(probe);

  return (
    <List.Item.Detail
      markdown={formatHttpResultAsMarkdown(target, label, result)}
      metadata={
        result.statusCode != null ? (
          <List.Item.Detail.Metadata>
            <List.Item.Detail.Metadata.Label title="Location" text={label} />
            <List.Item.Detail.Metadata.Label title="Network" text={formatProbeSubtitle(probe)} />
            <List.Item.Detail.Metadata.Separator />
            <List.Item.Detail.Metadata.Label
              title="Status"
              text={{ value: String(result.statusCode), color: getHttpStatusColor(result.statusCode) }}
            />
            <List.Item.Detail.Metadata.Separator />
            <List.Item.Detail.Metadata.Label
              title="Total"
              text={result.timings?.total != null ? `${result.timings.total} ms` : "—"}
            />
            <List.Item.Detail.Metadata.Label
              title="DNS"
              text={result.timings?.dns != null ? `${result.timings.dns} ms` : "—"}
            />
            <List.Item.Detail.Metadata.Label
              title="TCP"
              text={result.timings?.tcp != null ? `${result.timings.tcp} ms` : "—"}
            />
            <List.Item.Detail.Metadata.Label
              title="TLS"
              text={result.timings?.tls != null ? `${result.timings.tls} ms` : "—"}
            />
            <List.Item.Detail.Metadata.Label
              title="First byte"
              text={result.timings?.firstByte != null ? `${result.timings.firstByte} ms` : "—"}
            />
            <List.Item.Detail.Metadata.Label
              title="Download"
              text={result.timings?.download != null ? `${result.timings.download} ms` : "—"}
            />
          </List.Item.Detail.Metadata>
        ) : undefined
      }
    />
  );
}

// Main command

export default function Command(props: LaunchProps<{ arguments: Arguments }>) {
  return (
    <HttpCommand
      initialTarget={props.arguments.target ?? ""}
      initialFrom={props.arguments.from?.trim() || ""}
      initialMethod={props.arguments.method ?? ""}
    />
  );
}

function HttpCommand({
  initialTarget = "",
  initialFrom = "",
  initialMethod = "",
}: {
  initialTarget?: string;
  initialFrom?: string;
  initialMethod?: string;
}) {
  const [target, setTarget] = useState(initialTarget);
  const [from, setFrom] = useState(initialFrom);
  const [method, setMethod] = useState((initialMethod || "HEAD").toUpperCase());
  const defaultProbeLimit = getProbeLimitPreference();
  const { locationSections, preferredLocation, isLoading: isLocationsLoading } = useLocations();
  const { measurement, isRunning, runTest, probeLimit } = useMeasurement();
  const selectedFrom = from || preferredLocation || "world";
  const hasAutoRunRef = useRef(false);

  // Auto-run when both arguments are provided

  useEffect(() => {
    if (hasAutoRunRef.current || !initialTarget) {
      return;
    }

    if (!initialFrom && isLocationsLoading) {
      return;
    }

    hasAutoRunRef.current = true;
    void handleRun(initialTarget, initialFrom || preferredLocation || "world", initialMethod || "HEAD");
  }, [initialTarget, initialFrom, initialMethod, preferredLocation, isLocationsLoading]);

  // Run test

  async function handleRun(t: string, f: string, m: string) {
    if (!t.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Target is required" });
      return;
    }
    await runTest(
      {
        type: "http",
        target: t.trim(),
        locations: [{ magic: f }],
        limit: defaultProbeLimit,
        measurementOptions: { request: { method: m.toUpperCase() } },
      },
      `${m.toUpperCase()} ${t}…`,
    );
  }

  async function applyHttpMethod(nextMethod: string) {
    setMethod(nextMethod);
    if (target.trim()) {
      await handleRun(target, selectedFrom, nextMethod);
    }
  }

  // Actions

  function buildActions() {
    const finishedResults = measurement?.results.filter((r) => (r.result as HttpResult).status !== "in-progress") ?? [];

    const markdownTable = measurement
      ? formatHttpResultsAsMarkdownTable(
          target,
          finishedResults.map((r) => ({
            probe: r.probe,
            statusCode: (r.result as HttpResult).statusCode,
            timings: (r.result as HttpResult).timings,
          })),
        )
      : "";
    const markdownDetails = finishedResults
      .map((result) => formatHttpResultAsMarkdown(target, formatProbeLabel(result.probe), result.result as HttpResult))
      .join("\n\n");
    const markdownContent = [markdownTable, markdownDetails].filter(Boolean).join("\n\n");

    return (
      <ActionPanel>
        <ActionPanel.Section>
          <Action
            title="Run Test"
            icon={Icon.Play}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() => handleRun(target, selectedFrom, method)}
          />
        </ActionPanel.Section>
        <ActionPanel.Section title="HTTP Methods">
          <Action
            title={method === "HEAD" ? "Use HEAD Current" : "Use HEAD"}
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "h" }}
            onAction={() => applyHttpMethod("HEAD")}
          />
          <Action
            title={method === "GET" ? "Use GET Current" : "Use GET"}
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "g" }}
            onAction={() => applyHttpMethod("GET")}
          />
          <Action
            title={method === "POST" ? "Use POST Current" : "Use POST"}
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "p" }}
            onAction={() => applyHttpMethod("POST")}
          />
          <Action
            title={method === "PUT" ? "Use PUT Current" : "Use PUT"}
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "u" }}
            onAction={() => applyHttpMethod("PUT")}
          />
          <Action
            title={method === "DELETE" ? "Use DELETE Current" : "Use DELETE"}
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "d" }}
            onAction={() => applyHttpMethod("DELETE")}
          />
          <Action
            title={method === "OPTIONS" ? "Use OPTIONS Current" : "Use OPTIONS"}
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "o" }}
            onAction={() => applyHttpMethod("OPTIONS")}
          />
        </ActionPanel.Section>
        {measurement && (
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Results as Markdown"
              content={markdownContent}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
            <Action.CopyToClipboard
              title="Copy Share Link"
              content={getShareUrl(measurement.id)}
              shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            />
            <Action
              title="Save to Quicklinks"
              icon={Icon.Star}
              shortcut={{ modifiers: ["cmd"], key: "s" }}
              onAction={async () => {
                await saveQuicklink({ target, type: "http", from: selectedFrom });
                await showToast({ style: Toast.Style.Success, title: "Saved to Quicklinks" });
              }}
            />
          </ActionPanel.Section>
        )}
      </ActionPanel>
    );
  }

  // Render

  const currentCount = measurement?.results.length ?? 0;
  const pendingCount = isRunning ? Math.max(0, probeLimit - currentCount) : 0;
  const hasResults = isRunning || currentCount > 0;
  const resultKeys = measurement ? getProbeResultKeys(measurement.results) : [];

  return (
    <List
      isShowingDetail={hasResults}
      isLoading={isRunning}
      searchBarPlaceholder="URL or hostname (e.g. https://google.com)"
      searchText={target}
      onSearchTextChange={setTarget}
      searchBarAccessory={
        <List.Dropdown tooltip="From" value={selectedFrom} onChange={setFrom}>
          {locationSections.map((section) => (
            <List.Dropdown.Section key={section.title} title={section.title}>
              {section.items.map((item) => (
                <List.Dropdown.Item key={item.value} title={item.title} value={item.value} />
              ))}
            </List.Dropdown.Section>
          ))}
        </List.Dropdown>
      }
      actions={buildActions()}
    >
      {isRunning && currentCount === 0 && <List.EmptyView title="Contacting probes…" icon={Icon.Clock} />}
      {!hasResults && (
        <List.EmptyView
          title={target ? `Press ⌘R to ${method} ${target}` : "Enter a URL to get started"}
          icon={Icon.Globe}
        />
      )}

      {measurement?.results.map((probeResult, index) => {
        const result = probeResult.result as HttpResult;
        const label = formatProbeListTitle(probeResult.probe);
        const isFinished = result.status !== "in-progress";

        return (
          <List.Item
            key={resultKeys[index]}
            title={label}
            accessories={
              isFinished && result.statusCode != null
                ? [
                    {
                      tag: { value: String(result.statusCode), color: getHttpStatusColor(result.statusCode) },
                      tooltip: result.timings?.total != null ? `Total: ${result.timings.total}ms` : undefined,
                    },
                    ...(result.timings?.total != null ? [{ text: `${result.timings.total} ms` }] : []),
                  ]
                : [{ icon: Icon.Clock, text: "Running…" }]
            }
            detail={<ProbeDetail probeResult={probeResult} target={target} />}
            actions={buildActions()}
          />
        );
      })}

      {Array.from({ length: pendingCount }).map((_, i) => (
        <List.Item
          key={`pending-${i}`}
          title="Waiting for probe…"
          accessories={[{ icon: Icon.Clock }]}
          detail={<List.Item.Detail markdown="*Waiting for probe response…*" />}
        />
      ))}
    </List>
  );
}
