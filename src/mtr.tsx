import { useState, useEffect, useRef } from "react";
import { Action, ActionPanel, Color, Icon, Keyboard, LaunchProps, List, showToast, Toast } from "@raycast/api";
import { getProbeResultKeys, getShareUrl, type ProbeResult, type MtrResult } from "./api/globalping";
import {
  formatMtrResultAsMarkdown,
  getMtrFallbackHost,
  parseMtrRawOutputRows,
  formatProbeLabel,
  formatProbeListTitle,
  formatProbeSubtitle,
  getProbeFlagIcon,
} from "./utils/formatters";
import { getProbeLimitPreference } from "./utils/preferences";
import { createMtrQuicklink } from "./utils/quicklinks";
import { getRefreshActionHint } from "./utils/shortcuts";
import { useLocations } from "./hooks/useLocations";
import { useMeasurement } from "./hooks/useMeasurement";

interface Arguments {
  target: string;
  from: string;
}

interface SubmittedMtrRequest {
  target: string;
  from: string;
}

// Detail view for one probe

function compactMiddle(value: string, maxLength: number): string {
  if (value.length <= maxLength) {
    return value;
  }

  const headLength = Math.ceil((maxLength - 1) / 2);
  const tailLength = Math.floor((maxLength - 1) / 2);
  return `${value.slice(0, headLength)}…${value.slice(-tailLength)}`;
}

function parseMtrHostParts(host: string): { asn?: string; hostname?: string; ip?: string } {
  const match = host.match(/^(AS[^\s]+\s+)?(.+?)(?:\s+\(([^)]+)\))?$/);

  if (!match) {
    return { hostname: host };
  }

  return {
    asn: (match[1] ?? "").trim() || undefined,
    hostname: (match[2] ?? "").trim() || undefined,
    ip: match[3]?.trim(),
  };
}

function formatCompactMtrHost(host: string): string {
  const { asn, hostname, ip } = parseMtrHostParts(host);

  if (asn && ip) {
    return `${asn} ${ip}`;
  }

  if (asn) {
    return asn;
  }

  if (ip) {
    return ip;
  }

  return compactMiddle(hostname ?? host, 32);
}

function formatMtrHopMarkdown(result: MtrResult): string | undefined {
  const hops = result.hops ?? [];
  const rawRows = parseMtrRawOutputRows(result.rawOutput);
  const rowCount = Math.max(hops.length, rawRows.length);

  if (rowCount === 0) {
    return undefined;
  }

  const headers = ["Hop", "Host", "Loss", "Drop", "Rcv", "Avg"];
  const rows = Array.from({ length: rowCount }, (_, index) => {
    const hop = hops[index];
    const rawRow = rawRows[index];
    const fullHost = rawRow?.host ?? getMtrFallbackHost(hop);
    const hostParts = parseMtrHostParts(fullHost);
    const loss = rawRow?.loss ?? (hop?.stats?.loss != null ? `${hop.stats.loss}%` : "—");
    const drop = rawRow?.drop ?? (hop?.stats?.drop != null ? String(hop.stats.drop) : "—");
    const rcv = rawRow?.rcv ?? (hop?.stats?.rcv != null ? String(hop.stats.rcv) : "—");
    const avg = rawRow?.avg ?? (hop?.stats?.avg != null ? String(hop.stats.avg) : "—");
    const host = formatCompactMtrHost(fullHost);

    return {
      main: [String(index + 1), host, loss, drop, rcv, avg],
      hostname: hostParts.hostname && hostParts.hostname !== host ? hostParts.hostname : undefined,
    };
  });

  const widths = headers.map((header, columnIndex) =>
    Math.max(header.length, ...rows.map((row) => String(row.main[columnIndex]).length)),
  );
  const gap = "   ";
  const centerAlignedColumns = new Set([3, 4]);
  const formatCell = (cell: string, index: number) => {
    const value = String(cell);
    const width = widths[index];

    if (!centerAlignedColumns.has(index) || value.length >= width) {
      return value.padEnd(width, " ");
    }

    const totalPadding = width - value.length;
    const leftPadding = Math.floor(totalPadding / 2);
    const rightPadding = totalPadding - leftPadding;
    return `${" ".repeat(leftPadding)}${value}${" ".repeat(rightPadding)}`;
  };
  const formatRow = (row: string[]) => row.map((cell, index) => formatCell(cell, index)).join(gap);
  const hostColumnOffset = widths[0] + gap.length;

  const lines = rows.flatMap((row) => {
    const mainLine = formatRow(row.main);

    if (!row.hostname) {
      return [mainLine, ""];
    }

    const hostnamePadding = " ".repeat(hostColumnOffset);
    const centeredHostname = row.hostname.padStart(Math.floor((widths[1] + row.hostname.length) / 2), " ");

    return [mainLine, `${hostnamePadding}${centeredHostname}`, ""];
  });

  return ["```text", formatRow(headers), "", ...lines.slice(0, -1), "```"].join("\n");
}

function ProbeDetail({ probeResult, target }: { probeResult: ProbeResult; target: string }) {
  const result = probeResult.result as MtrResult;
  const probe = probeResult.probe;
  const label = formatProbeLabel(probe);
  const failed = result.status === "failed";
  const inProgress = result.status === "in-progress";
  const hops = result.hops ?? [];
  const lastHop = hops[hops.length - 1];
  const lastHopAvg = lastHop?.stats?.avg;
  const lastHopLoss = lastHop?.stats?.loss;
  const hopMarkdown = formatMtrHopMarkdown(result);

  return (
    <List.Item.Detail
      markdown={failed ? undefined : inProgress ? hopMarkdown ?? "*Running MTR…*" : hopMarkdown}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Target" text={target} />
          <List.Item.Detail.Metadata.Label title="Location" text={label} icon={getProbeFlagIcon(probe)} />
          <List.Item.Detail.Metadata.Label title="Network" text={formatProbeSubtitle(probe)} />
          <List.Item.Detail.Metadata.Separator />
          {failed ? (
            <>
              <List.Item.Detail.Metadata.Label title="Status" text={{ value: "Failed", color: Color.Red }} />
              <List.Item.Detail.Metadata.Label title="Result" text={getMtrFailureMessage(result)} />
            </>
          ) : inProgress ? (
            <>
              <List.Item.Detail.Metadata.Label title="Status" text={{ value: "Running", color: Color.Yellow }} />
              <List.Item.Detail.Metadata.Label title="Hops discovered" text={String(hops.length)} />
            </>
          ) : (
            <>
              <List.Item.Detail.Metadata.Label title="Status" text="Finished" />
              <List.Item.Detail.Metadata.Label title="Hops" text={String(hops.length)} />
              <List.Item.Detail.Metadata.Label title="Last hop avg" text={lastHopAvg != null ? `${lastHopAvg} ms` : "—"} />
              <List.Item.Detail.Metadata.Label
                title="Last hop loss"
                text={lastHopLoss != null ? `${lastHopLoss}%` : "—"}
              />
            </>
          )}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function getMtrFailureMessage(result: MtrResult): string {
  const rawOutput = result.rawOutput?.trim();
  if (!rawOutput) {
    return "The probe could not complete the MTR request.";
  }

  return rawOutput;
}

// Main command

export default function Command(props: LaunchProps<{ arguments: Arguments }>) {
  return <MtrCommand initialTarget={props.arguments.target ?? ""} initialFrom={props.arguments.from?.trim() || ""} />;
}

function MtrCommand({ initialTarget = "", initialFrom = "" }: { initialTarget?: string; initialFrom?: string }) {
  const [target, setTarget] = useState(initialTarget);
  const [from, setFrom] = useState(initialFrom);
  const [submittedRequest, setSubmittedRequest] = useState<SubmittedMtrRequest | null>(null);
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
    const trimmedTarget = t.trim();

    if (!trimmedTarget) {
      await showToast({ style: Toast.Style.Failure, title: "Target is required" });
      return;
    }
    setSubmittedRequest({ target: trimmedTarget, from: f });
    await runTest(
      { type: "mtr", target: trimmedTarget, locations: [{ magic: f }], limit: defaultProbeLimit },
      `MTR to ${trimmedTarget}…`,
    );
  }

  // Actions

  function buildActions() {
    const requestTarget = submittedRequest?.target ?? target;
    const requestFrom = submittedRequest?.from ?? selectedFrom;
    const finishedResults = measurement?.results.filter((r) => (r.result as MtrResult).status !== "in-progress") ?? [];

    const markdownResults = finishedResults
      .map((r) => formatMtrResultAsMarkdown(requestTarget, formatProbeLabel(r.probe), r.result as MtrResult))
      .join("\n\n");

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
              content={markdownResults}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard
              title="Copy Share Link"
              content={getShareUrl(measurement.id)}
            />
            <Action.CreateQuicklink
              title="Create Raycast Quicklink"
              icon={Icon.Star}
              quicklink={createMtrQuicklink(requestTarget, requestFrom)}
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
  const hasResults = isRunning || currentCount > 0;
  const resultKeys = measurement ? getProbeResultKeys(measurement.results) : [];
  const actions = buildActions();
  const detailTarget = submittedRequest?.target ?? target;

  return (
    <List
      isShowingDetail={hasResults}
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
      {isRunning && currentCount === 0 && <List.EmptyView title="Contacting probes…" icon={Icon.Clock} />}
      {!hasResults && (
        <List.EmptyView
          title={target ? getRefreshActionHint(`run an MTR test for ${target}`) : "Enter a target to get started"}
          icon={Icon.Network}
        />
      )}

      {measurement?.results.map((probeResult, index) => {
        const result = probeResult.result as MtrResult;
        const label = formatProbeListTitle(probeResult.probe);
        const isFinished = result.status !== "in-progress";
        const failed = result.status === "failed";
        const hopCount = result.hops?.length ?? 0;
        const lastHopAvg = result.hops?.[result.hops.length - 1]?.stats?.avg;

        return (
          <List.Item
            id={resultKeys[index]}
            key={resultKeys[index]}
            icon={getProbeFlagIcon(probeResult.probe)}
            title={label}
            accessories={
              isFinished
                ? failed
                  ? [
                      {
                        icon: { source: Icon.XMarkCircle, tintColor: Color.Red },
                        text: "Failed",
                        tooltip: getMtrFailureMessage(result),
                      },
                    ]
                  : [{ text: `${hopCount} hops` }, ...(lastHopAvg != null ? [{ text: `${lastHopAvg} ms` }] : [])]
                : [{ icon: Icon.Clock, text: "Running…" }]
            }
            detail={<ProbeDetail probeResult={probeResult} target={detailTarget} />}
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
