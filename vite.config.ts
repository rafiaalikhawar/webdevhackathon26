import { defineConfig } from 'vite';
// allowedHosts: true lets a dev tunnel hostname (cloudflared/ngrok) reach the dev server so provider webhooks can use it.
export default defineConfig({server:{allowedHosts:true,proxy:{'/api':'http://127.0.0.1:3001'}},build:{outDir:'dist'}});
