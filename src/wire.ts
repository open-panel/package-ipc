import type { IpcMethodName } from "./contract.js";
import type { OpenPanelEvents } from "@open-panel/shared";

export interface WireRequest {
  kind: "request";
  id: string;
  method: IpcMethodName;
  params: unknown[];
}

export interface WireResponseOk {
  kind: "response";
  id: string;
  ok: true;
  result: unknown;
}

export interface WireResponseErr {
  kind: "response";
  id: string;
  ok: false;
  error: { message: string };
}

export type WireResponse = WireResponseOk | WireResponseErr;

export interface WireEvent<K extends keyof OpenPanelEvents = keyof OpenPanelEvents> {
  kind: "event";
  event: K;
  payload: OpenPanelEvents[K];
}

export type WireMessage = WireRequest | WireResponse | WireEvent;
