const MARKER = 'data-wasm-isolated';

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

function isolate(res, body) {
	const headers = new Headers(res.headers);
	headers.set('Cross-Origin-Embedder-Policy', 'require-corp');
	headers.set('Cross-Origin-Opener-Policy', 'same-origin');
	return new Response(body ?? res.body, {
		status: res.status,
		statusText: res.statusText,
		headers,
	});
}

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.cache === 'only-if-cached' && req.mode !== 'same-origin') return;
	if (new URL(req.url).origin !== location.origin) return;

	event.respondWith(
		(async () => {
			const res = await fetch(req);
			if (res.status === 0) return res;

			if (req.destination === 'document') {
				const isHtml = (res.headers.get('content-type') || '').includes('text/html');
				if (!isHtml) return res;
				const text = await res.text();
				return text.includes(MARKER)
					? isolate(res, text)
					: new Response(text, {
							status: res.status,
							statusText: res.statusText,
							headers: res.headers,
						});
			}

			return isolate(res);
		})(),
	);
});
