import { useState, useEffect, useRef } from "react";
import { Action, ActionPanel, Color, Icon, Keyboard, LaunchProps, List, showToast, Toast } from "@raycast/api";
import { getProbeResultKeys, getShareUrl, type ProbeResult, type PingResult } from "./api/globalping";
import {
  getProbeFlagIcon,
  formatProbeLabel,
  formatProbeListTitle,
  formatProbeSubtitle,
  getLatencyIcon,
  formatResultsAsMarkdownTable,
} from "./utils/formatters";
import { getProbeLimitPreference } from "./utils/preferences";
import { createPingQuicklink } from "./utils/quicklinks";
import { getRefreshActionHint } from "./utils/shortcuts";
import { useLocations } from "./hooks/useLocations";
import { useMeasurement } from "./hooks/useMeasurement";

interface Arguments {
  target: string;
  from: string;
}

const PING_PACKET_COUNT = 5;
type SuccessfulPingStats = {
  min: number;
  max: number;
  avg: number;
  loss: number;
  total?: number;
  rcv?: number;
  drop?: number;
};

function hasPingStats(result: PingResult): result is PingResult & { stats: SuccessfulPingStats } {
  return (
    result.stats != null &&
    result.stats.avg != null &&
    result.stats.min != null &&
    result.stats.max != null &&
    result.stats.loss != null
  );
}

function getPingFailureMessage(result: PingResult): string {
  const rawOutput = result.rawOutput?.trim();
  if (!rawOutput) {
    return "The probe could not complete the ping request.";
  }

  return rawOutput;
}

function formatPingProviderName(provider: string): string {
  if (process.platform !== "win32") {
    return provider;
  }

  return provider.replaceAll(" ", "-");
}

function formatPingIpAddress(ipAddress: string): string {
  if (process.platform !== "win32") {
    return ipAddress;
  }

  // Word joiner keeps the dots visually intact while changing Windows text layout behavior.
  return ipAddress.replaceAll(".", ".\u2060");
}

// Detail view for one probe

function ProbeDetail({ probeResult }: { probeResult: ProbeResult }) {
  const result = probeResult.result as PingResult;
  const probe = probeResult.probe;
  const label = formatProbeLabel(probe);
  const stats = result.stats;
  const receivedCount = stats?.rcv ?? result.timings?.length ?? 0;
  const transmittedCount = stats?.total ?? result.timings?.length ?? 0;
  const samples = result.timings?.slice(0, PING_PACKET_COUNT) ?? [];
  const failed = result.status === "failed" || (result.status !== "in-progress" && !hasPingStats(result));
  const inProgress = result.status === "in-progress";
  const successfulStats = hasPingStats(result) ? result.stats : null;

  return (
    <List.Item.Detail
      markdown={
        failed
          ? `## Ping failed\n\n\`\`\`\n${getPingFailureMessage(result)}\n\`\`\``
          : inProgress
            ? "*Ping in progress…*"
            : undefined
      }
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Location" text={label} icon={getProbeFlagIcon(probe)} />
          <List.Item.Detail.Metadata.Label title="Network" text={formatPingProviderName(formatProbeSubtitle(probe))} />
          {result.resolvedAddress && <List.Item.Detail.Metadata.Label title="IP" text={formatPingIpAddress(result.resolvedAddress)} />}
          {result.resolvedHostname && result.resolvedHostname !== result.resolvedAddress && (
            <List.Item.Detail.Metadata.Label title="Hostname" text={result.resolvedHostname} />
          )}
          <List.Item.Detail.Metadata.Separator />
          {failed ? (
            <>
              <List.Item.Detail.Metadata.Label title="Status" text={{ value: "Failed", color: Color.Red }} />
              <List.Item.Detail.Metadata.Label title="Packets" text={`${receivedCount}/${transmittedCount}`} />
            </>
          ) : inProgress ? (
            <>
              <List.Item.Detail.Metadata.Label title="Status" text={{ value: "Running", color: Color.Yellow }} />
              <List.Item.Detail.Metadata.Label title="Packets" text={`${receivedCount}/${transmittedCount}`} />
            </>
          ) : (
            <>
              {successfulStats ? (
                <>
                  <List.Item.Detail.Metadata.Label title="Avg latency" text={`${successfulStats.avg} ms`} />
                  <List.Item.Detail.Metadata.Label title="Min latency" text={`${successfulStats.min} ms`} />
                  <List.Item.Detail.Metadata.Label title="Max latency" text={`${successfulStats.max} ms`} />
                  <List.Item.Detail.Metadata.Label title="Packet loss" text={`${successfulStats.loss}%`} />
                </>
              ) : (
                <List.Item.Detail.Metadata.Label title="Status" text="Finished" />
              )}
              <List.Item.Detail.Metadata.Label title="Packets" text={`${receivedCount}/${transmittedCount}`} />
            </>
          )}
          {!failed && !inProgress && samples.length > 0 && <List.Item.Detail.Metadata.Separator />}
          {!failed &&
            !inProgress &&
            samples.map((sample, index) => (
              <List.Item.Detail.Metadata.Label
                key={`${sample.ttl}-${sample.rtt}-${index}`}
                title={`Ping ${index + 1}`}
                text={`${sample.rtt} ms  TTL ${sample.ttl}`}
              />
            ))}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

// Main command

export default function Command(props: LaunchProps<{ arguments: Arguments }>) {
  return <PingCommand initialTarget={props.arguments.target ?? ""} initialFrom={props.arguments.from?.trim() || ""} />;
}

function PingCommand({ initialTarget = "", initialFrom = "" }: { initialTarget?: string; initialFrom?: string }) {
  const [target, setTarget] = useState(initialTarget);
  const [from, setFrom] = useState(initialFrom);
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
    void handleRun(initialTarget, initialFrom || preferredLocation || "world");
  }, [initialTarget, initialFrom, preferredLocation, isLocationsLoading]);

  // Run test

  async function handleRun(t: string, f: string) {
    if (!t.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Target is required" });
      return;
    }
    await runTest(
      {
        type: "ping",
        target: t.trim(),
        locations: [{ magic: f }],
        limit: defaultProbeLimit,
        measurementOptions: { packets: PING_PACKET_COUNT },
      },
      `Pinging ${t}…`,
    );
  }

  // Actions

  function buildActions() {
    const finishedResults = measurement?.results.filter((r) => (r.result as PingResult).status !== "in-progress") ?? [];

    const markdownTable = measurement
      ? formatResultsAsMarkdownTable(
          target,
          finishedResults.map((r) => {
            const pingResult = r.result as PingResult;

            return {
              probe: r.probe,
              min: pingResult.stats?.min ?? undefined,
              max: pingResult.stats?.max ?? undefined,
              avg: pingResult.stats?.avg ?? undefined,
              loss: pingResult.stats?.loss ?? undefined,
            };
          }),
        )
      : "";

    return (
      <ActionPanel>
        <ActionPanel.Section>
          <Action
            title="Run Test"
            icon={Icon.Play}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={() => handleRun(target, selectedFrom)}
          />
        </ActionPanel.Section>
        {measurement && (
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Results as Markdown"
              content={markdownTable}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard
              title="Copy Share Link"
              content={getShareUrl(measurement.id)}
            />
            <Action.CreateQuicklink
              title="Create Raycast Quicklink"
              icon={Icon.Star}
              quicklink={createPingQuicklink(target, selectedFrom)}
              shortcut={Keyboard.Shortcut.Common.Save}
            />
          </ActionPanel.Section>
        )}
      </ActionPanel>
    );
  }

  // Render

  const currentCount = measurement?.results.length ?? 0;
  const pendingCount = isRunning ? Math.max(0, probeLimit - currentCount) : 0;
  const hasItems = currentCount > 0 || pendingCount > 0;
  const resultKeys = measurement ? getProbeResultKeys(measurement.results) : [];
  const actions = buildActions();

  return (
    <List
      isShowingDetail={hasItems}
      isLoading={isRunning}
      searchBarPlaceholder="Target (e.g. google.com)"
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
      actions={actions}
    >
      {!hasItems && (
        <List.EmptyView
          title={target ? getRefreshActionHint(`ping ${target}`) : "Enter a target to get started"}
          icon={Icon.Network}
        />
      )}

      {measurement?.results.map((probeResult, index) => {
        const result = probeResult.result as PingResult;
        const label = formatPingProviderName(formatProbeListTitle(probeResult.probe));
        const isFinished = result.status !== "in-progress";
        const successful = hasPingStats(result);
        const failed = isFinished && !successful;
        const successfulStats = result.stats as SuccessfulPingStats;

        return (
          <List.Item
            id={resultKeys[index]}
            key={resultKeys[index]}
            icon={getProbeFlagIcon(probeResult.probe)}
            title={label}
            accessories={
              isFinished && successful
                ? [
                    {
                      icon: getLatencyIcon(successfulStats.avg),
                      text: `${successfulStats.avg} ms`,
                      tooltip: `Min: ${successfulStats.min}ms / Max: ${successfulStats.max}ms / Loss: ${successfulStats.loss}%`,
                    },
                  ]
                : failed
                  ? [
                      {
                        icon: { source: Icon.XMarkCircle, tintColor: Color.Red },
                        text: "Failed",
                        tooltip: getPingFailureMessage(result),
                      },
                    ]
                  : [{ icon: Icon.Clock, text: "Running…" }]
            }
            detail={<ProbeDetail probeResult={probeResult} />}
            actions={actions}
          />
        );
      })}

      {Array.from({ length: pendingCount }).map((_, i) => (
        <List.Item
          id={`pending-${i}`}
          key={`pending-${i}`}
          title="Waiting for probe…"
          accessories={[{ icon: Icon.Clock }]}
          detail={<List.Item.Detail markdown="*Waiting for probe response…*" />}
          actions={actions}
        />
      ))}
    </List>
  );
}
