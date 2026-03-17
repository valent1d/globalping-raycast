import { useState, useEffect, useRef } from "react";
import { showToast, Toast } from "@raycast/api";
import {
  createMeasurement,
  getGlobalpingErrorDisplay,
  getMeasurement,
  getProbeResultKeys,
  type Measurement,
  type MeasurementPayload,
} from "../api/globalping";
import { incrementLocationStat } from "../utils/storage";

function isAbortError(e: unknown): boolean {
  return e instanceof Error && (e.name === "AbortError" || e.message === "The operation was aborted.");
}

export function useMeasurement() {
  const [measurement, setMeasurement] = useState<Measurement | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [measurementId, setMeasurementId] = useState<string | null>(null);
  const [probeLimit, setProbeLimit] = useState(0);

  const pollingRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isFetchingRef = useRef(false);
  const isCreatingRef = useRef(false);
  const toastRef = useRef<Awaited<ReturnType<typeof showToast>> | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  function getPollingTimeoutMs(type: Measurement["type"] | null, limit: number): number {
    const baseTimeoutMs = type === "mtr" || type === "traceroute" ? 45_000 : 30_000;
    const perProbeTimeoutMs = (type === "mtr" || type === "traceroute" ? 1_200 : 700) * Math.max(limit, 1);
    return Math.max(baseTimeoutMs, perProbeTimeoutMs);
  }

  function stopPolling() {
    if (pollingRef.current) {
      clearTimeout(pollingRef.current);
      pollingRef.current = null;
    }
    abortControllerRef.current?.abort();
    abortControllerRef.current = null;
    isFetchingRef.current = false;
    setIsRunning(false);
  }

  function mergeMeasurementResults(previous: Measurement | null, next: Measurement): Measurement {
    if (!previous || previous.id !== next.id) {
      return next;
    }

    const previousKeys = getProbeResultKeys(previous.results);
    const nextKeys = getProbeResultKeys(next.results);
    const mergedByKey = new Map(previous.results.map((result, index) => [previousKeys[index], result]));

    for (const [index, result] of next.results.entries()) {
      mergedByKey.set(nextKeys[index], result);
    }

    const nextOrder = new Set(nextKeys);
    const carryForwardResults =
      next.status === "in-progress"
        ? previous.results.filter((_, index) => !nextOrder.has(previousKeys[index]))
        : previous.results.filter((result, index) => {
            const previousKey = previousKeys[index];
            return !nextOrder.has(previousKey) && result.result.status !== "in-progress";
          });
    const mergedResults = [...next.results, ...carryForwardResults];
    const mergedResultsKeys = getProbeResultKeys(mergedResults);

    return {
      ...next,
      results: mergedResults.map((result, index) => mergedByKey.get(mergedResultsKeys[index]) ?? result),
    };
  }

  // Polling

  useEffect(() => {
    if (!measurementId) return;

    const activeMeasurementId = measurementId;
    const startedAt = Date.now();
    const TIMEOUT_MS = getPollingTimeoutMs(measurement?.type ?? null, probeLimit);
    const POLL_INTERVAL_MS = 600;
    const REQUEST_TIMEOUT_MS = 12_000;
    const controller = new AbortController();
    abortControllerRef.current = controller;
    let isDisposed = false;

    function scheduleNextPoll() {
      if (isDisposed || controller.signal.aborted) {
        return;
      }

      pollingRef.current = setTimeout(() => {
        void pollMeasurement();
      }, POLL_INTERVAL_MS);
    }

    async function pollMeasurement() {
      if (isFetchingRef.current) return;
      if (controller.signal.aborted) return;
      if (Date.now() - startedAt > TIMEOUT_MS) {
        stopPolling();
        await showToast({ style: Toast.Style.Failure, title: "Timed out", message: "No response after 30s." });
        return;
      }

      isFetchingRef.current = true;
      try {
        const requestSignal = AbortSignal.any([controller.signal, AbortSignal.timeout(REQUEST_TIMEOUT_MS)]);
        const result = await getMeasurement(activeMeasurementId, requestSignal);
        setMeasurement((previous) => mergeMeasurementResults(previous, result));
        if (result.status !== "in-progress") {
          stopPolling();
          if (toastRef.current) {
            toastRef.current.style = Toast.Style.Success;
            toastRef.current.title = "Done";
          }
          return;
        }
      } catch (e) {
        if (isAbortError(e)) {
          isFetchingRef.current = false;
          return;
        }
        stopPolling();
        const { title, message } = getGlobalpingErrorDisplay(e, "Polling failed");
        await showToast({ style: Toast.Style.Failure, title, message });
      } finally {
        isFetchingRef.current = false;
        if (!controller.signal.aborted) {
          scheduleNextPoll();
        }
      }
    }

    void pollMeasurement();

    return () => {
      isDisposed = true;
      if (pollingRef.current) {
        clearTimeout(pollingRef.current);
        pollingRef.current = null;
      }
      controller.abort();
      abortControllerRef.current = null;
      isFetchingRef.current = false;
    };
  }, [measurementId, measurement?.type, probeLimit]);

  // Run test

  async function runTest(payload: MeasurementPayload, toastTitle: string) {
    if (isCreatingRef.current) return;
    isCreatingRef.current = true;
    stopPolling();

    setIsRunning(true);
    setMeasurement(null);
    setMeasurementId(null);
    setProbeLimit(payload.limit ?? 1);

    toastRef.current = await showToast({ style: Toast.Style.Animated, title: toastTitle });

    try {
      const id = await createMeasurement(payload);
      setMeasurement({
        id,
        type: payload.type,
        status: "in-progress",
        target: payload.target,
        results: [],
      });
      setMeasurementId(id);
      void incrementLocationStat(payload.locations[0].magic);
    } catch (e) {
      isCreatingRef.current = false;
      setIsRunning(false);
      if (toastRef.current) {
        const { title, message } = getGlobalpingErrorDisplay(e, "Failed to start test");
        toastRef.current.style = Toast.Style.Failure;
        toastRef.current.title = title;
        toastRef.current.message = message;
      }
      return;
    }

    isCreatingRef.current = false;
  }

  return { measurement, isRunning, runTest, probeLimit };
}
