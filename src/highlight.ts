import { mergeRanges, type TextRange } from "./align";
import { debugLog } from "./debug";

export interface CodeMirrorInstance {
  view: {
    state: {
      doc: { toString(): string; length: number };
    };
    dispatch: (spec: { effects: unknown }) => void;
    viewport: { from: number; to: number };
  };
  applyExtension: (extension: unknown) => void;
}

interface EffectType {
  of: (value: unknown) => unknown;
}

interface ChangeSetLike {
  mapPos: (pos: number, assoc?: number) => number;
}

interface ViewUpdateLike {
  docChanged: boolean;
  changes: ChangeSetLike;
  view: CodeMirrorInstance["view"];
}

interface PluginValue {
  decorations: unknown;
  update: (update: ViewUpdateLike) => void;
}

interface DecorationSetLike {
  map: (changes: unknown) => unknown;
}

interface CodeMirrorLib {
  EditorView: {
    theme?: (spec: Record<string, Record<string, string>>) => unknown;
  };
  Decoration: {
    none: unknown;
    mark: (spec: { class?: string; attributes?: Record<string, string> }) => {
      range: (from: number, to: number) => unknown;
    };
    set: (ranges: unknown[], sort?: boolean) => unknown;
  };
  StateEffect: {
    define: () => EffectType;
  };
  ViewPlugin?: {
    define: (
      create: (view: CodeMirrorInstance["view"]) => PluginValue,
      spec: { decorations: (value: PluginValue) => unknown },
    ) => unknown;
  };
}

let lib: CodeMirrorLib | null = null;
let highlightExtension: unknown = null;
let redrawEffect: EffectType | null = null;
let highlightMark: { range: (from: number, to: number) => unknown } | null =
  null;
let currentRanges: TextRange[] = [];
let rangesGeneration = 0;
let stylesAdded = false;
const attachedViews = new WeakSet<object>();

export function injectHighlightStyles(): void {
  if (stylesAdded) {
    return;
  }
  stylesAdded = true;
  mw.util.addCSS(`
.cm-editor .saucership-author {
	background-color: rgba(0, 128, 128, 0.35);
}
`);
}

function mapRanges(ranges: TextRange[], changes: ChangeSetLike): TextRange[] {
  const next: TextRange[] = [];
  for (let i = 0; i < ranges.length; i++) {
    const from = changes.mapPos(ranges[i].from, 1);
    const to = changes.mapPos(ranges[i].to, -1);
    if (from < to) {
      next.push({ from, to });
    }
  }
  return mergeRanges(next);
}

function buildAllDecorations(docLength: number): unknown {
  if (!lib || !highlightMark || currentRanges.length === 0) {
    return lib ? lib.Decoration.none : null;
  }
  const deco = [];
  for (let i = 0; i < currentRanges.length; i++) {
    const range = currentRanges[i];
    if (range.from >= 0 && range.to <= docLength && range.from < range.to) {
      deco.push(highlightMark.range(range.from, range.to));
    }
  }
  return lib.Decoration.set(deco, true);
}

async function loadLib(): Promise<CodeMirrorLib> {
  if (lib && highlightExtension) {
    return lib;
  }
  const requireFn = (await mw.loader.using("ext.CodeMirror.lib")) as (
    module: string,
  ) => CodeMirrorLib;
  lib =
    typeof requireFn === "function"
      ? requireFn("ext.CodeMirror.lib")
      : (requireFn as unknown as CodeMirrorLib);
  debugLog(
    "CodeMirror.lib loaded",
    lib
      ? Object.keys(lib as unknown as Record<string, unknown>).slice(0, 40)
      : lib,
  );
  if (!lib || !lib.Decoration || !lib.StateEffect) {
    throw new Error("ext.CodeMirror.lib is missing decoration APIs.");
  }

  redrawEffect = lib.StateEffect.define();
  highlightMark = lib.Decoration.mark({
    class: "saucership-author",
    attributes: { style: "background-color: rgba(0, 128, 128, 0.35)" },
  });

  const parts: unknown[] = [];
  if (lib.ViewPlugin && lib.ViewPlugin.define) {
    parts.push(
      lib.ViewPlugin.define(
        function (view) {
          let seenGeneration = rangesGeneration;
          const value: PluginValue = {
            decorations: buildAllDecorations(view.state.doc.length),
            update: function (update) {
              if (update.docChanged) {
                currentRanges = mapRanges(currentRanges, update.changes);
              }
              if (seenGeneration !== rangesGeneration) {
                seenGeneration = rangesGeneration;
                value.decorations = buildAllDecorations(
                  update.view.state.doc.length,
                );
              } else if (update.docChanged) {
                value.decorations = (
                  value.decorations as DecorationSetLike
                ).map(update.changes);
              }
            },
          };
          return value;
        },
        {
          decorations: function (value) {
            return value.decorations;
          },
        },
      ),
    );
    debugLog("using document ViewPlugin decorations");
  } else {
    throw new Error("ext.CodeMirror.lib is missing ViewPlugin.");
  }

  if (lib.EditorView && lib.EditorView.theme) {
    parts.push(
      lib.EditorView.theme({
        ".saucership-author": {
          backgroundColor: "rgba(0, 128, 128, 0.35)",
        },
      }),
    );
  }
  highlightExtension = parts;
  return lib;
}

export async function ensureHighlightExtension(
  cm: CodeMirrorInstance,
): Promise<void> {
  await loadLib();
  if (attachedViews.has(cm.view)) {
    return;
  }
  attachedViews.add(cm.view);
  cm.applyExtension(highlightExtension);
  debugLog("decoration extension applied");
}

function bump(cm: CodeMirrorInstance): void {
  if (!redrawEffect) {
    return;
  }
  cm.view.dispatch({ effects: redrawEffect.of(null) });
}

function countDomMarks(): number {
  return document.querySelectorAll(".cm-editor .saucership-author").length;
}

export async function setHighlightRanges(
  cm: CodeMirrorInstance,
  ranges: TextRange[],
): Promise<void> {
  currentRanges = mergeRanges(ranges);
  rangesGeneration++;
  await ensureHighlightExtension(cm);
  bump(cm);
  const docLength = cm.view.state.doc.length;
  const spanTo = currentRanges.length
    ? currentRanges[currentRanges.length - 1].to
    : 0;
  debugLog(
    `painted ${currentRanges.length} highlight ranges ` +
      `(coverage ${spanTo}/${docLength}); DOM mark count: ${countDomMarks()}`,
  );
}

export async function clearHighlightRanges(
  cm: CodeMirrorInstance | null,
): Promise<void> {
  currentRanges = [];
  rangesGeneration++;
  if (!cm || !redrawEffect || !attachedViews.has(cm.view)) {
    return;
  }
  bump(cm);
  debugLog("cleared highlight ranges");
}
