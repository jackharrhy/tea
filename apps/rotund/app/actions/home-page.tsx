import { css, type Handle } from "remix/component";
import { Document } from "./document.js";
import { routes } from "../routes.js";
import type { Service } from "../services.js";

const page = css({
  width: "calc(100% - 32px)",
  maxWidth: "360px",
  margin: "28px auto 32px",
  textAlign: "center",
});
const face = css({
  display: "block",
  width: "120px",
  maxWidth: "100%",
  height: "auto",
  margin: "0 auto 24px",
});
const list = css({
  display: "grid",
  gap: "8px",
  listStyle: "none",
  padding: 0,
  margin: 0,
});
const button = css({
  display: "flex",
  alignItems: "center",
  justifyContent: "center",
  width: "100%",
  minHeight: "44px",
  padding: "10px 16px",
  font: "inherit",
  lineHeight: 1.5,
  color: "#171717",
  background: "#fafafa",
  border: "1px solid #aaa",
  borderRadius: "4px",
  cursor: "pointer",
  "&:hover": { background: "#eee", borderColor: "#777" },
  "&:active": { background: "#e5e5e5" },
});
const serviceButton = css({
  justifyContent: "flex-start",
  gap: "12px",
  minHeight: "62px",
  padding: "12px 16px",
  textAlign: "left",
  borderColor: "transparent",
  "&[data-service='jellyfin']": { background: "#e9e3f7" },
  "&[data-service='seerr']": { background: "#e1e9fc" },
  "&[data-service='navidrome']": { background: "#dceff6" },
  "&[data-service='sonarr']": { background: "#e3f1f9" },
  "&[data-service='radarr']": { background: "#faf0cc" },
  "&[data-service='prowlarr']": { background: "#fbe8de" },
  "&[data-service='cleanuparr']": { background: "#e4f2e5" },
  "&[data-service='qbittorrent']": { background: "#e2edf9" },
  "&[data-service='slskd']": { background: "#eee8f7" },
  "&:hover": { filter: "brightness(.96)", borderColor: "#777" },
  "&:active": { filter: "brightness(.91)" },
  "@media (max-width: 359px)": {
    fontSize: "14px",
    padding: "12px",
    gap: "8px",
  },
});
const logo = css({ flexShrink: 0, objectFit: "contain" });
const purpose = css({
  marginLeft: "auto",
  textAlign: "right",
  opacity: 0.72,
  fontSize: "14px",
  "@media (max-width: 359px)": { fontSize: "12px" },
});
const managementSection = css({
  borderTop: "1px solid #ddd",
  marginTop: "24px",
  paddingTop: "16px",
});
const managementTitle = css({
  fontSize: "14px",
  fontWeight: 400,
  color: "#555",
  margin: "0 0 12px",
});
const managementList = css({
  gridTemplateColumns: "repeat(2, minmax(0, 1fr))",
});
const managementButton = css({
  fontSize: "14px",
  gap: "8px",
  minHeight: "48px",
  padding: "10px",
  "& img": { width: "24px", height: "24px" },
  "@media (max-width: 359px)": {
    padding: "9px 7px",
    gap: "6px",
    "& img": { width: "22px", height: "22px" },
  },
});
const logout = css({
  minHeight: "44px",
  marginTop: "12px",
  padding: "8px 12px",
  font: "inherit",
  fontSize: "14px",
  color: "#555",
  background: "transparent",
  border: 0,
  cursor: "pointer",
  textDecoration: "underline",
  textUnderlineOffset: "3px",
});
const primaryPurposes = {
  jellyfin: "- Watch Videos",
  seerr: "- Request Content",
  navidrome: "- Listen to Music",
};
const logoIds = new Set([
  ...Object.keys(primaryPurposes),
  "sonarr",
  "radarr",
  "prowlarr",
  "cleanuparr",
  "qbittorrent",
  "slskd",
]);
function isPrimary(item: Service): item is Service & {
  id: keyof typeof primaryPurposes;
} {
  return Object.hasOwn(primaryPurposes, item.id);
}
function serviceLink(item: Service, management = false) {
  return (
    <li key={item.id}>
      <a
        mix={[button, serviceButton, ...(management ? [managementButton] : [])]}
        data-service={item.id}
        href={item.url}
      >
        {logoIds.has(item.id) ? (
          <img
            mix={logo}
            src={`/services/${item.id}.svg`}
            width="32"
            height="32"
            alt=""
          />
        ) : null}
        <span>{item.name}</span>
        {isPrimary(item) ? (
          <span mix={purpose}>{primaryPurposes[item.id]}</span>
        ) : null}
      </a>
    </li>
  );
}

export type HomePageProps = {
  csrf: string;
  signedIn: boolean;
  items: Service[];
  error?: string;
  unavailable?: boolean;
};
export function HomePage(handle: Handle<HomePageProps>) {
  return () => {
    const input = handle.props;
    const primary = input.items
      .filter(isPrimary)
      .toSorted(
        (a, b) =>
          Object.keys(primaryPurposes).indexOf(a.id) -
          Object.keys(primaryPurposes).indexOf(b.id),
      );
    const management = input.items.filter((item) => !isPrimary(item));
    return (
      <Document>
        <main mix={page} aria-label="rotund.org">
          <img
            mix={face}
            src="/rotund.png"
            width="400"
            height="600"
            alt="The rotund face"
          />
          {input.unavailable ? (
            <div role="alert">
              <p>Access check failed.</p>
              <a mix={button} href={routes.home.href()}>
                Retry
              </a>
            </div>
          ) : input.signedIn ? (
            <>
              {primary.length ? (
                <nav aria-label="Services">
                  <ul mix={list}>{primary.map((item) => serviceLink(item))}</ul>
                </nav>
              ) : null}
              {management.length ? (
                <section
                  mix={managementSection}
                  aria-labelledby="management-title"
                >
                  <h2 mix={managementTitle} id="management-title">
                    Management:
                  </h2>
                  <nav aria-label="Management services">
                    <ul mix={[list, managementList]}>
                      {management.map((item) => serviceLink(item, true))}
                    </ul>
                  </nav>
                </section>
              ) : null}
              {!input.items.length ? <p>No services assigned.</p> : null}
            </>
          ) : (
            <>
              {input.error ? <p role="alert">{input.error}</p> : null}
              <form action={routes.auth.login.href()} method="post">
                <input type="hidden" name="csrf" value={input.csrf} />
                <button mix={button} type="submit">
                  Sign in
                </button>
              </form>
            </>
          )}
          {input.signedIn ? (
            <form action={routes.auth.logout.href()} method="post">
              <input type="hidden" name="csrf" value={input.csrf} />
              <button mix={logout} type="submit">
                Sign out
              </button>
            </form>
          ) : null}
        </main>
      </Document>
    );
  };
}
