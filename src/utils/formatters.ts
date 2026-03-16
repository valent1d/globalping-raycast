import { Icon, Color } from "@raycast/api";
import type { ProbeLocation, DnsAnswer, HttpResult, MtrResult, TracerouteResult } from "../api/globalping";

// Probe labels

function countryFlag(code: string): string {
  return [...code.toUpperCase()].map((c) => String.fromCodePoint(0x1f1e6 + c.charCodeAt(0) - 65)).join("");
}

export function formatProbeLabel(probe: ProbeLocation): string {
  return `${countryFlag(probe.country)}  ${probe.city}, ${probe.country}`;
}

export function formatProbeSubtitle(probe: ProbeLocation): string {
  return probe.network;
}

export function formatProbeListTitle(probe: ProbeLocation): string {
  return `${countryFlag(probe.country)}  ${probe.network}`;
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

  if (hops.length === 0) {
    return result.status === "in-progress"
      ? `${content}*Hop discovery in progress…*`
      : `${content}*No hop data available*`;
  }

  content += "| Hop | Host / IP | RTT |\n|---:|---|---|\n";
  content += hops
    .map((hop, index) => {
      const host = hop.resolvedHostname || "—";
      const ip = hop.resolvedAddress && hop.resolvedAddress !== host ? ` (${hop.resolvedAddress})` : "";
      const timings = hop.timings?.map((timing) => `${timing.rtt} ms`).join(" / ") || "—";
      return `| ${index + 1} | ${host}${ip} | ${timings} |`;
    })
    .join("\n");

  return content;
}

export function formatMtrResultAsMarkdown(target: string, label: string, result: MtrResult): string {
  const hops = result.hops ?? [];

  let content = `## MTR: \`${target}\` — ${label}\n\n`;

  if (hops.length === 0) {
    return result.status === "in-progress"
      ? `${content}*Hop discovery in progress…*`
      : `${content}*No hop data available*`;
  }

  content += "| Hop | ASN | Avg | Loss | Min | Max | Jitter |\n|---:|---|---|---|---|---|---|\n";
  content += hops
    .map((hop, index) => {
      const asn = hop.asn?.[0] ?? "—";
      const avg = hop.stats?.avg != null ? `${hop.stats.avg} ms` : "—";
      const loss = hop.stats?.loss != null ? `${hop.stats.loss}%` : "—";
      const min = hop.stats?.min != null ? `${hop.stats.min} ms` : "—";
      const max = hop.stats?.max != null ? `${hop.stats.max} ms` : "—";
      const jitter = hop.stats?.jAvg != null ? `${hop.stats.jAvg} ms` : "—";

      return `| ${index + 1} | ${asn} | ${avg} | ${loss} | ${min} | ${max} | ${jitter} |`;
    })
    .join("\n");

  return content;
}
