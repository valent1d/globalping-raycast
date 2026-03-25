import { useState, useEffect, useRef } from "react";
import { Action, ActionPanel, Color, Icon, Keyboard, LaunchProps, List, showToast, Toast } from "@raycast/api";
import { getProbeResultKeys, getShareUrl, type ProbeResult, type DnsResult, type DnsAnswer } from "./api/globalping";
import {
  getProbeFlagIcon,
  formatProbeLabel,
  formatProbeListTitle,
  formatProbeSubtitle,
  getDnsTypeColor,
  formatDnsResultsAsMarkdownTable,
} from "./utils/formatters";
import { getProbeLimitPreference } from "./utils/preferences";
import { createDnsQuicklink } from "./utils/quicklinks";
import { getRefreshActionHint } from "./utils/shortcuts";
import { useLocations } from "./hooks/useLocations";
import { useMeasurement } from "./hooks/useMeasurement";

interface Arguments {
  target: string;
  from: string;
  type: string;
}

interface SubmittedDnsRequest {
  target: string;
  from: string;
  queryType: string;
}

/**
 * Joins DNS answer values for clipboard/export actions.
 */
function formatDnsAnswersForClipboard(answers: DnsAnswer[]): string {
  return answers.map((answer) => answer.value).join(", ");
}

/**
 * Maps DNS results to the shared failed/running/successful UI states.
 */
function isDnsFailed(result: DnsResult): boolean {
  return result.status === "failed" || (result.status !== "in-progress" && (result.answers?.length ?? 0) === 0);
}

/**
 * Extracts a short DNS failure message for list tooltips and detail metadata.
 */
function getDnsFailureMessage(result: DnsResult): string {
  const rawOutput = result.rawOutput?.trim();

  if (result.status === "failed" && rawOutput) {
    return rawOutput.split(/\r?\n/).find((line) => line.trim().length > 0)?.trim() ?? rawOutput;
  }

  return (result.answers?.length ?? 0) === 0
    ? "The probe returned no DNS answers."
    : "The probe could not complete the DNS lookup.";
}

/**
 * Applies a Windows-specific provider-name workaround for truncation.
 */
function formatDnsProviderName(provider: string): string {
  if (process.platform !== "win32") {
    return provider;
  }

  return provider.replaceAll(" ", "-");
}

/**
 * Applies Windows-specific invisible joiners to preserve answer readability.
 */
function formatDnsAnswerValue(value: string): string {
  if (process.platform !== "win32") {
    return value;
  }

  return value.replaceAll(".", ".\u2060").replaceAll("-", "-\u2060");
}

// Detail view for one probe

/**
 * Renders the detail pane for a single DNS probe result.
 */
function ProbeDetail({ probeResult, target }: { probeResult: ProbeResult; target: string }) {
  const result = probeResult.result as DnsResult;
  const probe = probeResult.probe;
  const label = formatProbeLabel(probe);
  const answers = result.answers ?? [];
  const failed = isDnsFailed(result);
  const inProgress = result.status === "in-progress";

  return (
    <List.Item.Detail
      markdown={inProgress ? "*DNS lookup in progress…*" : undefined}
      metadata={
        <List.Item.Detail.Metadata>
          <List.Item.Detail.Metadata.Label title="Hostname" text={target} />
          <List.Item.Detail.Metadata.Label title="Location" text={label} icon={getProbeFlagIcon(probe)} />
          <List.Item.Detail.Metadata.Label title="Network" text={formatDnsProviderName(formatProbeSubtitle(probe))} />
          <List.Item.Detail.Metadata.Separator />
          {failed ? (
            <>
              <List.Item.Detail.Metadata.Label title="Status" text={{ value: "Failed", color: Color.Red }} />
              <List.Item.Detail.Metadata.Label title="Result" text={getDnsFailureMessage(result)} />
            </>
          ) : inProgress ? (
            <List.Item.Detail.Metadata.Label title="Status" text={{ value: "Running", color: Color.Yellow }} />
          ) : (
            <>
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
                  text={formatDnsAnswerValue(answer.value)}
                />
              ))}
              {answers.length === 0 && <List.Item.Detail.Metadata.Label title="Result" text="No answers" />}
            </>
          )}
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

/**
 * Main Raycast command for running Globalping DNS lookups.
 */
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
  const [submittedRequest, setSubmittedRequest] = useState<SubmittedDnsRequest | null>(null);
  const [selectedItemId, setSelectedItemId] = useState<string | null>(null);
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
    const trimmedTarget = t.trim();
    const normalizedQueryType = qt.toUpperCase();

    if (!trimmedTarget) {
      await showToast({ style: Toast.Style.Failure, title: "Target is required" });
      return;
    }

    setSubmittedRequest({ target: trimmedTarget, from: f, queryType: normalizedQueryType });
    await runTest(
      {
        type: "dns",
        target: trimmedTarget,
        locations: [{ magic: f }],
        limit: defaultProbeLimit,
        measurementOptions: { query: { type: normalizedQueryType } },
      },
      `Resolving ${normalizedQueryType} ${trimmedTarget}…`,
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
    const requestTarget = submittedRequest?.target ?? target;
    const requestFrom = submittedRequest?.from ?? selectedFrom;
    const requestQueryType = submittedRequest?.queryType ?? queryType;
    const finishedResults = measurement?.results.filter((r) => (r.result as DnsResult).status !== "in-progress") ?? [];
    const selectedResult = probeResult?.result as DnsResult | undefined;
    const selectedAnswers = selectedResult?.answers ?? [];

    const markdownTable = measurement
      ? formatDnsResultsAsMarkdownTable(
          requestTarget,
          requestQueryType,
          finishedResults.map((r) => ({ probe: r.probe, answers: (r.result as DnsResult).answers })),
        )
      : "";

    return (
      <ActionPanel>
        <ActionPanel.Section>
          <Action
            title="Run Test"
            icon={Icon.Play}
            shortcut={Keyboard.Shortcut.Common.Refresh}
            onAction={() => handleRun(target, selectedFrom, queryType)}
          />
          {selectedAnswers.length > 0 && (
            <Action.CopyToClipboard
              title={selectedAnswers.length === 1 ? "Copy Answer" : "Copy Answers"}
              content={formatDnsAnswersForClipboard(selectedAnswers)}
              shortcut={Keyboard.Shortcut.Common.Copy}
            />
          )}
        </ActionPanel.Section>
        <ActionPanel.Section title="DNS Types">
          <Action
            title="Select A-Type Record"
            icon={Icon.TextCursor}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "a" },
              Windows: { modifiers: ["ctrl", "shift"], key: "a" },
            }}
            onAction={() => applyQueryType("A")}
          />
          <Action
            title="Select AAAA Record"
            icon={Icon.TextCursor}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "4" },
              Windows: { modifiers: ["ctrl", "shift"], key: "4" },
            }}
            onAction={() => applyQueryType("AAAA")}
          />
          <Action
            title="Select TXT Record"
            icon={Icon.TextCursor}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "x" },
              Windows: { modifiers: ["ctrl", "shift"], key: "x" },
            }}
            onAction={() => applyQueryType("TXT")}
          />
          <Action
            title="Select MX Record"
            icon={Icon.TextCursor}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "m" },
              Windows: { modifiers: ["ctrl", "shift"], key: "m" },
            }}
            onAction={() => applyQueryType("MX")}
          />
          <Action
            title="Select NS Record"
            icon={Icon.TextCursor}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "n" },
              Windows: { modifiers: ["ctrl", "shift"], key: "n" },
            }}
            onAction={() => applyQueryType("NS")}
          />
          <Action
            title="Select CNAME Record"
            icon={Icon.TextCursor}
            shortcut={{
              macOS: { modifiers: ["cmd", "shift"], key: "c" },
              Windows: { modifiers: ["ctrl", "shift"], key: "c" },
            }}
            onAction={() => applyQueryType("CNAME")}
          />
        </ActionPanel.Section>
        {measurement && (
          <ActionPanel.Section>
            <Action.CopyToClipboard
              title="Copy Results as Markdown"
              content={markdownTable}
            />
            <Action.CopyToClipboard
              title="Copy Share Link"
              content={getShareUrl(measurement.id)}
            />
            <Action.CreateQuicklink
              title="Create Raycast Quicklink"
              icon={Icon.Star}
              quicklink={createDnsQuicklink(requestTarget, requestFrom, requestQueryType)}
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
  const selectedProbeResult =
    measurement?.results.find((_, index) => resultKeys[index] === selectedItemId) ?? measurement?.results[0];
  const actions = buildActions(selectedProbeResult);
  const detailTarget = submittedRequest?.target ?? target;

  return (
    <List
      isShowingDetail={hasResults}
      isLoading={isRunning}
      searchBarPlaceholder="Hostname (e.g. google.com)"
      searchText={target}
      onSearchTextChange={setTarget}
      onSelectionChange={setSelectedItemId}
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
          title={target ? getRefreshActionHint(`resolve ${target}`) : "Enter a hostname to get started"}
          icon={Icon.Network}
        />
      )}

      {measurement?.results.map((probeResult, index) => {
        const result = probeResult.result as DnsResult;
        const label = formatDnsProviderName(formatProbeListTitle(probeResult.probe));
        const isFinished = result.status !== "in-progress";
        const failed = isDnsFailed(result);
        const answers = result.answers ?? [];
        const firstAnswer = answers[0];
        const allValues = answers.map((a) => `${a.type} ${a.value}`).join("\n");

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
                        tooltip: getDnsFailureMessage(result),
                      },
                    ]
                  : firstAnswer
                    ? [
                        {
                          tag: { value: firstAnswer.type, color: getDnsTypeColor(firstAnswer.type) },
                          tooltip: allValues,
                        },
                      ]
                    : [{ text: "No answers" }]
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
