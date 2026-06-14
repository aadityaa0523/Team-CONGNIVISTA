import { useEffect, useReducer, useRef } from "react";
import type { Alert, WsAlert, WsMessage, WsReading } from "../types";

export type WsStatus = "connecting" | "open" | "closed";

interface WsState {
  status: WsStatus;
  /** Most recent water reading per node_id. */
  latest: Record<string, WsReading>;
  /** Most recent methane ppm per node_id. */
  methane: Record<string, number>;
  /** Live-streamed alerts (newest first), capped. */
  alerts: Alert[];
  /** Monotonic counter so consumers can react to "a new reading arrived". */
  tick: number;
}

type Action =
  | { type: "status"; status: WsStatus }
  | { type: "message"; msg: WsMessage };

const MAX_LIVE_ALERTS = 50;

const initialState: WsState = {
  status: "connecting",
  latest: {},
  methane: {},
  alerts: [],
  tick: 0,
};

function reducer(state: WsState, action: Action): WsState {
  switch (action.type) {
    case "status":
      return { ...state, status: action.status };
    case "message": {
      const msg = action.msg;
      if ("type" in msg && msg.type === "alert") {
        const { type: _t, ...alert } = msg as WsAlert;
        return {
          ...state,
          alerts: [alert, ...state.alerts].slice(0, MAX_LIVE_ALERTS),
          tick: state.tick + 1,
        };
      }
      if ("distance_cm" in msg) {
        const r = msg as WsReading;
        return {
          ...state,
          latest: { ...state.latest, [r.node_id]: r },
          tick: state.tick + 1,
        };
      }
      if ("methane_ppm" in msg) {
        return {
          ...state,
          methane: { ...state.methane, [msg.node_id]: msg.methane_ppm },
          tick: state.tick + 1,
        };
      }
      return state;
    }
    default:
      return state;
  }
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss" : "ws";
  return `${proto}://${window.location.host}/ws`;
}

/**
 * Connects to the backend WebSocket, parses JSON frames, and exposes the
 * latest readings/alerts via a reducer. Reconnects automatically with backoff.
 */
export function useWebSocket() {
  const [state, dispatch] = useReducer(reducer, initialState);
  const wsRef = useRef<WebSocket | null>(null);
  const retryRef = useRef(0);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    let cancelled = false;

    const connect = () => {
      if (cancelled) return;
      dispatch({ type: "status", status: "connecting" });
      const ws = new WebSocket(wsUrl());
      wsRef.current = ws;

      ws.onopen = () => {
        retryRef.current = 0;
        dispatch({ type: "status", status: "open" });
      };

      ws.onmessage = (ev) => {
        try {
          const msg = JSON.parse(ev.data) as WsMessage;
          dispatch({ type: "message", msg });
        } catch {
          // ignore malformed frames
        }
      };

      ws.onclose = () => {
        dispatch({ type: "status", status: "closed" });
        if (cancelled) return;
        // Exponential backoff capped at 10s.
        const delay = Math.min(1000 * 2 ** retryRef.current, 10000);
        retryRef.current += 1;
        timerRef.current = window.setTimeout(connect, delay);
      };

      ws.onerror = () => ws.close();
    };

    connect();

    return () => {
      cancelled = true;
      if (timerRef.current) window.clearTimeout(timerRef.current);
      wsRef.current?.close();
    };
  }, []);

  return state;
}
