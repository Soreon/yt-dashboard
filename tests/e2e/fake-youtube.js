// Fake Google Identity Services and YouTube Data API, answered through Playwright network routes.
// Nothing leaves the test: any other external request (fonts, thumbnails, youtube.com) is aborted.

const HOUR = 3600 * 1000;
const DAY = 24 * HOUR;
const COLORS = { UC_A: '#c0392b', UC_B: '#2980b9', UC_C: '#27ae60', UC_X: '#8e44ad' };

function svgDataUrl(width, height, color, text) {
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}">`
        + `<rect width="100%" height="100%" fill="${color}"/>`
        + `<text x="50%" y="55%" font-size="${height / 5}" fill="white" text-anchor="middle">${text}</text></svg>`;
    return `data:image/svg+xml,${encodeURIComponent(svg)}`;
}

// The token "popup" answers at once, granting the scopes asked except those a test puts in
// window.__gis.refused (Google lets the user uncheck them); requests and revocations are recorded
const FAKE_GIS = `
    window.__gis = { tokenRequests: [], revoked: [], refused: [] };
    window.google = { accounts: { oauth2: {
        initTokenClient(config) {
            return {
                requestAccessToken(options) {
                    window.__gis.tokenRequests.push(options);
                    const scope = (options?.scope || config.scope).split(' ')
                        .filter(asked => !window.__gis.refused.includes(asked)).join(' ');
                    setTimeout(() => config.callback({ access_token: 'token-from-popup', expires_in: 3599, scope }), 10);
                }
            };
        },
        hasGrantedAllScopes(response, ...scopes) {
            return scopes.every(scope => (response.scope || '').split(' ').includes(scope));
        },
        revoke(token, done) {
            window.__gis.revoked.push(token);
            if (done) done();
        }
    } } };
`;

export class FakeYouTube {
    constructor() {
        this.subscriptions = ['UC_A', 'UC_B', 'UC_C'];
        this.noLongForm = new Set(); // Channels whose long-form playlist (UULF…) answers 404
        this.failures = {}; // { endpoint: HTTP status } to make an endpoint fail
        this.newVideos = []; // Videos published on UC_A during the test: { videoId, publishedAt }
        this.inactive = new Set(); // Channels whose videos are all more than a year old
        this.calls = []; // Every API call: { endpoint, params, auth }
        this.gisDelay = 300; // The Google script loads asynchronously, like the real one
        // Drive: files of the hidden app folder, shared by every context this fake is installed on
        this.driveFiles = new Map(); // id → { name, parents, version, content }
        this.driveCalls = []; // { method, path, params }
        this.driveFailure = null; // { status, json } answered to every Drive call
    }

    // Content of the sync file in the fake Drive, parsed (null if there is none)
    driveFile() {
        const file = [...this.driveFiles.values()].find(({ name }) => name === 'global-video-feed.json');
        return file?.content ? JSON.parse(file.content) : null;
    }

    driveUploads() {
        return this.driveCalls.filter(call => call.method === 'PATCH').length;
    }

    // A new video appears on UC_A, published now
    publishVideo(videoId) {
        this.newVideos.push({ videoId, publishedAt: Date.now() });
    }

    count(endpoint) {
        return this.calls.filter(call => call.endpoint === endpoint).length;
    }

    async install(context) {
        await context.route('**/*', route => this.handle(route));
    }

    async handle(route) {
        const url = new URL(route.request().url());

        if (url.hostname === '127.0.0.1' || url.hostname === 'localhost') {
            return route.continue();
        }
        if (url.origin === 'https://accounts.google.com' && url.pathname === '/gsi/client') {
            await new Promise(resolve => setTimeout(resolve, this.gisDelay));
            return route.fulfill({ contentType: 'text/javascript', body: FAKE_GIS });
        }
        if (url.origin === 'https://www.googleapis.com' && url.pathname.startsWith('/youtube/v3/')) {
            return this.answerApi(route, url);
        }
        if (url.origin === 'https://www.googleapis.com' && /^\/(upload\/)?drive\/v3\/files/.test(url.pathname)) {
            return this.answerDrive(route, url);
        }
        return route.abort();
    }

    // Drive API v3, for the calls the app makes: list, create, get version, download, upload
    answerDrive(route, url) {
        const request = route.request();
        const method = request.method();
        const params = Object.fromEntries(url.searchParams);
        const fileId = /\/files\/([^/]+)$/.exec(url.pathname)?.[1];
        this.driveCalls.push({ method, path: url.pathname, params });

        if (this.driveFailure) {
            return route.fulfill({ status: this.driveFailure.status, json: this.driveFailure.json });
        }

        if (!fileId && method === 'GET') {
            const name = /name = '([^']+)'/.exec(params.q || '')?.[1];
            const files = [...this.driveFiles]
                .filter(([, file]) => params.spaces === 'appDataFolder' && file.parents.includes('appDataFolder') && file.name === name)
                .map(([id, file]) => ({ id, version: String(file.version) }));
            return route.fulfill({ json: { files } });
        }
        if (!fileId && method === 'POST') {
            const { name, parents = [] } = JSON.parse(request.postData() || '{}');
            const id = `file${this.driveFiles.size + 1}`;
            this.driveFiles.set(id, { name, parents, version: 1, content: '' });
            return route.fulfill({ json: { id } });
        }

        const file = this.driveFiles.get(fileId);
        if (!file) {
            return route.fulfill({ status: 404, json: { error: { code: 404 } } });
        }
        if (method === 'PATCH') {
            file.content = request.postData();
            file.version++;
            return route.fulfill({ json: { version: String(file.version) } });
        }
        return params.alt === 'media'
            ? route.fulfill({ contentType: 'application/json', body: file.content })
            : route.fulfill({ json: { version: String(file.version) } });
    }

    answerApi(route, url) {
        const endpoint = url.pathname.split('/').pop();
        const params = Object.fromEntries(url.searchParams);
        this.calls.push({ endpoint, params, auth: route.request().headers().authorization });

        const status = this.failures[endpoint];
        if (status) {
            return route.fulfill({ status, json: { error: { code: status } } });
        }

        switch (endpoint) {
            case 'subscriptions': return route.fulfill({ json: this.subscriptionsResponse() });
            case 'channels': return route.fulfill({ json: params.mine ? this.myChannel() : this.channels(params.id) });
            case 'playlistItems': return this.playlistItems(route, params);
            case 'videos': return route.fulfill({ json: this.videoDetails(params.id) });
            default: return route.fulfill({ status: 404, json: {} });
        }
    }

    subscriptionsResponse() {
        return {
            items: this.subscriptions.map(channelId => ({
                snippet: {
                    title: `Chaîne ${channelId.slice(3)}`,
                    resourceId: { channelId },
                    thumbnails: { default: { url: svgDataUrl(88, 88, COLORS[channelId] || '#555', channelId.slice(3)) } }
                }
            }))
        };
    }

    myChannel() {
        return { items: [{ snippet: { title: 'Jean Testeur', thumbnails: { default: { url: svgDataUrl(88, 88, '#e67e22', 'J') } } } }] };
    }

    channels(ids) {
        return {
            items: ids.split(',').map(id => ({ id, contentDetails: { relatedPlaylists: { uploads: `UU${id.slice(2)}` } } }))
        };
    }

    // UUxx: all uploads, Shorts mixed in; UULFxx: long-form videos only
    playlistItems(route, { playlistId, maxResults }) {
        const longForm = playlistId.startsWith('UULF');
        const channelId = `UC${playlistId.slice(longForm ? 4 : 2)}`;

        if (longForm && this.noLongForm.has(channelId)) {
            return route.fulfill({ status: 404, json: { error: { code: 404 } } });
        }

        const channelIndex = ['UC_A', 'UC_B', 'UC_C'].indexOf(channelId) + 1 || 4;
        const base = Date.now() - channelIndex * HOUR - (this.inactive.has(channelId) ? 400 * DAY : 0);
        const item = (videoId, title, publishedAt) => ({
            snippet: {
                title,
                description: 'x'.repeat(2000),
                channelTitle: `Chaîne ${channelId.slice(3)}`,
                publishedAt: new Date(publishedAt).toISOString(),
                resourceId: { videoId },
                thumbnails: { high: { url: svgDataUrl(480, 270, COLORS[channelId] || '#555', videoId) } }
            }
        });

        const items = [];
        for (let i = 0; i < 5; i++) {
            items.push(item(`${channelId}_v${i}`, `Vidéo ${i + 1} de ${channelId}`, base - i * DAY));
            if (!longForm) items.push(item(`${channelId}_s${i}`, `#Short ${i + 1} de ${channelId}`, base - i * DAY + HOUR / 2));
        }
        if (channelId === 'UC_A') {
            this.newVideos.forEach(({ videoId, publishedAt }) => items.push(item(videoId, `Nouvelle vidéo ${videoId}`, publishedAt)));
        }

        items.sort((a, b) => b.snippet.publishedAt.localeCompare(a.snippet.publishedAt));
        return route.fulfill({ json: { items: items.slice(0, Number(maxResults) || 5) } });
    }

    // Deterministic duration and view count per video
    videoDetails(ids) {
        return {
            items: ids.split(',').map((id, index) => ({
                id,
                contentDetails: { duration: id.includes('_s') ? 'PT45S' : `PT${10 + index}M${index}S` },
                statistics: { viewCount: String(1000 * (index + 1) + 290) }
            }))
        };
    }
}
