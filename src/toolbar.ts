export interface ToolbarControls {
  $root: JQuery;
  $checkbox: JQuery<HTMLInputElement>;
  $button: JQuery<HTMLButtonElement>;
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
  checked: boolean,
): JQuery.Promise<ToolbarControls> {
  return waitForToolbar().then(($sections) => {
    const $existing = $("#saucership-controls");
    if ($existing.length) {
      const $existingCheckbox = $existing.find<HTMLInputElement>(
        'input[type="checkbox"]',
      );
      const $existingButton = $existing.find<HTMLButtonElement>("button");
      if ($existingCheckbox.length && $existingButton.length) {
        $existingCheckbox.prop("checked", checked);
        return {
          $root: $existing,
          $checkbox: $existingCheckbox,
          $button: $existingButton,
        };
      }
    }

    const $button = $("<button>")
      .attr("type", "button")
      .css("margin", "5px")
      .text("Set author")
      .on("click", onSetAuthor);

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
      .append($button, $label);

    $sections.append($root);

    return {
      $root,
      $checkbox: $checkbox as JQuery<HTMLInputElement>,
      $button: $button as JQuery<HTMLButtonElement>,
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
