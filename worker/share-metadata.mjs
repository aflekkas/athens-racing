const productionOrigin = 'https://athensracing.com';

// Crawlers get complete metadata in the HTTP response, without running JavaScript.
export async function rewriteShareMetadata(request, response) {
  if (!response.ok) return response;
  const url = new URL(request.url);
  const origin = url.origin;
  const headers = new Headers(response.headers);
  if (url.pathname === '/robots.txt' || url.pathname === '/sitemap.xml') {
    const body = (await response.text()).replaceAll(productionOrigin, origin);
    headers.delete('Content-Length');
    headers.delete('ETag');
    headers.set('Content-Type', url.pathname === '/sitemap.xml' ? 'application/xml; charset=utf-8' : 'text/plain; charset=utf-8');
    headers.set('Cache-Control', 'public, max-age=3600');
    return new Response(request.method === 'HEAD' ? null : body, { status: response.status, headers });
  }
  if (!headers.get('Content-Type')?.includes('text/html')) return response;
  headers.delete('Content-Length');
  headers.delete('ETag');
  headers.set('Cache-Control', 'no-cache');
  let schema = '';
  return new HTMLRewriter()
    .on('[data-share-origin]', { element(element) {
      const attr = element.tagName === 'link' ? 'href' : 'content';
      element.setAttribute(attr, element.getAttribute(attr).replace(productionOrigin, origin));
      element.removeAttribute('data-share-origin');
    } })
    .on('#game-schema', { text(chunk) {
      schema += chunk.text;
      chunk.remove();
      if (chunk.lastInTextNode) chunk.after(schema.replaceAll(productionOrigin, origin), { html: true });
    } })
    .transform(new Response(response.body, { status: response.status, headers }));
}
