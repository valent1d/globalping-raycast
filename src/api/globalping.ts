import { getPreferenceValues } from "@raycast/api";

interface Preferences {
  apiToken?: string;
}

interface GlobalpingErrorPayload {
  error?: {
    type?: string;
    message?: string;
    params?: Record<string, string>;
  };
  links?: {
    documentation?: string;
  };
}

// Types

export type MeasurementType = "ping" | "traceroute" | "mtr" | "dns" | "http";
export type MeasurementStatus = "in-progress" | "finished" | "failed";

export interface Location {
  magic: string;
}

export interface ProbeLocation {
  continent: string;
  region: string;
  country: string;
  city: string;
  asn: number;
  network: string;
  latitude: number;
  longitude: number;
}

export interface PingResult {
  status: MeasurementStatus;
  rawOutput: string;
  resolvedAddress?: string;
  resolvedHostname?: string;
  timings: { ttl: number; rtt: number }[];
  stats: {
    min: number | null;
    max: number | null;
    avg: number | null;
    loss: number | null;
    total?: number;
    rcv?: number;
    drop?: number;
  } | null;
}

export interface DnsAnswer {
  name: string;
  type: string;
  ttl: number;
  value: string;
}

export interface DnsResult {
  status: MeasurementStatus;
  rawOutput: string;
  answers: DnsAnswer[];
  timings: { total: number };
}

export interface HttpResult {
  status: MeasurementStatus;
  rawOutput: string;
  rawHeaders: string;
  rawBody: string;
  statusCode: number;
  headers: Record<string, string>;
  timings: {
    total: number;
    download: number;
    firstByte: number;
    dns: number;
    tls: number;
    tcp: number;
  };
}

export interface TracerouteHop {
  resolvedHostname: string;
  resolvedAddress: string;
  timings: { rtt: number }[];
}

export interface TracerouteResult {
  status: MeasurementStatus;
  rawOutput: string;
  hops: TracerouteHop[];
}

export interface MtrHop {
  stats: {
    min: number;
    max: number;
    avg: number;
    loss: number;
    rcv: number;
    drop: number;
    stDev: number;
    jMin: number;
    jMax: number;
    jAvg: number;
  };
  asn: string[];
  timings: { rtt: number }[];
}

export interface MtrResult {
  status: MeasurementStatus;
  rawOutput: string;
  hops: MtrHop[];
}

export type TestResult = PingResult | DnsResult | HttpResult | TracerouteResult | MtrResult;

export interface ProbeResult {
  probe: ProbeLocation;
  result: TestResult;
}

export interface Measurement {
  id: string;
  type: MeasurementType;
  status: MeasurementStatus;
  target: string;
  results: ProbeResult[];
}

export function getProbeResultBaseKey(probe: ProbeLocation): string {
  return [
    probe.continent,
    probe.region,
    probe.country,
    probe.city,
    probe.network,
    probe.asn,
    probe.latitude,
    probe.longitude,
  ].join("|");
}

export function getProbeResultKey(probe: ProbeLocation, occurrenceIndex = 0): string {
  const baseKey = getProbeResultBaseKey(probe);
  return occurrenceIndex === 0 ? baseKey : `${baseKey}#${occurrenceIndex}`;
}

export function getProbeResultKeys(results: ProbeResult[]): string[] {
  const seenCounts = new Map<string, number>();

  return results.map((result) => {
    const baseKey = getProbeResultBaseKey(result.probe);
    const occurrenceIndex = seenCounts.get(baseKey) ?? 0;
    seenCounts.set(baseKey, occurrenceIndex + 1);
    return getProbeResultKey(result.probe, occurrenceIndex);
  });
}

// Payload types

export interface MeasurementPayload {
  type: MeasurementType;
  target: string;
  locations: Location[];
  limit?: number;
  measurementOptions?: Record<string, unknown>;
}

// Client

const BASE_URL = "https://api.globalping.io/v1";

function getHeaders(): Record<string, string> {
  const { apiToken } = getPreferenceValues<Preferences>();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
  };
  if (apiToken) {
    headers["Authorization"] = `Bearer ${apiToken}`;
  }
  return headers;
}

export class GlobalpingApiError extends Error {
  status: number;
  type?: string;
  details?: string;
  documentationUrl?: string;

  constructor(options: { title: string; status: number; type?: string; details?: string; documentationUrl?: string }) {
    super(options.title);
    this.name = "GlobalpingApiError";
    this.status = options.status;
    this.type = options.type;
    this.details = options.details;
    this.documentationUrl = options.documentationUrl;
  }
}

function formatValidationDetails(params?: Record<string, string>): string | undefined {
  if (!params) {
    return undefined;
  }

  const entries = Object.entries(params);
  if (entries.length === 0) {
    return undefined;
  }

  return entries.map(([key, value]) => `${key}: ${value}`).join(" • ");
}

function getRetryAfterMessage(retryAfterHeader: string | null): string {
  if (!retryAfterHeader) {
    return "Too many requests. Try again in a moment, or add an API token in Raycast preferences for higher limits.";
  }

  const retryAfterSeconds = Number.parseInt(retryAfterHeader, 10);
  if (Number.isFinite(retryAfterSeconds) && retryAfterSeconds > 0) {
    return `Too many requests. Try again in ${retryAfterSeconds}s, or add an API token in Raycast preferences for higher limits.`;
  }

  return "Too many requests. Try again later, or add an API token in Raycast preferences for higher limits.";
}

async function parseErrorResponse(response: Response): Promise<GlobalpingApiError> {
  const documentationUrl = undefined;
  let payload: GlobalpingErrorPayload | undefined;
  let fallbackBodyText: string | undefined;

  try {
    const bodyText = await response.text();
    fallbackBodyText = bodyText.trim() || undefined;

    if (fallbackBodyText) {
      payload = JSON.parse(fallbackBodyText) as GlobalpingErrorPayload;
    }
  } catch {
    payload = undefined;
  }

  const type = payload?.error?.type;
  const apiMessage = payload?.error?.message;
  const validationDetails = formatValidationDetails(payload?.error?.params);
  const docsUrl = payload?.links?.documentation ?? documentationUrl;

  switch (response.status) {
    case 400:
    case 422:
      return new GlobalpingApiError({
        title: apiMessage ?? "Invalid Globalping request",
        status: response.status,
        type,
        details: validationDetails ?? "Check the target, location, and command options, then try again.",
        documentationUrl: docsUrl,
      });
    case 401:
      return new GlobalpingApiError({
        title: "Invalid API token",
        status: response.status,
        type,
        details: "The configured Globalping API token was rejected. Update it in Raycast preferences and try again.",
        documentationUrl: docsUrl,
      });
    case 404:
      return new GlobalpingApiError({
        title: apiMessage ?? "Globalping resource not found",
        status: response.status,
        type,
        details: "The requested measurement or endpoint could not be found.",
        documentationUrl: docsUrl,
      });
    case 429:
      return new GlobalpingApiError({
        title: apiMessage ?? "Globalping rate limit reached",
        status: response.status,
        type,
        details: getRetryAfterMessage(response.headers.get("Retry-After")),
        documentationUrl: docsUrl,
      });
    default:
      return new GlobalpingApiError({
        title: apiMessage ?? `Globalping API error (${response.status})`,
        status: response.status,
        type,
        details: fallbackBodyText && fallbackBodyText !== apiMessage ? fallbackBodyText : undefined,
        documentationUrl: docsUrl,
      });
  }
}

export function getGlobalpingErrorDisplay(error: unknown, fallbackTitle = "Globalping request failed") {
  if (error instanceof GlobalpingApiError) {
    return {
      title: error.message,
      message: error.details,
    };
  }

  if (error instanceof Error) {
    const cause = error.cause;
    const causeMessage = cause instanceof Error ? cause.message : typeof cause === "string" ? cause : undefined;

    return {
      title: fallbackTitle,
      message: causeMessage ? `${error.message} — ${causeMessage}` : error.message,
    };
  }

  return {
    title: fallbackTitle,
    message: String(error),
  };
}

export async function createMeasurement(payload: MeasurementPayload): Promise<string> {
  const response = await fetch(`${BASE_URL}/measurements`, {
    method: "POST",
    headers: getHeaders(),
    body: JSON.stringify(payload),
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  const data = (await response.json()) as { id: string };
  return data.id;
}

export async function getMeasurement(id: string, signal?: AbortSignal): Promise<Measurement> {
  const response = await fetch(`${BASE_URL}/measurements/${id}`, {
    headers: getHeaders(),
    signal,
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<Measurement>;
}

export function getShareUrl(id: string): string {
  return `https://globalping.io/?measurement=${id}`;
}

// Probes

export interface Probe {
  version: string;
  location: {
    continent: string;
    region: string;
    country: string;
    state?: string;
    city: string;
    asn: number;
    network: string;
    latitude: number;
    longitude: number;
  };
  tags: string[];
  resolvers: string[];
}

export async function getProbes(signal?: AbortSignal): Promise<Probe[]> {
  const response = await fetch(`${BASE_URL}/probes`, {
    headers: getHeaders(),
    signal,
  });

  if (!response.ok) {
    throw await parseErrorResponse(response);
  }

  return response.json() as Promise<Probe[]>;
}
