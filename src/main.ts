import { debugLog } from './debug';
import { mapAuthorRanges } from './align';
import {
	clearHighlightRanges,
	ensureHighlightExtension,
	injectHighlightStyles,
	setHighlightRanges,
	type CodeMirrorInstance
} from './highlight';
import {
	getCurrentUser,
	isHighlightEnabled,
	setCurrentUser,
	setHighlightEnabled
} from './storage';
import {
	createToolbarControls,
	isMainspace,
	setControlsVisible,
	shouldShowControls,
	type ToolbarControls
} from './toolbar';
import { findEditorClassName, getWhoColor, isWhoColorCached } from './wikiwho';

let cm: CodeMirrorInstance | null = null;
let controls: ToolbarControls | null = null;
let applyGeneration = 0;
let missingUserNotified = false;

const scheduleApply = mw.util.debounce( 100, () => {
	void applyHighlights();
} );

function notifyError( message: string ): void {
	void mw.notify( message, { type: 'error', tag: 'saucership' } );
}

function notifyWarn( message: string ): void {
	void mw.notify( message, { type: 'warn', tag: 'saucership' } );
}

function notifyProgress( message: string ): void {
	void mw.notify( message, { tag: 'saucership', autoHide: false } );
}

function notifyDone( message: string ): void {
	void mw.notify( message, { type: 'success', tag: 'saucership' } );
}

function nextPaint(): Promise<void> {
	return new Promise( ( resolve ) => {
		requestAnimationFrame( () => {
			requestAnimationFrame( () => {
				resolve();
			} );
		} );
	} );
}

async function applyHighlights(): Promise<void> {
	const generation = ++applyGeneration;
	const active = cm;

	if ( !active || !isHighlightEnabled() || !isMainspace() ) {
		debugLog(
			`skip apply (cm=${ !!active }, highlight_enabled=${ isHighlightEnabled() }, ` +
			`mainspace=${ isMainspace() })`
		);
		await clearHighlightRanges( active );
		return;
	}

	const user = getCurrentUser();
	if ( !user ) {
		debugLog( 'skip apply (no current_username)' );
		await clearHighlightRanges( active );
		return;
	}
	debugLog( `applying highlights for "${ user }"` );

	try {
		await ensureHighlightExtension( active );
		if ( !isWhoColorCached() ) {
			notifyProgress( 'Fetching authorship data…' );
		}
		const data = await getWhoColor();
		if ( generation !== applyGeneration || cm !== active ) {
			debugLog( 'skip after fetch (stale apply)' );
			return;
		}
		const className = findEditorClassName( data, user );
		if ( !className ) {
			debugLog(
				`"${ user }" not in present_editors`,
				data.presentEditors.map( ( editor ) => editor.editorName )
			);
			await clearHighlightRanges( active );
			if ( !missingUserNotified ) {
				missingUserNotified = true;
				notifyWarn( `"${ user }" did not contribute to this revision.` );
			}
			return;
		}
		const authorTokens = data.tokens.filter(
			( token ) => token.className === className
		).length;
		const currentText = active.view.state.doc.toString();
		const originalLength = data.tokens.reduce( ( sum, token ) => sum + token.str.length, 0 );
		debugLog(
			`matched class "${ className }" (${ authorTokens } tokens); ` +
			`original length ${ originalLength }, editor length ${ currentText.length }`
		);
		notifyProgress( 'Computing highlight positions…' );
		await nextPaint();
		if ( generation !== applyGeneration || cm !== active ) {
			debugLog( 'skip before align (stale apply)' );
			return;
		}
		const ranges = mapAuthorRanges( data.tokens, className, currentText );
		debugLog( `mapped ${ ranges.length } ranges for "${ user }"` );
		if ( generation !== applyGeneration || cm !== active ) {
			debugLog( 'skip paint (stale apply)' );
			return;
		}
		await setHighlightRanges( active, ranges );
		notifyDone( `Highlighted text by ${ user }.` );
	} catch ( err ) {
		if ( generation !== applyGeneration ) {
			return;
		}
		await clearHighlightRanges( active );
		const message = err instanceof Error ? err.message : 'WhoColor request failed.';
		debugLog( 'apply failed', err );
		notifyError( message );
	}
}

async function onCodeMirrorOn( instance: CodeMirrorInstance ): Promise<void> {
	debugLog( 'CodeMirror on' );
	cm = instance;
	injectHighlightStyles();
	setControlsVisible( controls, shouldShowControls() );
	await ensureHighlightExtension( instance );
	if ( isHighlightEnabled() && getCurrentUser() ) {
		scheduleApply();
	}
}

function onCodeMirrorOff(): void {
	debugLog( 'CodeMirror off' );
	cm = null;
	applyGeneration++;
	setControlsVisible( controls, false );
}

function onSetAuthor(): void {
	const proceed = window.confirm(
		'Your current staged edits will be wiped if you continue. Continue?'
	);
	if ( !proceed ) {
		return;
	}

	let name: string | null = window.prompt( 'Username to highlight:' );
	while ( name !== null && name.trim() === '' ) {
		name = window.prompt( 'Username cannot be empty. Username to highlight:' );
	}
	if ( name === null ) {
		return;
	}

	setCurrentUser( name.trim() );
	setHighlightEnabled( true );
	window.location.reload();
}

function onToggle( enabled: boolean ): void {
	setHighlightEnabled( enabled );
	missingUserNotified = false;
	if ( enabled ) {
		scheduleApply();
	} else if ( cm ) {
		applyGeneration++;
		void clearHighlightRanges( cm );
	}
}

function bindCodeMirrorHooks(): void {
	mw.hook( 'ext.CodeMirror.ready' ).add( ( instance: CodeMirrorInstance ) => {
		void onCodeMirrorOn( instance );
	} );

	mw.hook( 'ext.CodeMirror.toggle' ).add(
		( enabled: boolean, instance?: CodeMirrorInstance ) => {
			if ( enabled && instance ) {
				void onCodeMirrorOn( instance );
			} else {
				onCodeMirrorOff();
			}
		}
	);
}

async function init(): Promise<void> {
	if ( mw.config.get( 'wgAction' ) !== 'edit' ) {
		return;
	}
	if ( !isMainspace() ) {
		debugLog(
			`skip init (namespace=${ String( mw.config.get( 'wgNamespaceNumber' ) ) })`
		);
		return;
	}

	debugLog(
		`init (action=${ String( mw.config.get( 'wgAction' ) ) }, ` +
		`user="${ getCurrentUser() }", highlight_enabled=${ isHighlightEnabled() })`
	);
	injectHighlightStyles();
	bindCodeMirrorHooks();
	controls = await createToolbarControls(
		onSetAuthor,
		onToggle,
		isHighlightEnabled()
	);
	setControlsVisible( controls, shouldShowControls() );
}

void init();
