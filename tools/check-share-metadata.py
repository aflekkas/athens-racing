#!/usr/bin/env python3
"""Read server-rendered metadata as link-preview crawlers; no browser/JS needed.
Usage: python3 tools/check-share-metadata.py https://localhost:8796 --origin https://athens-street-racers-staging.aflekkas.workers.dev --insecure
"""
import argparse
import http.client
import json
import ssl
import struct
from html.parser import HTMLParser
from urllib.parse import urlsplit

def jpeg_dimensions(body):
    offset = 2
    while offset < len(body):
        assert body[offset] == 255, 'Invalid JPEG marker'
        while body[offset] == 255: offset += 1
        marker = body[offset]; offset += 1
        length = struct.unpack_from('>H', body, offset)[0]
        if marker in (192, 193, 194):
            height, width = struct.unpack_from('>HH', body, offset + 3)
            return width, height
        offset += length
    raise AssertionError('JPEG dimensions missing')

class HeadParser(HTMLParser):
    def __init__(self):
        super().__init__()
        self.meta, self.links, self.schema, self.title = {}, {}, '', ''
        self.in_schema = self.in_title = False
    def handle_starttag(self, tag, attrs):
        attrs = dict(attrs)
        if tag == 'meta':
            key = attrs.get('property') or attrs.get('name')
            if key:
                assert key not in self.meta, f'Duplicate metadata: {key}'
                self.meta[key] = attrs.get('content', '')
        if tag == 'link':
            self.links[attrs.get('rel')] = attrs.get('href')
        if tag == 'script' and attrs.get('type') == 'application/ld+json':
            self.in_schema = True
        if tag == 'title': self.in_title = True
    def handle_endtag(self, tag):
        if tag == 'script': self.in_schema = False
        if tag == 'title': self.in_title = False
    def handle_data(self, data):
        if self.in_schema: self.schema += data
        if self.in_title: self.title += data

def main():
    args = argparse.ArgumentParser(description=__doc__)
    args.add_argument('url')
    args.add_argument('--origin', help='Request Host/metadata origin when connecting to a local Worker')
    args.add_argument('--insecure', action='store_true', help='Trust a local dev TLS certificate')
    opts = args.parse_args()
    target = urlsplit(opts.url)
    origin = (opts.origin or f'{target.scheme}://{target.netloc}').rstrip('/')
    assert urlsplit(origin).scheme == target.scheme, 'Use --local-protocol https to test public HTTPS origins'
    def get(path, agent):
        kw = {'timeout': 30}
        if target.scheme == 'https':
            kw['context'] = ssl._create_unverified_context() if opts.insecure else ssl.create_default_context()
        cls = http.client.HTTPSConnection if target.scheme == 'https' else http.client.HTTPConnection
        conn = cls(target.hostname, target.port, **kw)
        conn.request('GET', path, headers={'Host': urlsplit(origin).netloc, 'User-Agent': agent})
        response = conn.getresponse()
        body, headers, status = response.read(), dict(response.getheaders()), response.status
        conn.close()
        assert status == 200, (path, status)
        return body, {k.lower(): v for k, v in headers.items()}
    for agent in ['facebookexternalhit/1.1', 'Twitterbot/1.0', 'WhatsApp/2.24', 'Discordbot/2.0', 'Slackbot-LinkExpanding 1.0', 'Applebot/0.1']:
        body, headers = get('/', agent)
        assert 'text/html' in headers['content-type']
        p = HeadParser(); p.feed(body.decode())
        m = p.meta
        assert p.title == 'Athens Street Racers — Free Browser Racing'
        assert 140 <= len(m['description']) <= 160
        assert p.links['canonical'] == origin + '/'
        expected = {'og:type':'website', 'og:site_name':'Athens Street Racers', 'og:title':'Athens Street Racers', 'og:url':origin+'/', 'og:image':origin+'/assets/share/og-image.jpg', 'og:image:type':'image/jpeg', 'og:image:width':'1200', 'og:image:height':'630', 'og:locale':'en_US', 'twitter:card':'summary_large_image', 'twitter:title':'Athens Street Racers', 'twitter:image':origin+'/assets/share/og-image.jpg', 'theme-color':'#07090c', 'color-scheme':'dark', 'apple-mobile-web-app-title':'Athens Street Racers', 'apple-mobile-web-app-capable':'yes', 'application-name':'Athens Street Racers', 'viewport':'width=device-width, initial-scale=1, viewport-fit=cover'}
        for k, v in expected.items(): assert m[k] == v, (k, m.get(k), v)
        assert m['og:description'] == m['twitter:description'] == m['description']
        assert m['og:image:alt'] == m['twitter:image:alt'] and m['og:image:alt']
        assert p.links['manifest'] == 'assets/manifest.webmanifest'
        schema = json.loads(p.schema)
        assert schema['@context'] == 'https://schema.org' and schema['@type'] == 'VideoGame'
        assert schema['name'] == m['og:title'] and schema['description'] == m['description']
        assert schema['url'] == origin+'/' and schema['image'] == m['og:image']
        assert schema['genre'] == 'Racing' and schema['gamePlatform'] == 'Web browser'
        assert schema['playMode'] == ['SinglePlayer', 'MultiPlayer']
        assert schema['offers']['price'] == '0' and schema['offers']['priceCurrency'] == 'EUR'
        print(json.dumps({'agent':agent, 'origin':origin, 'passed':True, 'og':{k:v for k,v in m.items() if k.startswith('og:')}, 'twitter':{k:v for k,v in m.items() if k.startswith('twitter:')}}, ensure_ascii=False))
    for name in ['og-image.jpg', 'og-image-square.jpg']:
        body, headers = get('/assets/share/'+name, 'facebookexternalhit/1.1')
        assert headers['content-type'] == 'image/jpeg'
        assert 'max-age=86400' in headers['cache-control']
        assert body[:2] == b'\xff\xd8' and len(body) <= 300000
        size = jpeg_dimensions(body)
        assert size == (1200, 630 if name == 'og-image.jpg' else 1200), (name, size)
        print(json.dumps({'image':name, 'dimensions':size, 'bytes':len(body), 'headers':headers}))
    robots, _ = get('/robots.txt','Twitterbot/1.0')
    assert b'Allow: /' in robots and (origin+'/sitemap.xml').encode() in robots
    sitemap, _ = get('/sitemap.xml','Twitterbot/1.0')
    assert ('<loc>'+origin+'/</loc>').encode() in sitemap
    manifest, _ = get('/assets/manifest.webmanifest','Applebot/0.1')
    assert json.loads(manifest)['name'] == 'Athens Street Racers'
    print('PASS: all metadata, JSON-LD, JPEG responses, cache headers, robots, sitemap and manifest')

if __name__ == '__main__': main()
