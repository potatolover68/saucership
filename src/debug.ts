export function debugLog( message: string, extra?: unknown ): void {
	if ( extra !== undefined ) {
		// eslint-disable-next-line no-console
		console.log( `[saucership] ${ message }`, extra );
	} else {
		// eslint-disable-next-line no-console
		console.log( `[saucership] ${ message }` );
	}
}
