/** @jsxRuntime classic */
/** @jsx Html.createElement */
/** @jsxFrag Html.Fragment */
// oxlint-disable-next-line no-unused-vars -- Html is the classic JSX factory.
import { Html } from "@elysia/html";
import type { App } from "../../http";
import { VerdictChips, CampaignBadge } from "./layout";
import {
  Button,
  LinkButton,
  Input,
  Select,
  Textarea,
  Label,
  FormGroup,
  Table,
  Th,
  Td,
  Card,
  PageHeader,
} from "./ui";
import { assetUrl } from "../../assets";

export function mountDesignRoutes(app: App) {
  app.get("/design", (c) => {
    return c.html(
      <html>
        <head>
          <meta charset="UTF-8" />
          <meta
            name="viewport"
            content="width=device-width, initial-scale=1.0"
          />
          <title>Design System - lists</title>
          <link rel="stylesheet" href={assetUrl("/static/styles.css")} />
        </head>
        <body class="font-sans text-gray-900 bg-gray-50 m-0 p-0 leading-relaxed">
          <div class="max-w-4xl mx-auto px-4 py-8 sm:px-6 sm:py-12">
            <h1 class="text-3xl font-bold mb-2">Design system</h1>
            <p class="text-gray-500 mb-12">
              Visual elements and patterns used throughout lists.
            </p>

            {/* ── Color Palette ──────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Color palette
              </h2>
              <p class="text-sm text-gray-500 mb-4">
                Blue-600 for primary actions, gray-700 for headings, gray-500
                for secondary text.
              </p>
              <div class="flex flex-wrap gap-2 mb-4">
                {[
                  "bg-blue-50",
                  "bg-blue-100",
                  "bg-blue-200",
                  "bg-blue-300",
                  "bg-blue-400",
                  "bg-blue-500",
                  "bg-blue-600",
                  "bg-blue-700",
                  "bg-blue-800",
                  "bg-blue-900",
                ].map((shade) => (
                  <div class={`${shade} w-12 h-12 rounded`} title={shade} />
                ))}
              </div>
              <div class="flex flex-wrap gap-4">
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-red-500" />
                  <span class="text-xs text-gray-500">Danger / Error</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-amber-500" />
                  <span class="text-xs text-gray-500">Warning</span>
                </div>
                <div class="flex items-center gap-2">
                  <div class="w-6 h-6 rounded bg-green-500" />
                  <span class="text-xs text-gray-500">Success</span>
                </div>
              </div>
            </section>

            {/* ── Typography ─────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Typography
              </h2>
              <div class="space-y-3">
                <div>
                  <span class="text-2xl font-bold text-gray-900">
                    Page Title
                  </span>{" "}
                  <span class="text-xs text-gray-400 ml-2">
                    text-2xl font-bold
                  </span>
                </div>
                <div>
                  <span class="text-xl font-semibold text-gray-800">
                    Section Heading
                  </span>{" "}
                  <span class="text-xs text-gray-400 ml-2">
                    text-xl font-semibold
                  </span>
                </div>
                <div>
                  <span class="text-sm font-medium text-gray-700">
                    Label / Field Heading
                  </span>{" "}
                  <span class="text-xs text-gray-400 ml-2">
                    text-sm font-medium text-gray-700
                  </span>
                </div>
                <div>
                  <span class="text-sm text-gray-700">Body text</span>{" "}
                  <span class="text-xs text-gray-400 ml-2">
                    text-sm text-gray-700
                  </span>
                </div>
                <div>
                  <span class="text-sm text-gray-500">Secondary text</span>{" "}
                  <span class="text-xs text-gray-400 ml-2">
                    text-sm text-gray-500
                  </span>
                </div>
                <div>
                  <span class="text-xs text-gray-400">Muted / Meta text</span>{" "}
                  <span class="text-xs text-gray-400 ml-2">
                    text-xs text-gray-400
                  </span>
                </div>
                <div>
                  <span class="text-sm font-mono text-gray-600">
                    Monospace / Code
                  </span>{" "}
                  <span class="text-xs text-gray-400 ml-2">font-mono</span>
                </div>
              </div>
            </section>

            {/* ── Buttons ────────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Buttons
              </h2>

              <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                Standard (md)
              </h3>
              <div class="flex flex-wrap gap-3 mb-6">
                <Button type="button">Primary</Button>
                <Button type="button" variant="danger">
                  Danger
                </Button>
                <Button type="button" variant="secondary">
                  Secondary
                </Button>
              </div>

              <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                Small (sm)
              </h3>
              <div class="flex flex-wrap gap-3 mb-6">
                <Button type="button" size="sm">
                  Primary
                </Button>
                <Button type="button" size="sm" variant="danger">
                  Danger
                </Button>
                <Button type="button" size="sm" variant="secondary">
                  Secondary
                </Button>
                <Button type="button" size="sm" variant="ghost">
                  Ghost / Delete
                </Button>
              </div>

              <h3 class="text-sm font-medium text-gray-500 uppercase tracking-wide mb-3">
                Link buttons
              </h3>
              <div class="flex flex-wrap gap-3 mb-6">
                <LinkButton href="#">Primary Link</LinkButton>
                <LinkButton href="#" variant="danger">
                  Danger Link
                </LinkButton>
              </div>
            </section>

            {/* ── Form Inputs ────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Form inputs
              </h2>
              <Card>
                <FormGroup>
                  <Label for="demo-text">Text Input</Label>
                  <Input
                    type="text"
                    id="demo-text"
                    placeholder="Placeholder text..."
                  />
                </FormGroup>
                <FormGroup>
                  <Label for="demo-email">Email Input</Label>
                  <Input
                    type="email"
                    id="demo-email"
                    placeholder="you@example.com"
                  />
                </FormGroup>
                <FormGroup>
                  <Label for="demo-select">Select</Label>
                  <Select id="demo-select">
                    <option>Option one</option>
                    <option>Option two</option>
                    <option>Option three</option>
                  </Select>
                </FormGroup>
                <FormGroup>
                  <Label for="demo-textarea">Textarea</Label>
                  <Textarea
                    id="demo-textarea"
                    placeholder="Write something..."
                  />
                </FormGroup>
                <FormGroup>
                  <label class="flex items-center gap-2 text-sm text-gray-700">
                    <input type="checkbox" class="rounded" />
                    Checkbox option
                  </label>
                </FormGroup>
                <Button type="button">Submit</Button>
              </Card>
            </section>

            {/* ── Tables ─────────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Tables
              </h2>
              <Table>
                <thead>
                  <tr>
                    <Th>Name</Th>
                    <Th>Email</Th>
                    <Th>Status</Th>
                    <Th>Date</Th>
                  </tr>
                </thead>
                <tbody>
                  <tr>
                    <Td>Mina Patel</Td>
                    <Td>mina@example.com</Td>
                    <Td>
                      <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                        active
                      </span>
                    </Td>
                    <Td class="text-gray-400">Mar 15, 2026</Td>
                  </tr>
                  <tr>
                    <Td>Rowan Hughes</Td>
                    <Td>rowan@example.com</Td>
                    <Td>
                      <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                        blocklisted
                      </span>
                    </Td>
                    <Td class="text-gray-400">Mar 10, 2026</Td>
                  </tr>
                  <tr>
                    <Td>Alice</Td>
                    <Td>alice@example.com</Td>
                    <Td>
                      <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                        unconfirmed
                      </span>
                    </Td>
                    <Td class="text-gray-400">Mar 8, 2026</Td>
                  </tr>
                </tbody>
              </Table>
            </section>

            {/* ── Cards ──────────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Cards
              </h2>

              <h3 class="text-sm font-medium text-gray-500 mb-3">
                Standard card
              </h3>
              <Card>
                <p class="text-sm text-gray-700 m-0">
                  This is a standard card used for forms, detail sections, and
                  grouped content.
                </p>
              </Card>

              <h3 class="text-sm font-medium text-gray-500 mb-3">
                Page header
              </h3>
              <Card>
                <PageHeader title="Page Title">
                  <LinkButton href="#">Action</LinkButton>
                </PageHeader>
              </Card>
            </section>

            {/* ── Badges ─────────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Badges
              </h2>

              <h3 class="text-sm font-medium text-gray-500 mb-3">
                Campaign status
              </h3>
              <div class="flex flex-wrap gap-3 mb-6">
                <CampaignBadge status="draft" />
                <CampaignBadge status="sending" />
                <CampaignBadge status="sent" />
                <CampaignBadge status="failed" />
              </div>

              <h3 class="text-sm font-medium text-gray-500 mb-3">
                Subscriber status
              </h3>
              <div class="flex flex-wrap gap-3 mb-6">
                <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800">
                  active
                </span>
                <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-red-100 text-red-800">
                  blocklisted
                </span>
                <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-amber-100 text-amber-800">
                  unconfirmed
                </span>
                <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-blue-100 text-blue-800">
                  confirmed
                </span>
                <span class="inline-block px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-800">
                  unsubscribed
                </span>
              </div>

              <h3 class="text-sm font-medium text-gray-500 mb-3">
                Verdict chips
              </h3>
              <div class="flex flex-wrap gap-6">
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">All pass:</span>
                  <VerdictChips spf="PASS" dkim="PASS" dmarc="PASS" />
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">Mixed:</span>
                  <VerdictChips spf="PASS" dkim="FAIL" dmarc="PASS" />
                </div>
                <div class="flex items-center gap-2">
                  <span class="text-xs text-gray-500">All fail:</span>
                  <VerdictChips spf="FAIL" dkim="FAIL" dmarc="FAIL" />
                </div>
              </div>
            </section>

            {/* ── Tags ───────────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Tags
              </h2>
              <div class="flex flex-wrap gap-2">
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                  imported-2026-03
                  <button
                    type="button"
                    class="bg-transparent border-none cursor-pointer text-gray-400 hover:text-red-600 p-0 text-xs leading-none"
                  >
                    &times;
                  </button>
                </span>
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                  vip
                  <button
                    type="button"
                    class="bg-transparent border-none cursor-pointer text-gray-400 hover:text-red-600 p-0 text-xs leading-none"
                  >
                    &times;
                  </button>
                </span>
                <span class="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-xs font-medium bg-gray-100 text-gray-700">
                  hackathon-attendee
                  <button
                    type="button"
                    class="bg-transparent border-none cursor-pointer text-gray-400 hover:text-red-600 p-0 text-xs leading-none"
                  >
                    &times;
                  </button>
                </span>
              </div>
            </section>

            {/* ── Stats ──────────────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Stats
              </h2>
              <div class="grid grid-cols-1 gap-4 sm:grid-cols-3">
                <div class="inline-flex flex-col items-center bg-white border border-gray-200 rounded-lg px-6 py-4 min-w-[120px] text-center">
                  <span class="text-3xl font-bold text-blue-600">42</span>
                  <span class="text-xs text-gray-500 uppercase tracking-wide">
                    Subscribers
                  </span>
                </div>
                <div class="inline-flex flex-col items-center bg-white border border-gray-200 rounded-lg px-6 py-4 min-w-[120px] text-center">
                  <span class="text-3xl font-bold text-blue-600">3</span>
                  <span class="text-xs text-gray-500 uppercase tracking-wide">
                    Lists
                  </span>
                </div>
                <div class="inline-flex flex-col items-center bg-white border border-gray-200 rounded-lg px-6 py-4 min-w-[120px] text-center">
                  <span class="text-3xl font-bold text-blue-600">7</span>
                  <span class="text-xs text-gray-500 uppercase tracking-wide">
                    Campaigns
                  </span>
                </div>
              </div>
            </section>

            {/* ── Thread Messages ─────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Thread messages
              </h2>

              <div class="bg-white border border-gray-200 rounded-lg p-5 mb-4">
                <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <div>
                    <span class="font-medium text-sm">
                      jack@spellbook.legal
                    </span>
                    <span class="text-gray-400 text-xs ml-2">
                      {"\u2192"} do-it@reply.siliconharbour.dev
                    </span>
                  </div>
                  <div class="flex items-center gap-2">
                    <span class="text-xs text-gray-400">
                      Mar 15, 2026 02:52
                    </span>
                    <VerdictChips spf="PASS" dkim="PASS" dmarc="PASS" />
                  </div>
                </div>
                <p class="text-sm text-gray-700 m-0">
                  Hey, just wanted to say the newsletter is looking great. Keep
                  it up!
                </p>
              </div>

              <div class="bg-blue-50 border border-blue-200 rounded-lg p-5 mb-4">
                <div class="flex flex-wrap items-baseline justify-between gap-2 mb-3">
                  <div>
                    <span class="font-medium text-sm text-blue-800">
                      do-it@reply.siliconharbour.dev
                    </span>
                    <span class="text-blue-400 text-xs ml-1">(You)</span>
                    <span class="text-blue-400 text-xs ml-2">
                      {"\u2192"} jack@spellbook.legal
                    </span>
                  </div>
                  <span class="text-xs text-gray-400">Mar 15, 2026 03:10</span>
                </div>
                <pre class="text-sm text-gray-700 whitespace-pre-wrap font-sans leading-relaxed m-0">
                  Thanks! Glad you're enjoying it.
                </pre>
              </div>
            </section>

            {/* ── Key Principles ──────────────────────────────── */}
            <section class="mb-16">
              <h2 class="text-xl font-semibold text-gray-700 mb-4 pb-2 border-b border-gray-200">
                Key principles
              </h2>
              <ul class="space-y-2 text-sm text-gray-600">
                <li>
                  <strong>Rounded corners</strong> - Soft, rounded edges on
                  cards, inputs, and buttons
                </li>
                <li>
                  <strong>Borders over shadows</strong> - Use border-gray-200
                  instead of shadow
                </li>
                <li>
                  <strong>Blue-600 primary</strong> - Primary actions and links
                </li>
                <li>
                  <strong>Compact tables</strong> - Light header, thin borders,
                  small text
                </li>
                <li>
                  <strong>Consistent spacing</strong> - mb-4 for form groups,
                  mb-6 for sections, gap-3/4 for flex
                </li>
                <li>
                  <strong>White cards on gray-50 bg</strong> - Content areas on
                  subtle background
                </li>
                <li>
                  <strong>Semantic colors</strong> - Green for success, red for
                  danger, amber for warning, blue for info
                </li>
                <li>
                  <strong>Minimal chrome</strong> - No unnecessary decoration,
                  content first
                </li>
                <li>
                  <strong>Visible focus</strong> - Keyboard focus is clear on
                  every interactive element
                </li>
                <li>
                  <strong>Responsive by default</strong> - Navigation scrolls
                  and tables stay usable on narrow screens
                </li>
              </ul>
            </section>

            <footer class="border-t border-gray-200 pt-6 pb-12 text-xs text-gray-400">
              lists design system
            </footer>
          </div>
        </body>
      </html>,
    );
  });
}
