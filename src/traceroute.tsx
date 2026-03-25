import { useState, useEffect, useRef } from "react";
import { Action, ActionPanel, Color, Icon, Keyboard, LaunchProps, List, showToast, Toast } from "@raycast/api";
import {
  getProbeResultKeys,
  getShareUrl,
  type ProbeResult,
  type TracerouteHop,
  type TracerouteResult,
} from "./api/globalping";
import {
  getProbeFlagIcon,
  formatProbeLabel,
  formatProbeListTitle,
  formatProbeSubtitle,
  formatTracerouteResultAsMarkdown,
} from "./utils/formatters";
import { getProbeLimitPreference } from "./utils/preferences";
import { createTracerouteQuicklink } from "./utils/quicklinks";
import { getRefreshActionHint } from "./utils/shortcuts";
import { useLocations } from "./hooks/useLocations";
import { useMeasurement } from "./hooks/useMeasurement";

interface Arguments {
  target: string;
  from: string;
}

interface SubmittedTracerouteRequest {
  target: string;
  from: string;
}

// Detail view for one probe

function formatTracerouteHopText(hop: TracerouteHop): string {
  const host = hop.resolvedHostname || hop.resolvedAddress || "—";
  const ip =
    hop.resolvedHostname && hop.resolvedAddress && hop.resolvedAddress !== hop.resolvedHostname
      ? ` (${hop.resolvedAddress})`
      : "";
  const timings = hop.timings?.map((timing) => `${timing.rtt} ms`).join(" / ") || "—";
  return `${host}${ip} - ${timings}`;
}

function buildTracerouteHopPreview(hops: TracerouteHop[]): Array<{ title: string; text: string }> {
  return hops.map((hop, index) => ({
    title: `Hop ${index + 1}`,
    text: formatTracerouteHopText(hop),
  }));
}

function ProbeDetail({ probeResult, target }: { probeResult: ProbeResult; target: string }) {
  const result = probeResult.result as TracerouteResult;
  const probe = probeResult.probe;
  const label = formatProbeLabel(probe);
  const failed = result.status === "failed";
  const inProgress = result.status === "in-progress";
  const hops = result.hops ?? [];
  const lastHop = hops[hops.length - 1];
  const destination =
    lastHop == null
      ? "—"
      : lastHop.resolvedAddress && lastHop.resolvedAddress !== lastHop.resolvedHostname
        ? `${lastHop.resolvedHostname} (${lastHop.resolvedAddress})`
        : lastHop.resolvedHostname || lastHop.resolvedAddress || "—";
  const hopPreview = buildTracerouteHopPreview(hops);

  return (
    <List.Item.Detail
      markdown={inProgress ? "*Tracing route…*" : undefined}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Target" text={target} />
          <List.Item.Detail.Metadata.Label title="Location" text={label} icon={getProbeFlagIcon(probe)} />
          <List.Item.Detail.Metadata.Label title="Network" text={formatProbeSubtitle(probe)} />
          <List.Item.Detail.Metadata.Separator />
          {failed ? (
            <>
              <List.Item.Detail.Metadata.Label title="Status" text={{ value: "Failed", color: Color.Red }} />
              <List.Item.Detail.Metadata.Label title="Result" text={getTracerouteFailureMessage(result)} />
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
              <List.Item.Detail.Metadata.Label title="Destination" text={destination} />
            </>
          )}
          {!failed && hops.length > 0 && <List.Item.Detail.Metadata.Separator />}
          {!failed &&
            hopPreview.map((hop) => <List.Item.Detail.Metadata.Label key={`${hop.title}-${hop.text}`} title={hop.title} text={hop.text} />)}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

function getTracerouteFailureMessage(result: TracerouteResult): string {
  const rawOutput = result.rawOutput?.trim();
  if (!rawOutput) {
    return "The probe could not complete the traceroute.";
  }

  return rawOutput;
}

// Main command

export default function Command(props: LaunchProps<{ arguments: Arguments }>) {
  return (
    <TracerouteCommand initialTarget={props.arguments.target ?? ""} initialFrom={props.arguments.from?.trim() || ""} />
  );
}

function TracerouteCommand({ initialTarget = "", initialFrom = "" }: { initialTarget?: string; initialFrom?: string }) {
  const [target, setTarget] = useState(initialTarget);
  const [from, setFrom] = useState(initialFrom);
  const [submittedRequest, setSubmittedRequest] = useState<SubmittedTracerouteRequest | null>(null);
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
      { type: "traceroute", target: trimmedTarget, locations: [{ magic: f }], limit: defaultProbeLimit },
      `Traceroute to ${trimmedTarget}…`,
    );
  }

  // Actions

  function buildActions() {
    const requestTarget = submittedRequest?.target ?? target;
    const requestFrom = submittedRequest?.from ?? selectedFrom;
    const finishedResults =
      measurement?.results.filter((r) => (r.result as TracerouteResult).status !== "in-progress") ?? [];

    const markdownOutputs = finishedResults
      .map((r) =>
        formatTracerouteResultAsMarkdown(requestTarget, formatProbeLabel(r.probe), r.result as TracerouteResult),
      )
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
              content={markdownOutputs}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard
              title="Copy Share Link"
              content={getShareUrl(measurement.id)}
            />
            <Action.CreateQuicklink
              title="Create Raycast Quicklink"
              icon={Icon.Star}
              quicklink={createTracerouteQuicklink(requestTarget, requestFrom)}
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
          title={target ? getRefreshActionHint(`traceroute ${target}`) : "Enter a target to get started"}
          icon={Icon.Network}
        />
      )}

      {measurement?.results.map((probeResult, index) => {
        const result = probeResult.result as TracerouteResult;
        const label = formatProbeListTitle(probeResult.probe);
        const isFinished = result.status !== "in-progress";
        const failed = result.status === "failed";
        const hopCount = result.hops?.length ?? 0;

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
                        tooltip: getTracerouteFailureMessage(result),
                      },
                    ]
                  : [{ text: `${hopCount} hops` }]
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
