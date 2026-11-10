import { defineConfig, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

/**
 * A content security policy for the built page: scripts only from this site, and connections only
 * to the database and the three job boards the "find a board" search asks. If a bad link or bit of
 * text ever got through, the browser still wouldn't run it or let it send data elsewhere. Left off
 * in `npm run dev`, where Vite needs inline scripts.
 */
const CSP = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
  "font-src https://fonts.gstatic.com",
  "img-src 'self' data:",
  "connect-src https://hzeciyeirloyzqkjvvln.supabase.co wss://hzeciyeirloyzqkjvvln.supabase.co https://boards-api.greenhouse.io https://api.lever.co https://api.ashbyhq.com",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join('; ');

const csp = (): Plugin => ({
  name: 'jobsnipe-csp',
  apply: 'build',
  transformIndexHtml: (html) => html.replace('<meta charset="UTF-8" />', `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${CSP}" />`),
});

export default defineConfig({
  base: '/jobsnipe/',
  plugins: [react(), tailwindcss(), csp()],
});
