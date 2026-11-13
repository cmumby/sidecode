import { build, context } from 'esbuild';
const options = [
  { entryPoints: ['src/extension/activate.ts'], outfile: 'dist/extension.cjs', platform: 'node', format: 'cjs', external: ['vscode'], target: 'node20' },
  { entryPoints: ['src/webview/main.tsx'], outfile: 'dist/webview.js', platform: 'browser', format: 'iife', target: 'chrome120', define: { 'process.env.NODE_ENV': '"production"' } },
];
for (const option of options) {
  const config = { ...option, bundle: true, minify: true, legalComments: 'eof', logLevel: 'info' };
  if (process.argv.includes('--watch')) await (await context(config)).watch();
  else await build(config);
}
