import { fileURLToPath, URL } from 'node:url';
import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import vueJsx from '@vitejs/plugin-vue-jsx';
import { readFileSync } from 'fs';
import mediawikiUserscript from 'vite-plugin-mediawiki-userscript';

// https://vitejs.dev/config/
export default defineConfig( {
	plugins: [
		vue(),
		vueJsx(),
		mediawikiUserscript( {
			name: 'saucership',
			entry: './src/main.ts',
			using: [
				'vue',
				'@wikimedia/codex',
				'mediawiki.storage',
				'mediawiki.util',
				'mediawiki.notification'
			],
			banner: `{{Wikipedia:USync|repo=https://github.com/potatolover68/saucership|ref=refs/heads/build|path=index.js}}
			saucership - GPL-3.0-or-later - https://github.com/potatolover68/saucership
			`
		} )
	],
	resolve: {
		alias: {
			'@': fileURLToPath( new URL( './src', import.meta.url ) )
		}
	},
	server: {
		hmr: true,
		strictPort: true,
		allowedHosts: true,
		headers: {
			'Access-Control-Allow-Origin': '*'
		}
	}
} );
