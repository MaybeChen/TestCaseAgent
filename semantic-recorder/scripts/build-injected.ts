import { build } from 'esbuild';
await build({ entryPoints: ['src/injected/recorder.ts'], outfile: 'dist/injected/recorder.js', bundle: true, format: 'iife', platform: 'browser', target: 'es2022' });
