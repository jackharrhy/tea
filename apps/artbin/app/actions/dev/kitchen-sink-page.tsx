import { css, type Handle } from "remix/component";

import type { User } from "#db";

import { routes } from "../../routes.ts";
import { BrowseTabs } from "../../ui/browse-tabs.tsx";
import { FileCollection } from "../../ui/file-collection.tsx";
import { MediaCard } from "../../ui/media-card.tsx";
import { Breadcrumbs, Tabs } from "../../ui/navigation.tsx";
import { Page } from "../../ui/page.tsx";
import {
  Alert,
  Badge,
  Button,
  ButtonLink,
  CheckboxField,
  DataTable,
  Detail,
  DetailList,
  Disclosure,
  EmptyState,
  FormField,
  Inline,
  PageHeader,
  Panel,
  ProgressBar,
  SectionHeader,
  SelectInput,
  Stack,
  Stat,
  StatGrid,
  TableCell,
  TableHeaderCell,
  TableHeaderRow,
  TableRow,
  TextArea,
  TextInput,
} from "../../ui/primitives.tsx";
import { LuckyButton } from "../../ui/public/lucky-button.tsx";
import { ModelViewer } from "../../ui/public/model-viewer.tsx";
import { UploadControl } from "../../ui/public/upload-control.tsx";
import { SearchBar } from "../../ui/search-bar.tsx";
import { pageStyle, theme } from "../../ui/styles.ts";

const introStyle = css({
  color: theme.color.muted,
  margin: "-0.75rem 0 1.5rem",
  maxWidth: "54rem",
});
const indexStyle = css({
  borderBottom: `1px solid ${theme.color.borderLight}`,
  display: "flex",
  flexWrap: "wrap",
  fontSize: "0.75rem",
  gap: "0.5rem 1rem",
  marginBottom: "2.5rem",
  paddingBottom: "1rem",
});
const sectionStyle = css({ marginBottom: "3rem", scrollMarginTop: "4rem" });
const exampleGridStyle = css({
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))",
});
const mediaGridStyle = css({
  display: "grid",
  gap: "0.75rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(150px, 220px))",
});
const swatchesStyle = css({
  display: "grid",
  gap: "0.5rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(120px, 1fr))",
});
const swatchStyle = css({ border: `1px solid ${theme.color.borderLight}` });
const swatchColorStyle = css({ height: "3rem" });
const swatchLabelStyle = css({
  background: theme.color.background,
  fontSize: "0.7rem",
  padding: "0.375rem",
});
const typeSampleStyle = css({ margin: 0 });
const displayTypeStyle = css({ fontSize: "2.25rem", lineHeight: 1, margin: 0 });
const monoStyle = css({ fontFamily: theme.font.mono });
const controlRowStyle = css({
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
});
const formGridStyle = css({
  display: "grid",
  gap: "1rem",
  gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
});
const fullSpanStyle = css({ gridColumn: "1 / -1" });
const previewFrameStyle = css({
  background: theme.color.hover,
  border: `1px solid ${theme.color.borderLight}`,
  padding: "1rem",
});
const fileListStyle = css({ marginTop: "1rem" });
const codeStyle = css({ fontFamily: theme.font.mono, fontSize: "0.75rem" });

const sampleFiles = [
  {
    id: "texture",
    path: "examples/rusty-wall.png",
    name: "rusty-wall.png",
    kind: "texture",
    mimeType: "image/png",
    size: 22_835,
    width: 128,
    height: 128,
  },
  {
    id: "model",
    path: "examples/crate.glb",
    name: "crate.glb",
    kind: "model",
    mimeType: "model/gltf-binary",
    size: 348_160,
  },
  {
    id: "map",
    path: "examples/warehouse.bsp",
    name: "warehouse.bsp",
    kind: "map",
    mimeType: "application/octet-stream",
    size: 2_435_072,
  },
  {
    id: "config",
    path: "examples/readme.txt",
    name: "readme.txt",
    kind: "config",
    mimeType: "text/plain",
    size: 1_284,
  },
  {
    id: "audio",
    path: "examples/ambient.ogg",
    name: "ambient.ogg",
    kind: "audio",
    mimeType: "audio/ogg",
    size: 92_160,
  },
];

const pixelPreview =
  "data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 16 16' shape-rendering='crispEdges'%3E%3Cpath fill='%23262b25' d='M0 0h16v16H0z'/%3E%3Cpath fill='%23798159' d='M0 2h16v3H0zm0 8h16v3H0z'/%3E%3Cpath fill='%23b5aa78' d='M2 0h3v16H2zm8 0h3v16h-3z'/%3E%3C/svg%3E";
const sampleModel = `data:model/gltf+json,${encodeURIComponent(
  JSON.stringify({
    asset: { version: "2.0" },
    buffers: [
      {
        byteLength: 44,
        uri: "data:application/octet-stream;base64,AAAAAAAAAAAAAAAAAACAPwAAAAAAAAAAAAAAAAAAgD8AAAAAAAABAAIAAAA=",
      },
    ],
    bufferViews: [
      { buffer: 0, byteLength: 36, byteOffset: 0, target: 34_962 },
      { buffer: 0, byteLength: 6, byteOffset: 36, target: 34_963 },
    ],
    accessors: [
      {
        bufferView: 0,
        componentType: 5_126,
        count: 3,
        max: [1, 1, 0],
        min: [0, 0, 0],
        type: "VEC3",
      },
      { bufferView: 1, componentType: 5_123, count: 3, type: "SCALAR" },
    ],
    meshes: [{ primitives: [{ attributes: { POSITION: 0 }, indices: 1 }] }],
    nodes: [{ mesh: 0 }],
    scenes: [{ nodes: [0] }],
    scene: 0,
  }),
)}`;

const sections = [
  ["foundations", "Foundations"],
  ["actions", "Actions"],
  ["forms", "Forms"],
  ["feedback", "Feedback"],
  ["navigation", "Navigation"],
  ["data", "Data display"],
  ["media", "Media and files"],
  ["overlays", "Overlays and tools"],
] as const;

export function KitchenSinkPage(handle: Handle<{ user: User | null }>) {
  return () => (
    <Page title="Kitchen sink - artbin" user={handle.props.user}>
      <main mix={pageStyle}>
        <PageHeader
          eyebrow="Development"
          title="Kitchen sink"
          description="The shared visual language for artbin. Every example on this page uses the same components as the application."
          actions={
            <ButtonLink href={routes.folders.href()}>
              Back to folders
            </ButtonLink>
          }
        />
        <p mix={introStyle}>
          Use this page to compare states, test responsive behavior, and change
          the system in one place before updating product flows.
        </p>
        <nav aria-label="Kitchen sink sections" mix={indexStyle}>
          {sections.map(([id, label]) => (
            <a key={id} href={`#${id}`}>
              {label}
            </a>
          ))}
        </nav>

        <section id="foundations" mix={sectionStyle}>
          <SectionHeader
            title="Foundations"
            description="Typography and color tokens shared by every surface."
          />
          <div mix={exampleGridStyle}>
            <Panel>
              <Stack>
                <p mix={displayTypeStyle}>Display heading</p>
                <h1 mix={typeSampleStyle}>Page heading</h1>
                <h2 mix={typeSampleStyle}>Section heading</h2>
                <p mix={typeSampleStyle}>
                  Body copy uses the document serif for a compact
                  archive-catalog feel.
                </p>
                <p mix={[typeSampleStyle, monoStyle]}>
                  Monospace: tower/maps/tower.wad
                </p>
                <p mix={typeSampleStyle}>
                  <a href="#foundations">Inline link</a> and{" "}
                  <strong>strong text</strong>.
                </p>
              </Stack>
            </Panel>
            <div mix={swatchesStyle}>
              {Object.entries(theme.color).map(([name, value]) => (
                <div key={name} mix={swatchStyle}>
                  <div mix={swatchColorStyle} style={{ background: value }} />
                  <div mix={swatchLabelStyle}>
                    <code>{name}</code>
                    <br />
                    {value}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section id="actions" mix={sectionStyle}>
          <SectionHeader
            title="Actions"
            description="Buttons and links share the same variants, sizing, and disabled behavior."
          />
          <Panel>
            <Stack>
              <Inline>
                <Button>Default</Button>
                <Button variant="primary">Primary</Button>
                <Button variant="danger">Danger</Button>
                <Button disabled>Disabled</Button>
              </Inline>
              <Inline>
                <Button size="small">Small button</Button>
                <ButtonLink href="#actions" variant="primary" size="small">
                  Small link
                </ButtonLink>
                <ButtonLink href="#actions">Link as button</ButtonLink>
              </Inline>
              <Button block variant="primary">
                Full-width action
              </Button>
            </Stack>
          </Panel>
        </section>

        <section id="forms" mix={sectionStyle}>
          <SectionHeader
            title="Forms"
            description="Labels, help, validation, and controls use one field rhythm."
          />
          <Panel>
            <div mix={formGridStyle}>
              <FormField
                label="Collection name"
                htmlFor="sink-name"
                hint="Shown publicly on the folder page."
                required
              >
                <TextInput id="sink-name" placeholder="Tower maps" fullWidth />
              </FormField>
              <FormField label="Destination" htmlFor="sink-destination">
                <SelectInput id="sink-destination" fullWidth>
                  <option>Top level</option>
                  <option>Tower</option>
                  <option>Textures</option>
                </SelectInput>
              </FormField>
              <FormField
                label="Folder slug"
                htmlFor="sink-slug"
                error="Use lowercase letters, numbers, and hyphens."
              >
                <TextInput id="sink-slug" value="Tower Maps" fullWidth mono />
              </FormField>
              <FormField label="Read-only value" htmlFor="sink-readonly">
                <TextInput
                  id="sink-readonly"
                  value="Imported by admin"
                  fullWidth
                  readOnly
                />
              </FormField>
              <div mix={fullSpanStyle}>
                <FormField
                  label="Description"
                  htmlFor="sink-description"
                  hint="A short explanation of what belongs here."
                >
                  <TextArea
                    id="sink-description"
                    rows={4}
                    fullWidth
                    placeholder="Describe this collection"
                  />
                </FormField>
              </div>
              <CheckboxField checked>Include nested folders</CheckboxField>
              <CheckboxField disabled>Unavailable option</CheckboxField>
            </div>
          </Panel>
        </section>

        <section id="feedback" mix={sectionStyle}>
          <SectionHeader
            title="Feedback"
            description="Persistent messages, compact statuses, progress, and empty states."
          />
          <div mix={exampleGridStyle}>
            <Stack>
              <Alert tone="info" title="Import queued">
                The archive will appear when processing finishes.
              </Alert>
              <Alert tone="success" title="Upload complete">
                187 textures were added to Tower.
              </Alert>
              <Alert tone="warning" title="Needs review">
                Two filenames could not be classified.
              </Alert>
              <Alert tone="danger" title="Import failed">
                The remote archive could not be downloaded.
              </Alert>
            </Stack>
            <Panel>
              <Stack>
                <Inline>
                  <Badge>Pending</Badge>
                  <Badge tone="info">Queued</Badge>
                  <Badge tone="success">Complete</Badge>
                  <Badge tone="warning">Running</Badge>
                  <Badge tone="danger">Failed</Badge>
                </Inline>
                <ProgressBar
                  value={64}
                  label="Extracting archive"
                  detail="64%"
                />
                <EmptyState
                  title="No files found"
                  description="Try another search or upload the first asset."
                  action={<Button>Add files</Button>}
                />
              </Stack>
            </Panel>
          </div>
        </section>

        <section id="navigation" mix={sectionStyle}>
          <SectionHeader
            title="Navigation"
            description="Breadcrumbs and tabs provide path and collection context."
          />
          <Panel>
            <Stack>
              <Breadcrumbs
                items={[
                  { label: "Folders", href: routes.folders.href() },
                  { label: "Tower", href: "/folder/tower" },
                  { label: "tower.wad" },
                ]}
              />
              <Tabs
                label="Example tabs"
                activeId="textures"
                items={[
                  {
                    id: "folders",
                    href: "#navigation",
                    label: "Folders",
                    count: 4,
                  },
                  {
                    id: "textures",
                    href: "#navigation",
                    label: "Textures",
                    count: 187,
                  },
                  {
                    id: "models",
                    href: "#navigation",
                    label: "Models",
                    count: 2,
                  },
                  {
                    id: "sounds",
                    href: "#navigation",
                    label: "Sounds",
                    count: 12,
                  },
                ]}
              />
              <BrowseTabs
                baseUrl={routes.folders.href()}
                currentView="textures"
                counts={{
                  folders: 4,
                  textures: 187,
                  models: 2,
                  maps: 4,
                  sounds: 12,
                  all: 205,
                }}
              />
            </Stack>
          </Panel>
        </section>

        <section id="data" mix={sectionStyle}>
          <SectionHeader
            title="Data display"
            description="Summary values, metadata, tables, and disclosure."
          />
          <div mix={exampleGridStyle}>
            <Panel>
              <StatGrid>
                <Stat label="Files" value="1,284" />
                <Stat label="Folders" value="42" />
                <Stat label="Storage" value="326 MB" />
              </StatGrid>
            </Panel>
            <Panel>
              <DetailList>
                <Detail label="Kind">Texture</Detail>
                <Detail label="Type">
                  <code mix={codeStyle}>image/png</code>
                </Detail>
                <Detail label="Dimensions">128 × 128</Detail>
                <Detail label="Source">
                  <a
                    href="https://gamebanana.com/"
                    target="_blank"
                    rel="noopener noreferrer"
                  >
                    GameBanana
                  </a>
                </Detail>
              </DetailList>
            </Panel>
          </div>
          <div mix={fileListStyle}>
            <DataTable label="Example import jobs">
              <thead>
                <TableHeaderRow>
                  <TableHeaderCell>Job</TableHeaderCell>
                  <TableHeaderCell>Status</TableHeaderCell>
                  <TableHeaderCell>Progress</TableHeaderCell>
                </TableHeaderRow>
              </thead>
              <tbody>
                <TableRow>
                  <TableCell>GameBanana import</TableCell>
                  <TableCell>
                    <Badge tone="warning">Running</Badge>
                  </TableCell>
                  <TableCell>
                    <ProgressBar value={36} />
                  </TableCell>
                </TableRow>
                <TableRow>
                  <TableCell>Preview generation</TableCell>
                  <TableCell>
                    <Badge tone="success">Complete</Badge>
                  </TableCell>
                  <TableCell>187 files</TableCell>
                </TableRow>
              </tbody>
            </DataTable>
          </div>
          <div mix={fileListStyle}>
            <Disclosure summary="Advanced details">
              <p>
                Disclosure panels keep uncommon controls available without
                competing with the primary task.
              </p>
            </Disclosure>
          </div>
        </section>

        <section id="media" mix={sectionStyle}>
          <SectionHeader
            title="Media and files"
            description="The same media card and file collection components support folders, textures, maps, models, and documents."
          />
          <div mix={mediaGridStyle}>
            <MediaCard
              href="#media"
              imageSrc={pixelPreview}
              imageAlt="Abstract green and tan texture"
              title="industrial-wall.png"
              meta="128 × 128 · 22.3 KB"
            />
            <MediaCard
              href="#media"
              title="Tower"
              meta="196 files"
              placeholder="📁"
            />
            <MediaCard
              title="No preview available"
              meta="BSP map · 2.3 MB"
              placeholder="🗺️"
            />
          </div>
          <div mix={fileListStyle}>
            <FileCollection files={sampleFiles} />
          </div>
          <div mix={fileListStyle}>
            <SectionHeader
              title="Model viewer"
              description="Drag to orbit and scroll to zoom. The sample is an embedded glTF triangle, so this page has no data dependency."
            />
            <ModelViewer modelUrl={sampleModel} format="gltf" height={260} />
          </div>
          <div mix={fileListStyle}>
            <SearchBar
              action={routes.folders.href()}
              currentView="textures"
              currentQuery="metal"
              currentTag="industrial"
              tags={[
                { id: "industrial", name: "Industrial", slug: "industrial" },
                { id: "sci-fi", name: "Sci-fi", slug: "sci-fi" },
              ]}
            />
          </div>
        </section>

        <section id="overlays" mix={sectionStyle}>
          <SectionHeader
            title="Overlays and tools"
            description="Open the real upload dialog here to inspect its complete multi-step interface."
          />
          <div mix={previewFrameStyle}>
            <div mix={controlRowStyle}>
              <UploadControl isAdmin label="Open upload dialog" />
              <LuckyButton sourceLabel="all assets" />
            </div>
          </div>
        </section>
      </main>
    </Page>
  );
}
