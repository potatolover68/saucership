import { debugLog } from "./debug";
import {
  collectInsertRanges,
  mapAuthorRanges,
  mergeRanges,
  rangesToTokens,
} from "./align";

export interface WhoColorToken {
  str: string;
  className: string;
}

export interface WhoColorData {
  success: boolean;
  pageTitle: string;
  revId: number;
  presentEditors: Array<{ editorName: string; className: string }>;
  tokens: WhoColorToken[];
}

const cache = new Map<string, WhoColorData>();
const inflight = new Map<string, Promise<WhoColorData>>();

function pageTitle(): string {
  return String(mw.config.get("wgPageName") || "").replace(/_/g, " ");
}

function parentRevId(): string {
  return String($('input[name="parentRevId"]').val() || "").trim();
}

function cacheKey(title: string, revId: string): string {
  return `${title}\t${revId}`;
}

function asClassName(value: unknown): string | null {
  if (typeof value === "string" && value !== "") {
    return value;
  }
  if (typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

function parseEditor(
  entry: unknown,
): { editorName: string; className: string } | null {
  if (Array.isArray(entry)) {
    const className = asClassName(entry[1]);
    if (typeof entry[0] === "string" && className) {
      return { editorName: entry[0], className };
    }
  }
  if (entry && typeof entry === "object") {
    const rec = entry as { editor_name?: unknown; class_name?: unknown };
    const className = asClassName(rec.class_name);
    if (typeof rec.editor_name === "string" && className) {
      return { editorName: rec.editor_name, className };
    }
  }
  return null;
}

function parseToken(entry: unknown): WhoColorToken | null {
  if (Array.isArray(entry)) {
    const className = asClassName(entry[5]);
    if (typeof entry[1] === "string" && className) {
      return { str: entry[1], className };
    }
  }
  if (entry && typeof entry === "object") {
    const rec = entry as { str?: unknown; class_name?: unknown };
    const className = asClassName(rec.class_name);
    if (typeof rec.str === "string" && className) {
      return { str: rec.str, className };
    }
  }
  return null;
}

function parseResponse(json: unknown): WhoColorData {
  if (!json || typeof json !== "object") {
    throw new Error("WhoColor returned an empty response.");
  }
  const rec = json as {
    success?: unknown;
    page_title?: unknown;
    rev_id?: unknown;
    present_editors?: unknown;
    tokens?: unknown;
  };
  if (rec.success === false) {
    throw new Error("WhoColor has no data for this page.");
  }
  const rawEditors = Array.isArray(rec.present_editors)
    ? rec.present_editors
    : [];
  const rawTokens = Array.isArray(rec.tokens) ? rec.tokens : [];
  const presentEditors = rawEditors
    .map(parseEditor)
    .filter((e): e is { editorName: string; className: string } => e !== null);
  const tokens = rawTokens
    .map(parseToken)
    .filter((t): t is WhoColorToken => t !== null);
  if (presentEditors.length !== rawEditors.length) {
    debugLog(
      `dropped ${rawEditors.length - presentEditors.length} present_editors during parse`,
    );
    debugLog("first raw present_editor", rawEditors[0]);
  }
  if (tokens.length !== rawTokens.length) {
    debugLog(`dropped ${rawTokens.length - tokens.length} tokens during parse`);
    debugLog("first raw token", rawTokens[0]);
  }
  return {
    success: rec.success !== false,
    pageTitle:
      typeof rec.page_title === "string" ? rec.page_title : pageTitle(),
    revId: typeof rec.rev_id === "number" ? rec.rev_id : Number(rec.rev_id),
    presentEditors,
    tokens,
  };
}

export function normalizeUserName(name: string): string {
  return name.trim().replace(/_/g, " ").toLowerCase();
}

export function findEditorClassName(
  data: WhoColorData,
  userName: string,
): string | null {
  const wanted = normalizeUserName(userName);
  if (!wanted) {
    return null;
  }
  const match = data.presentEditors.find(
    (editor) => normalizeUserName(editor.editorName) === wanted,
  );
  return match ? match.className : null;
}

export function isWhoColorCached(): boolean {
  const title = pageTitle();
  const revId = parentRevId();
  if (!title || !revId) {
    return false;
  }
  return cache.has(cacheKey(title, revId));
}

export async function getWhoColor(): Promise<WhoColorData> {
  const title = pageTitle();
  const revId = parentRevId();
  if (!title) {
    throw new Error("Could not determine the page title.");
  }
  if (!revId) {
    throw new Error("Could not determine the parent revision id.");
  }
  const key = cacheKey(title, revId);
  const cached = cache.get(key);
  if (cached) {
    debugLog(
      `using cached WhoColor data for revision ${revId} (page "${title}")`,
    );
    return cached;
  }
  const pending = inflight.get(key);
  if (pending) {
    debugLog(
      `waiting for in-flight WhoColor request for revision ${revId} (page "${title}")`,
    );
    return pending;
  }
  debugLog(`loading WhoColor data on revision ${revId} (page "${title}")`);
  const request = (async () => {
    const url =
      "https://wikiwho.wmcloud.org/en/whocolor/v1.0.0-beta/" +
      `${encodeURIComponent(title)}/${encodeURIComponent(revId)}/`;
    const response = await fetch(url);
    if (!response.ok) {
      throw new Error(`WhoColor request failed (${response.status}).`);
    }
    const data = parseResponse(await response.json());
    debugLog(
      `WhoColor parsed ${data.presentEditors.length} editors, ${data.tokens.length} tokens`,
    );
    cache.set(key, data);
    return data;
  })();
  inflight.set(key, request);
  request.then(
    () => {
      inflight.delete(key);
    },
    () => {
      inflight.delete(key);
    },
  );
  return request;
}

export const NEW_EDIT_CLASS = "saucership-new";

function yieldToMain(): Promise<void> {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    channel.port1.onmessage = () => {
      resolve();
    };
    channel.port2.postMessage(undefined);
  });
}

export async function projectTokens(
  latestTokens: WhoColorToken[],
  baselineText: string,
  newText: string,
  editorName: string,
): Promise<WhoColorToken[]> {
  const started = Date.now();
  await yieldToMain();
  const authored = mapAuthorRanges(latestTokens, editorName, newText);
  await yieldToMain();
  const inserted = collectInsertRanges(baselineText, newText);
  const userRanges = mergeRanges([...authored, ...inserted]);
  const result = rangesToTokens(newText, userRanges, editorName);
  debugLog(
    `projected ${result.length} tokens ` +
      `(${authored.length} authored ranges, ${inserted.length} insert ranges) ` +
      `in ${Date.now() - started}ms`,
  );
  return result;
}
