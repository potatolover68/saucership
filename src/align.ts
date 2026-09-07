import DiffMatchPatch from 'diff-match-patch';
import type { WhoColorToken } from './wikiwho';

export interface TextRange {
	from: number;
	to: number;
}

const DIFF_DELETE = -1;
const DIFF_INSERT = 1;
const DIFF_EQUAL = 0;

function origToCurrMap( original: string, current: string ): number[] {
	const dmp = new DiffMatchPatch();
	dmp.Diff_Timeout = 0;
	const diffs = dmp.diff_main( original, current );
	dmp.diff_cleanupSemantic( diffs );

	const map = new Array( original.length ).fill( -1 ) as number[];
	let origPos = 0;
	let currPos = 0;

	for ( const [ op, text ] of diffs ) {
		if ( op === DIFF_EQUAL ) {
			for ( let i = 0; i < text.length; i++ ) {
				map[ origPos + i ] = currPos + i;
			}
			origPos += text.length;
			currPos += text.length;
		} else if ( op === DIFF_DELETE ) {
			origPos += text.length;
		} else if ( op === DIFF_INSERT ) {
			currPos += text.length;
		}
	}

	return map;
}

const NEIGHBOR_GAP = 2;

function isMergeableGap( text: string | undefined, from: number, to: number ): boolean {
	if ( to - from <= NEIGHBOR_GAP ) {
		return true;
	}
	if ( !text ) {
		return false;
	}
	for ( let i = from; i < to; i++ ) {
		const code = text.charCodeAt( i );
		if ( code !== 9 && code !== 10 && code !== 13 && code !== 32 ) {
			return false;
		}
	}
	return true;
}

export function mergeRanges( ranges: TextRange[], text?: string ): TextRange[] {
	if ( ranges.length === 0 ) {
		return [];
	}
	const sorted = ranges
		.filter( ( r ) => r.from < r.to )
		.sort( ( a, b ) => a.from - b.from || a.to - b.to );
	if ( sorted.length === 0 ) {
		return [];
	}
	const merged: TextRange[] = [ { from: sorted[ 0 ].from, to: sorted[ 0 ].to } ];
	for ( let i = 1; i < sorted.length; i++ ) {
		const last = merged[ merged.length - 1 ];
		const next = sorted[ i ];
		if ( next.from <= last.to || isMergeableGap( text, last.to, next.from ) ) {
			last.to = Math.max( last.to, next.to );
		} else {
			merged.push( { from: next.from, to: next.to } );
		}
	}
	return merged;
}

export function mapAuthorRanges(
	tokens: WhoColorToken[],
	className: string,
	current: string
): TextRange[] {
	const original = tokens.map( ( t ) => t.str ).join( '' );
	const map = origToCurrMap( original, current );
	const ranges: TextRange[] = [];
	let offset = 0;

	for ( const token of tokens ) {
		const from = offset;
		const to = offset + token.str.length;
		offset = to;
		if ( token.className !== className || from === to ) {
			continue;
		}

		let runStart = -1;
		let prevCurr = -1;
		for ( let i = from; i < to; i++ ) {
			const curr = map[ i ] === undefined ? -1 : map[ i ];
			if ( curr === -1 ) {
				if ( runStart !== -1 ) {
					ranges.push( { from: runStart, to: prevCurr + 1 } );
					runStart = -1;
				}
			} else if ( runStart === -1 ) {
				runStart = curr;
				prevCurr = curr;
			} else if ( curr === prevCurr + 1 ) {
				prevCurr = curr;
			} else {
				ranges.push( { from: runStart, to: prevCurr + 1 } );
				runStart = curr;
				prevCurr = curr;
			}
		}
		if ( runStart !== -1 ) {
			ranges.push( { from: runStart, to: prevCurr + 1 } );
		}
	}

	return mergeRanges( ranges, current );
}
