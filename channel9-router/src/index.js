/**
 * channel9-router — Grassroots Rodeo Channel 9
 * Enhanced with Workers Caching (cache.enabled: true in wrangler.jsonc).
 * The CDN cache sits in front of this Worker — on a cache hit, the Worker
 * never runs, saving CPU and R2 operations.
 *
 * Updated 9/20/26: Switched from Cache API (caches.default) to Workers Caching.
 */

const CHANNEL_CONFIG = {
  channelId: '9',
  name: 'Channel 9 - Grassroots Rodeo',
  playoutUrl: 'https://www2.grassrootsrodeo.com/api/channels/9/live',
  epgUrl: 'https://grassrootsrodeo.com'
};

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Range'
};

export default {
  async fetch(request, env, ctx) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const pathname = url.pathname.toLowerCase().replace(/\/$/, '');

    // 1. API: Live Playout & Offset Synchronization
    if (pathname === '/api/live-sync') {
      return handleLiveSync();
    }

    // 2. API: EPG Proxy
    if (pathname === '/api/epg.xml') {
      return handleEpgProxy();
    }

    // 3. Manifests (.m3u8) — 7-day cache via Workers Caching
    if (pathname.endsWith('.m3u8')) {
      const response = await fetchFromR2(request, env);
      if (response.status !== 200) return response;

      response.headers.set('Cache-Control', 'public, max-age=604800');
      response.headers.set('Content-Type', 'application/vnd.apple.mpegurl');
      Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    // 4. Video Chunks (.ts) — 30-day immutable cache via Workers Caching
    //    Override Content-Type to video/mp2t to fix CDN caching of dlna-mpeg-tts objects.
    if (pathname.endsWith('.ts')) {
      const response = await fetchFromR2(request, env);
      if (response.status !== 200) return response;

      response.headers.set('Cache-Control', 'public, max-age=2592000, immutable');
      response.headers.set('Content-Type', 'video/mp2t');
      Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
      return response;
    }

    // 5. Fallback — cache all other responses for 1 day
    const response = await fetchFromR2(request, env);
    response.headers.set('Cache-Control', 'public, max-age=86400');
    Object.entries(CORS_HEADERS).forEach(([k, v]) => response.headers.set(k, v));
    return response;
  }
};

async function fetchFromR2(request, env) {
  const url = new URL(request.url);
  const objectKey = url.pathname.replace(/^\/+/, '');

  try {
    const object = await env.GRR_BUCKET.get(objectKey);
    if (!object) {
      return new Response('File Not Found in R2 Bucket', { status: 404, headers: CORS_HEADERS });
    }

    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set('ETag', object.httpEtag);
    Object.entries(CORS_HEADERS).forEach(([k, v]) => headers.set(k, v));
    return new Response(object.body, { headers });
  } catch (error) {
    return new Response(`R2 Storage Error: ${error.message}`, { status: 500, headers: CORS_HEADERS });
  }
}

async function handleLiveSync() {
  try {
    const upstreamRes = await fetch(CHANNEL_CONFIG.playoutUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/json'
      }
    });

    const responseText = await upstreamRes.text();

    if (responseText.trim().startsWith('<!doctype') || responseText.trim().startsWith('<html')) {
      return new Response(JSON.stringify({
        status: "error",
        message: "The backend server returned an HTML webpage instead of JSON data. Check if your endpoint requires authentication or has a firewall rule.",
        htmlSnippet: responseText.slice(0, 200)
      }), { status: 502, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } });
    }

    const playoutData = JSON.parse(responseText);
    const nowMs = Date.now();

    const cleanPayload = {
      status: "success",
      channelName: CHANNEL_CONFIG.name,
      synchronizedAtMs: nowMs,
      isPlaying: playoutData.playing,
      currentTrack: {
        title: playoutData.currentItem?.title || "Unknown Program",
        manifestUrl: playoutData.currentItem?.stream_url || "",
        durationSeconds: playoutData.currentItem?.duration || 0,
        seekOffsetMs: (playoutData.offsetSeconds || 0) * 1000
      },
      nextTrack: {
        title: playoutData.nextItem?.title || "Upcoming Program",
        manifestUrl: playoutData.nextItem?.stream_url || ""
      }
    };

    return new Response(JSON.stringify(cleanPayload), {
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store', ...CORS_HEADERS }
    });

  } catch (error) {
    return new Response(JSON.stringify({ status: "error", message: "Failed to fetch live sync timeline", details: error.message }), {
      status: 502,
      headers: { 'Content-Type': 'application/json', ...CORS_HEADERS }
    });
  }
}

async function handleEpgProxy() {
  try {
    const upstreamRes = await fetch(CHANNEL_CONFIG.epgUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'
      }
    });
    const xmlText = await upstreamRes.text();
    return new Response(xmlText, {
      headers: { 'Content-Type': 'application/xml; charset=utf-8', 'Cache-Control': 'public, max-age=300', ...CORS_HEADERS }
    });
  } catch (error) {
    return new Response('<tv></tv>', { status: 502, headers: { 'Content-Type': 'application/xml', ...CORS_HEADERS } });
  }
}
