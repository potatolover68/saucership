import { debugLog } from "./debug";
import { mapAuthorRanges, tokensToRanges } from "./align";
import {
  clearHighlightRanges,
  ensureHighlightExtension,
  injectHighlightStyles,
  setHighlightRanges,
  type CodeMirrorInstance,
} from "./highlight";
import {
  getCurrentUser,
  isHighlightEnabled,
  setCurrentUser,
  setHighlightEnabled,
} from "./storage";
import {
  createToolbarControls,
  isMainspace,
  setControlsVisible,
  setSyncEnabled,
  shouldShowControls,
  type ToolbarControls,
} from "./toolbar";
import {
  findEditorClassName,
  getWhoColor,
  isWhoColorCached,
  NEW_EDIT_CLASS,
  projectTokens,
  type WhoColorToken,
} from "./wikiwho";

let cm: CodeMirrorInstance | null = null;
let controls: ToolbarControls | null = null;
let applyGeneration = 0;
let missingUserNotified = false;
let lastSyncedText: string | null = null;
let revisionText: string | null = null;
let sessionTokens: WhoColorToken[] | null = null;

const scheduleApply = mw.util.debounce(100, () => {
  void applyHighlights();
});

function updateSyncButton(): void {
  if (!cm) {
    setSyncEnabled(controls, false);
    return;
  }
  const current = cm.view.state.doc.toString();
  setSyncEnabled(
    controls,
    lastSyncedText !== null && current !== lastSyncedText,
  );
}

function rangesForTokens(
  tokens: WhoColorToken[],
  className: string,
  currentText: string,
): ReturnType<typeof mapAuthorRanges> {
  const reconstructed = tokens.map((token) => token.str).join("");
  if (reconstructed === currentText) {
    return tokensToRanges(tokens, className);
  }
  return mapAuthorRanges(tokens, className, currentText);
}

function notifyError(message: string): void {
  void mw.notify(message, { type: "error", tag: "saucership" });
}

function notifyWarn(message: string): void {
  void mw.notify(message, { type: "warn", tag: "saucership" });
}

function notifyProgress(message: string): void {
  void mw.notify(message, { tag: "saucership", autoHide: false });
}

function notifyDone(message: string): void {
  void mw.notify(message, { type: "success", tag: "saucership" });
}

function nextPaint(): Promise<void> {
  return new Promise((resolve) => {
    requestAnimationFrame(() => {
      requestAnimationFrame(() => {
        resolve();
      });
    });
  });
}

async function applyHighlights(): Promise<void> {
  const generation = ++applyGeneration;
  const active = cm;

  if (!active || !isHighlightEnabled() || !isMainspace()) {
    debugLog(
      `skip apply (cm=${!!active}, highlight_enabled=${isHighlightEnabled()}, ` +
        `mainspace=${isMainspace()})`,
    );
    await clearHighlightRanges(active);
    return;
  }

  const user = getCurrentUser();
  if (!user) {
    debugLog("skip apply (no current_username)");
    await clearHighlightRanges(active);
    return;
  }
  debugLog(`applying highlights for "${user}"`);

  try {
    await ensureHighlightExtension(active);
    if (!isWhoColorCached()) {
      notifyProgress("Fetching authorship data…");
    }
    const data = await getWhoColor();
    if (generation !== applyGeneration || cm !== active) {
      debugLog("skip after fetch (stale apply)");
      return;
    }
    const originClass = findEditorClassName(data, user);
    const className = originClass || (sessionTokens ? NEW_EDIT_CLASS : null);
    if (!className) {
      debugLog(
        `"${user}" not in present_editors`,
        data.presentEditors.map((editor) => editor.editorName),
      );
      await clearHighlightRanges(active);
      if (!missingUserNotified) {
        missingUserNotified = true;
        notifyWarn(`"${user}" did not contribute to this revision.`);
      }
      return;
    }
    const tokens = sessionTokens || data.tokens;
    const authorTokens = tokens.filter(
      (token) => token.className === className,
    ).length;
    const currentText = active.view.state.doc.toString();
    const originalLength = tokens.reduce(
      (sum, token) => sum + token.str.length,
      0,
    );
    debugLog(
      `matched class "${className}" (${authorTokens} tokens); ` +
        `original length ${originalLength}, editor length ${currentText.length}`,
    );
    notifyProgress("Computing highlight positions…");
    await nextPaint();
    if (generation !== applyGeneration || cm !== active) {
      debugLog("skip before align (stale apply)");
      return;
    }
    const ranges = rangesForTokens(tokens, className, currentText);
    debugLog(`mapped ${ranges.length} ranges for "${user}"`);
    if (generation !== applyGeneration || cm !== active) {
      debugLog("skip paint (stale apply)");
      return;
    }
    await setHighlightRanges(active, ranges);
    notifyDone(`Highlighted text by ${user}.`);
  } catch (err) {
    if (generation !== applyGeneration) {
      return;
    }
    await clearHighlightRanges(active);
    const message =
      err instanceof Error ? err.message : "WhoColor request failed.";
    debugLog("apply failed", err);
    notifyError(message);
  }
}

async function onCodeMirrorOn(instance: CodeMirrorInstance): Promise<void> {
  debugLog("CodeMirror on");
  cm = instance;
  injectHighlightStyles();
  if (revisionText === null) {
    revisionText = instance.view.state.doc.toString();
    lastSyncedText = revisionText;
  }
  setControlsVisible(controls, shouldShowControls());
  updateSyncButton();
  await ensureHighlightExtension(instance);
  if (isHighlightEnabled() && getCurrentUser()) {
    scheduleApply();
  }
}

function onCodeMirrorOff(): void {
  debugLog("CodeMirror off");
  cm = null;
  applyGeneration++;
  setControlsVisible(controls, false);
  setSyncEnabled(controls, false);
}

function onSetAuthor(): void {
  let name: string | null = window.prompt("Username to highlight:");
  while (name !== null && name.trim() === "") {
    name = window.prompt("Username cannot be empty. Username to highlight:");
  }
  if (name === null) {
    return;
  }

  setCurrentUser(name.trim());
  setHighlightEnabled(true);
  missingUserNotified = false;
  sessionTokens = null;
  if (controls) {
    controls.$checkbox.prop("checked", true);
  }
  scheduleApply();
}

function onToggle(enabled: boolean): void {
  setHighlightEnabled(enabled);
  missingUserNotified = false;
  if (enabled) {
    scheduleApply();
  } else if (cm) {
    applyGeneration++;
    void clearHighlightRanges(cm);
  }
}

async function onSync(): Promise<void> {
  const active = cm;
  if (!active || lastSyncedText === null || revisionText === null) {
    return;
  }
  const user = getCurrentUser();
  if (!user) {
    notifyWarn("Set an author before syncing edited text.");
    return;
  }
  const currentText = active.view.state.doc.toString();
  if (currentText === lastSyncedText) {
    updateSyncButton();
    return;
  }
  const generation = ++applyGeneration;
  debugLog(`syncing edited text for "${user}"`);
  setSyncEnabled(controls, false);
  notifyProgress("Syncing highlights with edited text…");
  try {
    await nextPaint();
    const data = await getWhoColor();
    if (generation !== applyGeneration || cm !== active) {
      debugLog("skip sync (stale apply)");
      return;
    }
    const className = findEditorClassName(data, user) || NEW_EDIT_CLASS;
    sessionTokens = await projectTokens(
      data.tokens,
      revisionText,
      currentText,
      className,
    );
    if (generation !== applyGeneration || cm !== active) {
      debugLog("skip sync (stale after project)");
      return;
    }
    lastSyncedText = currentText;
    debugLog(
      `projected ${sessionTokens.length} tokens (insert class "${className}")`,
    );
    if (!isHighlightEnabled()) {
      notifyDone("Highlights synced. Turn on Highlight author to see them.");
      return;
    }
    const ranges = rangesForTokens(sessionTokens, className, currentText);
    await setHighlightRanges(active, ranges);
    notifyDone(`Synced highlights with edited text for ${user}.`);
  } catch (err) {
    if (generation !== applyGeneration) {
      return;
    }
    const message =
      err instanceof Error ? err.message : "Highlight sync failed.";
    debugLog("sync failed", err);
    notifyError(message);
  } finally {
    updateSyncButton();
  }
}

function bindCodeMirrorHooks(): void {
  mw.hook("ext.CodeMirror.ready").add((instance: CodeMirrorInstance) => {
    void onCodeMirrorOn(instance);
  });

  mw.hook("ext.CodeMirror.toggle").add(
    (enabled: boolean, instance?: CodeMirrorInstance) => {
      if (enabled && instance) {
        void onCodeMirrorOn(instance);
      } else {
        onCodeMirrorOff();
      }
    },
  );

  mw.hook("ext.CodeMirror.input").add(() => {
    updateSyncButton();
  });
}

async function init(): Promise<void> {
  if (mw.config.get("wgAction") !== "edit") {
    return;
  }
  if (!isMainspace()) {
    debugLog(
      `skip init (namespace=${String(mw.config.get("wgNamespaceNumber"))})`,
    );
    return;
  }

  debugLog(
    `init (action=${String(mw.config.get("wgAction"))}, ` +
      `user="${getCurrentUser()}", highlight_enabled=${isHighlightEnabled()})`,
  );
  injectHighlightStyles();
  bindCodeMirrorHooks();
  controls = await createToolbarControls(
    onSetAuthor,
    onToggle,
    () => {
      void onSync();
    },
    isHighlightEnabled(),
  );
  setControlsVisible(controls, shouldShowControls());
  updateSyncButton();
}

void init();
