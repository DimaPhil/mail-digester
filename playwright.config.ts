import { defineConfig } from "@playwright/test";

const port = Number(process.env.PLAYWRIGHT_PORT ?? "4101");
const baseURL = `http://127.0.0.1:${port}`;

export default defineConfig({
  testDir: "./e2e",
  fullyParallel: true,
  use: {
    baseURL,
    headless: true,
  },
  webServer: {
    command: `sh -c 'rm -f ./data/e2e.sqlite ./data/e2e.sqlite-shm ./data/e2e.sqlite-wal && npm run build && OPENAI_API_KEY=test-openai-key MAIL_DIGESTER_USE_FIXTURE_DATA=1 MAIL_DIGESTER_DB_PATH=./data/e2e.sqlite MAIL_DIGESTER_TEST_ARTICLE_BASE_URL=http://fixtures.test PORT=${port} npm run start -- --hostname 127.0.0.1'`,
    url: baseURL,
    reuseExistingServer: false,
    timeout: 120_000,
  },
});
