export interface ToolbarControls {
  $root: JQuery;
  $checkbox: JQuery<HTMLInputElement>;
  $button: JQuery<HTMLButtonElement>;
  $sync: JQuery<HTMLButtonElement>;
}

function waitForToolbar(): JQuery.Promise<JQuery> {
  const deferred = $.Deferred<JQuery>();
  let timer = 0;
  const resolveIfReady = (): boolean => {
    const $sections = $("#wikiEditor-ui-toolbar .sections");
    if ($sections.length) {
      if (timer) {
        window.clearInterval(timer);
      }
      deferred.resolve($sections);
      return true;
    }
    return false;
  };

  if (resolveIfReady()) {
    return deferred.promise();
  }

  mw.hook("wikiEditor.toolbarReady").add(resolveIfReady);
  timer = window.setInterval(resolveIfReady, 200);

  return deferred.promise();
}

export function createToolbarControls(
  onSetAuthor: () => void,
  onToggle: (enabled: boolean) => void,
  onSync: () => void,
  checked: boolean,
): JQuery.Promise<ToolbarControls> {
  return waitForToolbar().then(($sections) => {
    const $existing = $("#saucership-controls");
    if ($existing.length) {
      const $existingCheckbox = $existing.find<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      const $existingButton = $existing.find<HTMLButtonElement>(
        "#saucership-set-author",
      );
      const $existingSync =
        $existing.find<HTMLButtonElement>("#saucership-sync");
      if (
        $existingCheckbox.length &&
        $existingButton.length &&
        $existingSync.length
      ) {
        $existingCheckbox.prop("checked", checked);
        $existingButton.off("click").on("click", onSetAuthor);
        $existingSync.off("click").on("click", onSync);
        $existingCheckbox.off("change").on("change", () => {
          onToggle($existingCheckbox.prop("checked") as boolean);
        });
        return {
          $root: $existing,
          $checkbox: $existingCheckbox,
          $button: $existingButton,
          $sync: $existingSync,
        };
      }
      $existing.remove();
    }

    const $button = $("<button>")
      .attr({ type: "button", id: "saucership-set-author" })
      .css("margin", "5px")
      .text("Set author")
      .on("click", onSetAuthor);

    const $sync = $("<button>")
      .attr({ type: "button", id: "saucership-sync" })
      .css("margin", "5px")
      .text("Sync edited text")
      .prop("disabled", true)
      .on("click", onSync);

    const $checkbox = $("<input>")
      .attr("type", "checkbox")
      .css("margin", "5px")
      .prop("checked", checked)
      .on("change", () => {
        onToggle($checkbox.prop("checked") as boolean);
      });

    const $label = $("<label>")
      .css("margin", "5px")
      .append($checkbox, " Highlight author");

    const $root = $("<span>")
      .attr("id", "saucership-controls")
      .append($button, $sync, $label);

    $sections.append($root);

    return {
      $root,
      $checkbox: $checkbox as JQuery<HTMLInputElement>,
      $button: $button as JQuery<HTMLButtonElement>,
      $sync: $sync as JQuery<HTMLButtonElement>,
    };
  });
}

export function setControlsVisible(
  controls: ToolbarControls | null,
  visible: boolean,
): void {
  if (!controls) {
    return;
  }
  controls.$root.toggle(visible);
}

export function setSyncEnabled(
  controls: ToolbarControls | null,
  enabled: boolean,
): void {
  if (!controls) {
    return;
  }
  controls.$sync.prop("disabled", !enabled);
}

export function isSectionEdit(): boolean {
  const section = mw.util.getParamValue("section");
  return section !== null && section !== undefined;
}

export function isCodeMirrorVisible(): boolean {
  const $wrapper = $(".ext-codemirror-wrapper");
  return (
    $wrapper.length > 0 && !$wrapper.hasClass("ext-codemirror-wrapper--hidden")
  );
}

export function isMainspace(): boolean {
  return mw.config.get("wgNamespaceNumber") === 0;
}

export function shouldShowControls(): boolean {
  return isMainspace() && !isSectionEdit() && isCodeMirrorVisible();
}
