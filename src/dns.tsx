import { useState, useEffect, useRef } from "react";
import { List, ActionPanel, Action, Icon, showToast, Toast, LaunchProps } from "@raycast/api";
import { getProbeResultKeys, getShareUrl, type ProbeResult, type DnsResult, type DnsAnswer } from "./api/globalping";
import {
  formatProbeLabel,
  formatProbeListTitle,
  formatProbeSubtitle,
  getDnsTypeColor,
  formatDnsResultsAsMarkdownTable,
} from "./utils/formatters";
import { getProbeLimitPreference } from "./utils/preferences";
import { saveQuicklink } from "./utils/storage";
import { useLocations } from "./hooks/useLocations";
import { useMeasurement } from "./hooks/useMeasurement";

interface Arguments {
  target: string;
  from: string;
  type: string;
}

function formatDnsAnswersForClipboard(answers: DnsAnswer[]): string {
  return answers.map((answer) => answer.value).join(", ");
}

// Detail view for one probe

function ProbeDetail({ probeResult, target }: { probeResult: ProbeResult; target: string }) {
  const result = probeResult.result as DnsResult;
  const probe = probeResult.probe;
  const label = formatProbeLabel(probe);
  const answers = result.answers ?? [];

  return (
    <List.Item.Detail
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Hostname" text={target} />
          <List.Item.Detail.Metadata.Label title="Location" text={label} />
          <List.Item.Detail.Metadata.Label title="Network" text={formatProbeSubtitle(probe)} />
          <List.Item.Detail.Metadata.Separator />
          <List.Item.Detail.Metadata.Label
            title="Query time"
            text={result.timings?.total != null ? `${result.timings.total} ms` : "—"}
          />
          <List.Item.Detail.Metadata.Label title="Answers" text={String(answers.length)} />
          {answers.length > 0 && <List.Item.Detail.Metadata.Separator />}
          {answers.map((answer: DnsAnswer, index: number) => (
            <List.Item.Detail.Metadata.Label
              key={`${answer.type}-${answer.value}-${index}`}
              title={answer.type}
              text={answer.value}
            />
          ))}
          {answers.length === 0 && <List.Item.Detail.Metadata.Label title="Result" text="No answers" />}
        </List.Item.Detail.Metadata>
      }
    />
  );
}

// Main command

export default function Command(props: LaunchProps<{ arguments: Arguments }>) {
  return (
    <DnsCommand
      initialTarget={props.arguments.target ?? ""}
      initialFrom={props.arguments.from?.trim() || ""}
      initialType={props.arguments.type ?? ""}
    />
  );
}

function DnsCommand({
  initialTarget = "",
  initialFrom = "",
  initialType = "",
}: {
  initialTarget?: string;
  initialFrom?: string;
  initialType?: string;
}) {
  const [target, setTarget] = useState(initialTarget);
  const [from, setFrom] = useState(initialFrom);
  const [queryType, setQueryType] = useState((initialType || "A").toUpperCase());
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
    void handleRun(initialTarget, initialFrom || preferredLocation || "world", initialType || "A");
  }, [initialTarget, initialFrom, initialType, preferredLocation, isLocationsLoading]);

  // Run test

  async function handleRun(t: string, f: string, qt: string) {
    if (!t.trim()) {
      await showToast({ style: Toast.Style.Failure, title: "Target is required" });
      return;
    }
    await runTest(
      {
        type: "dns",
        target: t.trim(),
        locations: [{ magic: f }],
        limit: defaultProbeLimit,
        measurementOptions: { query: { type: qt.toUpperCase() } },
      },
      `Resolving ${qt.toUpperCase()} ${t}…`,
    );
  }

  async function applyQueryType(nextQueryType: string) {
    setQueryType(nextQueryType);
    if (target.trim()) {
      await handleRun(target, selectedFrom, nextQueryType);
    }
  }

  // Actions

  function buildActions(probeResult?: ProbeResult) {
    const finishedResults = measurement?.results.filter((r) => (r.result as DnsResult).status !== "in-progress") ?? [];
    const selectedResult = probeResult?.result as DnsResult | undefined;
    const selectedAnswers = selectedResult?.answers ?? [];

    const markdownTable = measurement
      ? formatDnsResultsAsMarkdownTable(
          target,
          queryType,
          finishedResults.map((r) => ({ probe: r.probe, answers: (r.result as DnsResult).answers })),
        )
      : "";

    return (
      <ActionPanel>
        <ActionPanel.Section>
          <Action
            title="Run Test"
            icon={Icon.Play}
            shortcut={{ modifiers: ["cmd"], key: "r" }}
            onAction={() => handleRun(target, selectedFrom, queryType)}
          />
          {selectedAnswers.length > 0 && (
            <Action.CopyToClipboard
              title={selectedAnswers.length === 1 ? "Copy Answer" : "Copy Answers"}
              content={formatDnsAnswersForClipboard(selectedAnswers)}
              shortcut={{ modifiers: ["cmd"], key: "c" }}
            />
          )}
        </ActionPanel.Section>
        <ActionPanel.Section title="DNS Types">
          <Action
            title="Select A-Type Record"
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "a" }}
            onAction={() => applyQueryType("A")}
          />
          <Action
            title="Select AAAA Record"
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "4" }}
            onAction={() => applyQueryType("AAAA")}
          />
          <Action
            title="Select TXT Record"
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "x" }}
            onAction={() => applyQueryType("TXT")}
          />
          <Action
            title="Select MX Record"
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "m" }}
            onAction={() => applyQueryType("MX")}
          />
          <Action
            title="Select NS Record"
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "n" }}
            onAction={() => applyQueryType("NS")}
          />
          <Action
            title="Select CNAME Record"
            icon={Icon.TextCursor}
            shortcut={{ modifiers: ["cmd", "shift"], key: "c" }}
            onAction={() => applyQueryType("CNAME")}
          />
        </ActionPanel.Section>
        {measurement && (
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Results as Markdown"
              content={markdownTable}
              shortcut={{ modifiers: ["cmd", "opt"], key: "m" }}
            />
            <Action.CopyToClipboard
              title="Copy Share Link"
              content={getShareUrl(measurement.id)}
              shortcut={{ modifiers: ["cmd", "opt"], key: "c" }}
            />
            <Action
              title="Save to Quicklinks"
              icon={Icon.Star}
              shortcut={{ modifiers: ["cmd"], key: "s" }}
              onAction={async () => {
                await saveQuicklink({ target, type: "dns", from: selectedFrom });
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
      searchBarPlaceholder="Hostname (e.g. google.com)"
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
          title={target ? `Press ⌘R to resolve ${target}` : "Enter a hostname to get started"}
          icon={Icon.Network}
        />
      )}

      {measurement?.results.map((probeResult, index) => {
        const result = probeResult.result as DnsResult;
        const label = formatProbeListTitle(probeResult.probe);
        const isFinished = result.status !== "in-progress";
        const answers = result.answers ?? [];
        const firstAnswer = answers[0];
        const allValues = answers.map((a) => `${a.type} ${a.value}`).join("\n");

        return (
          <List.Item
            key={resultKeys[index]}
            title={label}
            accessories={
              isFinished
                ? firstAnswer
                  ? [
                      {
                        tag: { value: firstAnswer.type, color: getDnsTypeColor(firstAnswer.type) },
                        tooltip: allValues,
                      },
                    ]
                  : [{ text: "No answers" }]
                : [{ icon: Icon.Clock, text: "Running…" }]
            }
            detail={<ProbeDetail probeResult={probeResult} target={target} />}
            actions={buildActions(probeResult)}
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
