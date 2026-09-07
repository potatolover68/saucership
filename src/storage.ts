import { debugLog } from './debug';

const USER_KEY = 'saucership.current_user';
const ENABLED_KEY = 'saucership.highlight_enabled';

function readString( key: string ): string {
	const value = mw.storage.get( key );
	return typeof value === 'string' ? value : '';
}

export function getCurrentUser(): string {
	return readString( USER_KEY ).trim();
}

export function setCurrentUser( name: string ): void {
	mw.storage.set( USER_KEY, name );
	debugLog( `current_username changed to "${ name }"` );
}

export function isHighlightEnabled(): boolean {
	return mw.storage.get( ENABLED_KEY ) === '1';
}

export function setHighlightEnabled( enabled: boolean ): void {
	mw.storage.set( ENABLED_KEY, enabled ? '1' : '0' );
	debugLog( `highlight_enabled changed to ${ enabled }` );
}
