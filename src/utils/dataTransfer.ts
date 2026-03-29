import { SCHEMA_VERSION, type AppState, type ExportPayload } from "../types";
import { createEmptyState } from "./storage";

const isObject = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null;
};

const sanitizeState = (candidate: unknown): AppState | null => {
  if (!isObject(candidate)) {
    return null;
  }

  const base = createEmptyState();
  return {
    ...base,
    ...candidate,
  };
};

export const exportStateAsJson = (state: AppState): string => {
  const payload: ExportPayload = {
    schemaVersion: SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    state,
  };

  return JSON.stringify(payload, null, 2);
};

export const parseImportedJson = (
  rawText: string,
): { ok: true; state: AppState } | { ok: false; error: string } => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawText);
  } catch {
    return { ok: false, error: "JSONの解析に失敗しました。" };
  }

  if (!isObject(parsed)) {
    return { ok: false, error: "JSONの形式が不正です。" };
  }

  if (typeof parsed.schemaVersion !== "number") {
    return { ok: false, error: "schemaVersion が見つかりません。" };
  }

  if (parsed.schemaVersion !== SCHEMA_VERSION) {
    return {
      ok: false,
      error: `schemaVersion が未対応です（${String(parsed.schemaVersion)}）。`,
    };
  }

  const state = sanitizeState(parsed.state);
  if (!state) {
    return { ok: false, error: "state の形式が不正です。" };
  }

  return { ok: true, state };
};

export const triggerJsonDownload = (
  fileName: string,
  content: string,
): void => {
  const blob = new Blob([content], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = fileName;
  anchor.click();

  URL.revokeObjectURL(url);
};
