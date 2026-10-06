import { css, unsafeHTML, type Handle, type RemixNode } from "remix/component";
import type { PublicPageProps } from "../site.ts";
import { pageMetadata, structuredData } from "../actions/public-seo.ts";
import { Document } from "./document.tsx";
import { FeatureAssets } from "./feature-assets.tsx";
import { adornmentStyles } from "./adornment-styles.ts";
import { risoStyles } from "./riso-styles.ts";

export function PublicDocument(
  handle: Handle<
    PublicPageProps & {
      children: RemixNode;
      styles: ReturnType<typeof css>;
    }
  >,
) {
  return () => {
    const {
      page,
      store,
      path,
      features,
      preview: staticPreview,
      previewSite,
      visualEditing,
      editorSession,
    } = handle.props;
    const site = store.site();
    const preview = staticPreview || previewSite || visualEditing;
    const metadata = pageMetadata(page, site, path);
    const { title, canonical, description, image } = metadata;
    const analyticsId =
      page && !preview && site.analytics_enabled
        ? site.analytics_id.match(/^G-[A-Z0-9]+$/)?.[0]
        : undefined;
    return (
      <Document
        title={page ? title : "Page not found | " + site.site_name}
        background={site.background_color}
        static={staticPreview}
        publicScript="/site.js"
        visualEditing={visualEditing}
        editorSession={editorSession}
        visualSlug={page?.slug ?? ""}
        styles={[
          handle.props.styles,
          ...(features.adornments ? [adornmentStyles] : []),
          ...(features.riso ? [risoStyles] : []),
        ]}
        head={
          <>
            <FeatureAssets features={features} preview={staticPreview} />
            {page && !preview && !page.seo.no_index && (
              <script
                type="application/ld+json"
                innerHTML={unsafeHTML(structuredData(metadata, site))}
              ></script>
            )}
            {analyticsId && (
              <>
                <script
                  async
                  src={`https://www.googletagmanager.com/gtag/js?id=${analyticsId}`}
                ></script>
                <script
                  innerHTML={unsafeHTML(`window.dataLayer = window.dataLayer || [];
function gtag(){dataLayer.push(arguments);}
gtag('js', new Date());
gtag('config', ${JSON.stringify(analyticsId)});`)}
                ></script>
              </>
            )}
            <link rel="canonical" href={canonical} />
            <meta name="description" content={description} />
            {(preview || page?.seo.no_index || !page) && (
              <meta name="robots" content="noindex, nofollow" />
            )}
            <meta property="og:site_name" content={site.site_name} />
            <meta property="og:type" content="website" />
            <meta property="og:title" content={title} />
            <meta property="og:url" content={canonical} />
            <meta property="og:description" content={description} />
            {image && <meta property="og:image" content={image} />}
            <meta
              name="twitter:card"
              content={image ? "summary_large_image" : "summary"}
            />
            <meta name="twitter:title" content={title} />
            <meta name="twitter:description" content={description} />
            {image && <meta name="twitter:image" content={image} />}
          </>
        }
      >
        {handle.props.children}
      </Document>
    );
  };
}
