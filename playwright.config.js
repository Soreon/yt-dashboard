// End-to-end tests (tests/e2e): the app served locally, Google and the YouTube API faked

import { defineConfig, devices } from '@playwright/test';

const PORT = 4173;
const CI = Boolean(process.env.CI);

export default defineConfig({
    testDir: 'tests/e2e',
    fullyParallel: true,
    forbidOnly: CI,
    retries: CI ? 1 : 0,
    reporter: CI ? [['github'], ['html', { open: 'never' }]] : 'list',
    use: {
        baseURL: `http://127.0.0.1:${PORT}`,
        locale: 'fr-FR',
        trace: 'retain-on-failure'
    },
    projects: [
        {
            name: 'chromium',
            // Locally, the installed Google Chrome (no browser download through a proxy);
            // on CI, Playwright's own Chromium
            use: { ...devices['Desktop Chrome'], channel: CI ? undefined : 'chrome' }
        }
    ],
    webServer: {
        command: `node tests/e2e/server.js ${PORT}`,
        // Wait on the TCP port rather than an URL: an HTTP check may go through a corporate proxy,
        // whose 403 answer Playwright would take for a server already running
        port: PORT,
        reuseExistingServer: !CI
    }
});
