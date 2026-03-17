import { useState, useEffect, useRef } from "react";
import { Action, ActionPanel, Color, Icon, Keyboard, LaunchProps, List, showToast, Toast } from "@raycast/api";
import { getProbeResultKeys, getShareUrl, type ProbeResult, type MtrResult } from "./api/globalping";
import {
  formatMtrResultAsMarkdown,
  formatProbeLabel,
  formatProbeListTitle,
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

// Detail view for one probe

function ProbeDetail({ probeResult, target }: { probeResult: ProbeResult; target: string }) {
  const result = probeResult.result as MtrResult;
  const label = formatProbeLabel(probeResult.probe);
  return <List.Item.Detail markdown={formatMtrResultAsMarkdown(target, label, result)} />;
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
      { type: "mtr", target: t.trim(), locations: [{ magic: f }], limit: defaultProbeLimit },
      `MTR to ${t}…`,
    );
  }

  // Actions

  function buildActions() {
    const finishedResults = measurement?.results.filter((r) => (r.result as MtrResult).status !== "in-progress") ?? [];

    const rawOutputs = finishedResults
      .map((r) => `### ${formatProbeLabel(r.probe)}\n\`\`\`\n${(r.result as MtrResult).rawOutput}\n\`\`\``)
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
              content={rawOutputs}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
            <Action.CopyToClipboard
              title="Copy Share Link"
              content={getShareUrl(measurement.id)}
            />
            <Action.CreateQuicklink
              title="Create Raycast Quicklink"
              icon={Icon.Star}
              quicklink={createMtrQuicklink(target, selectedFrom)}
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
