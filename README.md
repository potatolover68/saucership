**saucership** (a portmanteau of source and authorship) is a userscript that highlights text written by a given username while using the source editor. Authorship will only be highlighted [if and only if](https://en.wikipedia.org/wiki/If_and_only_if):

* the `current_user` (set through the <kbd>Set author</kbd> button) is valid
* `Highlight author` is checked
* The current editor is the source editor, with [CodeMirror syntax highlighting enabled](https://www.mediawiki.org/wiki/Help:Extension:CodeMirror#Enabling).
* The current editor is **not** scoped (this happens if you click the "edit source" link next to section headers)
* The current page is in mainspace
The WhoColor API may not always have data for the latest revision; in this case, you may have to wait a couple of minutes before trying again. The state of `Highlight author` and `current_user` are saved in [localStorage](https://en.wikipedia.org/wiki/Web_storage) and thus persist through reloads, new tabs, and browser restarts. To disable saucership, just uncheck the `Highlight author` option. <kbd>Sync edited text</kbd> will, to the best of its ability, reinsert missing highlights in the text (e.g. after removing and restoring highlighted text).
