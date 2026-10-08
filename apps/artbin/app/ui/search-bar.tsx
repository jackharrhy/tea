import { css, type Handle } from "remix/component";

import { Button, ButtonLink } from "./primitives.tsx";
import { inputStyle, visuallyHiddenStyle } from "./styles.ts";

const formStyle = css({
  alignItems: "center",
  display: "flex",
  flexWrap: "wrap",
  gap: "0.5rem",
  marginBottom: "1rem",
});
const searchGroupStyle = css({
  display: "flex",
  flex: "1",
  gap: "0.5rem",
  maxWidth: "400px",
  minWidth: "200px",
});
const fillStyle = css({ flex: "1" });
const tagSelectStyle = css({ minWidth: "120px" });

interface SearchBarProps {
  action: string;
  currentView: string;
  currentQuery: string;
  currentTag: string | null;
  tags: { id: string; name: string; slug: string }[];
}

export function SearchBar(handle: Handle<SearchBarProps>) {
  return () => {
    const { action, currentView, currentQuery, currentTag, tags } =
      handle.props;
    const clearHref = `${action}?view=${encodeURIComponent(currentView)}`;

    return (
      <form method="get" action={action} mix={formStyle}>
        <input type="hidden" name="view" value={currentView} />
        <div mix={searchGroupStyle}>
          <label mix={visuallyHiddenStyle} htmlFor="browse-search">
            Search {currentView}
          </label>
          <input
            id="browse-search"
            type="search"
            name="q"
            value={currentQuery}
            placeholder={`Search ${currentView}`}
            mix={[inputStyle, fillStyle]}
          />
          <Button type="submit">Search</Button>
        </div>
        {tags.length > 0 ? (
          <>
            <label mix={visuallyHiddenStyle} htmlFor="browse-tag">
              Filter by tag
            </label>
            <select
              id="browse-tag"
              name="tag"
              mix={[inputStyle, tagSelectStyle]}
            >
              <option value="" selected={!currentTag}>
                All tags
              </option>
              {tags.map((tag) => (
                <option
                  key={tag.id}
                  value={tag.slug}
                  selected={currentTag === tag.slug}
                >
                  {tag.name}
                </option>
              ))}
            </select>
            <Button type="submit" size="small">
              Apply
            </Button>
          </>
        ) : null}
        {currentQuery || currentTag ? (
          <ButtonLink href={clearHref} size="small">
            Clear filters
          </ButtonLink>
        ) : null}
      </form>
    );
  };
}
