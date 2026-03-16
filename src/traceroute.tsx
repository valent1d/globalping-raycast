import { useState, useEffect, useRef } from "react";
import { List, ActionPanel, Action, Icon, showToast, Toast, LaunchProps } from "@raycast/api";
import { getProbeResultKeys, getShareUrl, type ProbeResult, type TracerouteResult } from "./api/globalping";
import { formatProbeLabel, formatProbeListTitle, formatTracerouteResultAsMarkdown } from "./utils/formatters";
import { getProbeLimitPreference } from "./utils/preferences";
import { saveQuicklink } from "./utils/storage";
import { useLocations } from "./hooks/useLocations";
import { useMeasurement } from "./hooks/useMeasurement";

interface Arguments {
  target: string;
  from: string;
}

// Detail view for one probe

function ProbeDetail({ probeResult, target }: { probeResult: ProbeResult; target: string }) {
  const result = probeResult.result as TracerouteResult;
  const label = formatProbeLabel(probeResult.probe);
  return <List.Item.Detail markdown={formatTracerouteResultAsMarkdown(target, label, result)} />;
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
      { type: "traceroute", target: t.trim(), locations: [{ magic: f }], limit: defaultProbeLimit },
      `Traceroute to ${t}…`,
    );
  }

  // Actions

  function buildActions() {
    const finishedResults =
      measurement?.results.filter((r) => (r.result as TracerouteResult).status !== "in-progress") ?? [];

    const rawOutputs = finishedResults
      .map((r) => `### ${formatProbeLabel(r.probe)}\n\`\`\`\n${(r.result as TracerouteResult).rawOutput}\n\`\`\``)
      .join("\n\n");

    return (
      <ActionPanel>
        <ActionPanel.Section>
          <Action
            title="Run Test"
            icon={Icon.Play}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() => handleRun(target, selectedFrom)}
          />
        </ActionPanel.Section>
        {measurement && (
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Results"
              content={rawOutputs}
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
                await saveQuicklink({ target, type: "traceroute", from: selectedFrom });
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
      actions={buildActions()}
    >
      {isRunning && currentCount === 0 && <List.EmptyView title="Contacting probes…" icon={Icon.Clock} />}
      {!hasResults && (
        <List.EmptyView
          title={target ? `Press ⌘R to traceroute ${target}` : "Enter a target to get started"}
          icon={Icon.Network}
        />
      )}

      {measurement?.results.map((probeResult, index) => {
        const result = probeResult.result as TracerouteResult;
        const label = formatProbeListTitle(probeResult.probe);
        const isFinished = result.status !== "in-progress";
        const hopCount = result.hops?.length ?? 0;

        return (
          <List.Item
            key={resultKeys[index]}
            title={label}
            accessories={isFinished ? [{ text: `${hopCount} hops` }] : [{ icon: Icon.Clock, text: "Running…" }]}
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
