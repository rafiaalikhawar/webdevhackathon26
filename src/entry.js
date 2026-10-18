// Deep links from emails, Google OAuth and payment returns (/?lead=…, /?calendar=…, /?payment=…) open the app, not the marketing page.
// Each document loads one frontend so their global styles and animation systems stay isolated.
const params = new URLSearchParams(location.search);
const workspaceRoute = location.pathname === '/workspace' || location.pathname.startsWith('/form/') || params.has('invite') || params.has('lead') || params.has('calendar') || params.has('payment');

if (workspaceRoute) {
  document.title = 'RESX — Everything, in motion.';
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', '#f8f9fb');
  document.querySelector('meta[name="description"]')?.setAttribute('content', 'RESX brings your customers, conversations and sales pipeline together. Everything, in motion.');
  import('./main.tsx');
} else {
  import('./landing/main.jsx');
}
