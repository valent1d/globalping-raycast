import { Color, Icon, type Image } from "@raycast/api";
import type { ProbeLocation, DnsAnswer, HttpResult, MtrHop, MtrResult, TracerouteResult } from "../api/globalping";

// Probe labels

export function getCountryFlagIcon(countryCode: string): Image.ImageLike {
  const normalizedCode = countryCode.trim().toLowerCase();

  if (!/^[a-z]{2}$/.test(normalizedCode)) {
    return Icon.Globe;
  }

  return {
    source: `https://flagcdn.com/24x18/${normalizedCode}.png`,
    fallback: Icon.Globe,
  };
}

export function getProbeFlagIcon(probe: ProbeLocation): Image.ImageLike {
  return getCountryFlagIcon(probe.country);
}

export function formatProbeLabel(probe: ProbeLocation): string {
  return `${probe.city}, ${probe.country}`;
}

export function formatProbeSubtitle(probe: ProbeLocation): string {
  return probe.network;
}

export function formatProbeListTitle(probe: ProbeLocation): string {
  return probe.network;
}

// Latency icon

export function getLatencyIcon(avg: number): { source: Icon; tintColor: Color } {
  if (avg <= 50) {
    return { source: Icon.Signal3, tintColor: Color.Green };
  } else if (avg <= 150) {
    return { source: Icon.Signal2, tintColor: Color.Yellow };
  } else {
    return { source: Icon.Signal1, tintColor: Color.Red };
  }
}

// HTTP status color

export function getHttpStatusColor(statusCode: number): Color {
  if (statusCode < 300) return Color.Green;
  if (statusCode < 400) return Color.Yellow;
  return Color.Red;
}

// DNS type color

export function getDnsTypeColor(type: string): Color {
  switch (type?.toUpperCase()) {
    case "A":
      return Color.Blue;
    case "AAAA":
      return Color.Purple;
    case "CNAME":
      return Color.Orange;
    case "MX":
      return Color.Yellow;
    case "NS":
      return Color.Green;
    case "PTR":
      return Color.Magenta;
    case "TXT":
    case "SOA":
    default:
      return Color.SecondaryText;
  }
}

// Ping formatters

export function formatResultsAsMarkdownTable(
  target: string,
  results: Array<{ probe: ProbeLocation; min?: number; max?: number; avg?: number; loss?: number }>,
): string {
  if (results.length === 0) return "";

  const header = `## Ping results: ${target}\n\n| Location | Network | Avg | Min | Max | Loss |\n|---|---|---|---|---|---|`;
  const rows = results
    .map((r) => {
      const location = formatProbeLabel(r.probe);
      const network = r.probe.network;
      const avg = r.avg != null ? `${r.avg} ms` : "—";
      const min = r.min != null ? `${r.min} ms` : "—";
      const max = r.max != null ? `${r.max} ms` : "—";
      const loss = r.loss != null ? `${r.loss}%` : "—";
      return `| ${location} | ${network} | ${avg} | ${min} | ${max} | ${loss} |`;
    })
    .join("\n");

  return `${header}\n${rows}`;
}

export function formatDnsResultsAsMarkdownTable(
  target: string,
  queryType: string,
  results: Array<{ probe: ProbeLocation; answers?: DnsAnswer[] }>,
): string {
  if (results.length === 0) return "";

  const header = `## DNS results: ${target} (${queryType})\n\n| Location | Network | Answers |\n|---|---|---|`;
  const rows = results
    .map((r) => {
      const location = formatProbeLabel(r.probe);
      const network = r.probe.network;
      const answers = r.answers?.map((a) => a.value).join(", ") ?? "—";
      return `| ${location} | ${network} | ${answers} |`;
    })
    .join("\n");

  return `${header}\n${rows}`;
}

// HTTP formatters

export function formatHttpResultAsMarkdown(target: string, label: string, result: HttpResult): string {
  if (result.status === "failed") {
    const failureMessage = result.rawOutput?.trim() || "The probe could not complete the HTTP request.";
    return `## HTTP failed: \`${target}\` — ${label}\n\n\`\`\`\n${failureMessage}\n\`\`\``;
  }

  if (result.status === "in-progress") {
    return `## HTTP: \`${target}\` — ${label}\n\n*HTTP request in progress…*`;
  }

  return `## HTTP: \`${target}\` — ${label}\n\n\`\`\`\n${result.rawOutput ?? ""}\n\`\`\``;
}

export function formatHttpResultsAsMarkdownTable(
  target: string,
  results: Array<{ probe: ProbeLocation; statusCode?: number; timings?: HttpResult["timings"] }>,
): string {
  if (results.length === 0) return "";

  const header = `## HTTP results: ${target}\n\n| Location | Network | Status | Total | DNS | TLS | TCP | First Byte |\n|---|---|---|---|---|---|---|---|`;
  const rows = results
    .map((r) => {
      const location = formatProbeLabel(r.probe);
      const network = r.probe.network;
      const status = r.statusCode ?? "—";
      const total = r.timings?.total != null ? `${r.timings.total}ms` : "—";
      const dns = r.timings?.dns != null ? `${r.timings.dns}ms` : "—";
      const tls = r.timings?.tls != null ? `${r.timings.tls}ms` : "—";
      const tcp = r.timings?.tcp != null ? `${r.timings.tcp}ms` : "—";
      const firstByte = r.timings?.firstByte != null ? `${r.timings.firstByte}ms` : "—";
      return `| ${location} | ${network} | ${status} | ${total} | ${dns} | ${tls} | ${tcp} | ${firstByte} |`;
    })
    .join("\n");

  return `${header}\n${rows}`;
}

// Traceroute formatters

export function formatTracerouteResultAsMarkdown(target: string, label: string, result: TracerouteResult): string {
  const hops = result.hops ?? [];

  let content = `## Traceroute: \`${target}\` — ${label}\n\n`;

  if (result.status === "failed") {
    const failureMessage = result.rawOutput?.trim() || "The probe could not complete the traceroute.";
    return `${content}\`\`\`\n${failureMessage}\n\`\`\``;
  }

  if (hops.length === 0) {
    return result.status === "in-progress"
      ? `${content}*Hop discovery in progress…*`
      : `${content}*No hop data available*`;
  }

  content += "| Host / IP | RTT |\n|---|---|\n";
  content += hops
    .map((hop) => {
      const host = hop.resolvedHostname || "—";
      const ip = hop.resolvedAddress && hop.resolvedAddress !== host ? ` (${hop.resolvedAddress})` : "";
      const timings = hop.timings?.map((timing) => `${timing.rtt} ms`).join(" / ") || "—";
      return `| ${host}${ip} | ${timings} |`;
    })
    .join("\n");

  return content;
}

export interface ParsedMtrRawRow {
  host: string;
  loss: string;
  drop: string;
  rcv: string;
  avg: string;
  stDev: string;
  jAvg: string;
}

export function parseMtrRawOutputRows(rawOutput?: string): ParsedMtrRawRow[] {
  if (!rawOutput) {
    return [];
  }

  return rawOutput
    .split(/\r?\n/)
    .map((line) => line.trim())
    .map((line) => {
      const match = line.match(/^(\d+)\.\s+(.*?)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)\s+([^\s]+)$/);

      if (!match || !match[3].includes("%")) {
        return undefined;
      }

      return {
        host: match[2].trim(),
        loss: match[3],
        drop: match[4],
        rcv: match[5],
        avg: match[6],
        stDev: match[7],
        jAvg: match[8],
      };
    })
    .filter((row): row is ParsedMtrRawRow => row !== undefined);
}

function escapeMarkdownTableCell(value: string): string {
  return value.replace(/\|/g, "\\|");
}

export function getMtrFallbackHost(hop?: MtrHop): string {
  const asn = hop?.asn?.[0];

  if (!asn) {
    return "AS???";
  }

  return `AS${asn}`;
}

function formatMtrValue(value: number | undefined): string {
  return value != null ? String(value) : "—";
}

export function formatMtrResultAsMarkdown(target: string, label: string, result: MtrResult): string {
  const hops = result.hops ?? [];

  let content = `## MTR: \`${target}\` — ${label}\n\n`;

  if (result.status === "failed") {
    const failureMessage = result.rawOutput?.trim() || "The probe could not complete the MTR request.";
    return `${content}\`\`\`\n${failureMessage}\n\`\`\``;
  }

  if (hops.length === 0) {
    return result.status === "in-progress"
      ? `${content}*Hop discovery in progress…*`
      : `${content}*No hop data available*`;
  }

  const rawRows = parseMtrRawOutputRows(result.rawOutput);
  const rowCount = Math.max(hops.length, rawRows.length);

  content += "| Host | Loss% | Drop | Rcv | Avg | StDev | Javg |\n|---|---|---|---|---|---|---|\n";
  content += Array.from({ length: rowCount }, (_, index) => {
    const hop = hops[index];
    const rawRow = rawRows[index];
    const host = escapeMarkdownTableCell(rawRow?.host ?? getMtrFallbackHost(hop));
    const loss = rawRow?.loss ?? (hop?.stats?.loss != null ? `${hop.stats.loss}%` : "—");
    const drop = rawRow?.drop ?? formatMtrValue(hop?.stats?.drop);
    const rcv = rawRow?.rcv ?? formatMtrValue(hop?.stats?.rcv);
    const avg = rawRow?.avg ?? formatMtrValue(hop?.stats?.avg);
    const stDev = rawRow?.stDev ?? formatMtrValue(hop?.stats?.stDev);
    const jAvg = rawRow?.jAvg ?? formatMtrValue(hop?.stats?.jAvg);

    return `| ${host} | ${loss} | ${drop} | ${rcv} | ${avg} | ${stDev} | ${jAvg} |`;
  }).join("\n");

  return content;
}
