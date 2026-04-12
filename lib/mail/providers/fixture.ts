import type {
  MailMessageRef,
  MailProvider,
  ProviderMessage,
} from "@/lib/mail/types";
import { providerMessageFromFixture } from "@/lib/digest/tldr";

const ARTICLE_BASE_URL =
  process.env.MAIL_DIGESTER_TEST_ARTICLE_BASE_URL ??
  `http://127.0.0.1:${process.env.PORT ?? "4001"}`;

const FIXTURE_MESSAGES: ProviderMessage[] = [
  providerMessageFromFixture({
    id: "fixture-ai-001",
    from: "TLDR AI <dan@tldrnewsletter.com>",
    subject: "OpenAI roadmap 🤖, Claude control panels 🧠, new eval tooling 🧪",
    receivedAt: Date.parse("2026-04-10T13:28:17Z"),
    snippet:
      "OpenAI published a roadmap update that sharpens enterprise positioning.",
    htmlBody: `
      <html><body>
        <p>HEADLINES & LAUNCHES</p>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/${encodeURIComponent(`${ARTICLE_BASE_URL}/test-fixtures/article/openai-roadmap`)}/1/token">OpenAI sharpens its enterprise roadmap (3 minute read)</a>
          <br /><br />
          <span>OpenAI outlined a clearer enterprise packaging strategy and a faster path from experimentation to deployment. The update focuses on procurement-friendly plans, better administrative controls, and an onboarding path that lets teams move from prototype evaluation to organization-wide rollout without stitching together separate tooling. It also gives leaders a simpler way to compare usage, cost, and deployment readiness before committing teams to a broader launch.</span>
        </div>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/${encodeURIComponent(`${ARTICLE_BASE_URL}/test-fixtures/redirect/claude-control-panels`)}/1/token">Claude adds role-aware control panels (4 minute read)</a>
          <br /><br />
          <span>Anthropic added configurable workspaces, budget controls, and higher-signal governance surfaces for teams.</span>
        </div>
        <p>DEEP DIVES & ANALYSIS</p>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/${encodeURIComponent(`${ARTICLE_BASE_URL}/test-fixtures/article/eval-loops`)}/1/token">A practical guide to evaluation loops (8 minute read)</a>
          <br /><br />
          <span>This walkthrough focuses on low-friction evaluation loops that catch product regressions before they reach users.</span>
        </div>
        <p>Want to advertise in TLDR? 📰</p>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fadvertise.tldr.tech%2F/1/token">Advertise</a>
        </div>
      </body></html>
    `,
  }),
  providerMessageFromFixture({
    id: "fixture-main-001",
    from: "TLDR <dan@tldrnewsletter.com>",
    subject: "Compute race ⚡, NASA systems 🛰️, programming hunches 👨‍💻",
    receivedAt: Date.parse("2026-04-09T10:32:59Z"),
    snippet:
      "Amazon detailed a more aggressive hardware strategy in its shareholder letter.",
    htmlBody: `
      <html><body>
        <p>TOP STORIES</p>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/${encodeURIComponent(`${ARTICLE_BASE_URL}/test-fixtures/article/compute-race`)}/1/token">Amazon escalates the infrastructure race (5 minute read)</a>
          <br /><br />
          <span>Amazon used its annual letter to frame custom silicon and logistics control as the next major moat in cloud competition.</span>
        </div>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/${encodeURIComponent(`${ARTICLE_BASE_URL}/test-fixtures/article/ai-humans`)}/1/token">The full-stack developer platform to build real-time AI humans (Sponsor)</a>
          <br /><br />
          <span>Build customizable real-time AI humans with lower latency and a clearer path from prototype to production.</span>
        </div>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/${encodeURIComponent(`${ARTICLE_BASE_URL}/test-fixtures/article/programming-hunches`)}/1/token">What are your programming "hunches" you haven't yet investigated? (Lobste.rs Thread)</a>
          <br /><br />
          <span>A high-signal community thread on engineering instincts that deserve experiments instead of endless debate.</span>
        </div>
        <div>
          <a href="https://tracking.tldrnewsletter.com/CL0/https:%2F%2Fa.tldrnewsletter.com%2Fweb-version%3Fep%3D1/1/token">View Online</a>
        </div>
      </body></html>
    `,
  }),
];

export class FixtureMailProvider implements MailProvider {
  async listUnreadCandidates(): Promise<MailMessageRef[]> {
    return FIXTURE_MESSAGES.map((message) => ({
      id: message.id,
      threadId: message.threadId,
    }));
  }

  async getMessage(messageId: string): Promise<ProviderMessage> {
    const message = FIXTURE_MESSAGES.find(
      (fixture) => fixture.id === messageId,
    );
    if (!message) {
      throw new Error(`Fixture message ${messageId} not found.`);
    }
    return structuredClone(message);
  }

  async markMessageRead() {
    return;
  }
}
