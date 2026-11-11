use rune::Icon;
pub(super) static SCRUB: Icon = Icon {
    name: "img-scrub",
    view: 16.,
    body: r#"<path d="M2 8H14M5 5L2 8L5 11M11 5L14 8L11 11" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
pub(super) static GRIP: Icon = Icon {
    name: "img-grip",
    view: 16.,
    body: r#"<g fill="currentColor"><circle cx="5" cy="4" r="1"/><circle cx="11" cy="4" r="1"/><circle cx="5" cy="8" r="1"/><circle cx="11" cy="8" r="1"/><circle cx="5" cy="12" r="1"/><circle cx="11" cy="12" r="1"/></g>"#,
};
pub(super) static EYE: Icon = Icon {
    name: "img-eye",
    view: 16.,
    body: r#"<path d="M1 8Q8-1 15 8Q8 17 1 8Z" fill="none" stroke="currentColor" stroke-width="1.25"/><circle cx="8" cy="8" r="2" fill="none" stroke="currentColor" stroke-width="1.25"/>"#,
};
pub(super) static CLOSED_EYE: Icon = Icon {
    name: "img-eye-closed",
    view: 16.,
    body: r#"<path d="M1 5Q8 14 15 5M3 8L1 11M8 10V13M13 8L15 11" fill="none" stroke="currentColor" stroke-width="1.25"/>"#,
};
pub(super) static UP: Icon = Icon {
    name: "img-up",
    view: 16.,
    body: r#"<path d="M8 13V3M4 7L8 3L12 7" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
pub(super) static DOWN: Icon = Icon {
    name: "img-down",
    view: 16.,
    body: r#"<path d="M8 3V13M4 9L8 13L12 9" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
pub(super) static DELETE: Icon = Icon {
    name: "img-delete",
    view: 16.,
    body: r#"<path d="M2 4H14M6 2H10M4 6L5 14H11L12 6M6.5 7V12M9.5 7V12" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
pub(super) static PREVIOUS: Icon = Icon {
    name: "img-previous",
    view: 16.,
    body: r#"<path d="M10 3L5 8L10 13" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
pub(super) static NEXT: Icon = Icon {
    name: "img-next",
    view: 16.,
    body: r#"<path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};

pub(super) static FOLDER: Icon = Icon {
    name: "img-folder",
    view: 16.,
    body: r#"<path d="M2 4H6L7.5 6H14V13H2Z" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linejoin="round"/>"#,
};

pub(super) static EYEDROPPER: Icon = Icon {
    name: "img-eyedropper",
    view: 16.,
    body: r#"<path d="M10 2L14 6M9 5L11 3C12 2 14 4 13 5L11 7M9 5L11 7L5 13L2 14L3 11ZM8 4L12 8" fill="none" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>"#,
};

pub(super) static CHEVRON: Icon = Icon {
    name: "img-chevron",
    view: 16.,
    body: r#"<path d="M6 3L11 8L6 13" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
pub(super) static PREVIEW: Icon = Icon {
    name: "img-preview",
    view: 16.,
    body: r#"<rect x="2" y="2.5" width="12" height="9" rx="1" stroke="currentColor" stroke-width="1.25" fill="none"/><path d="M5 14H11M8 11.5V14" stroke="currentColor" stroke-width="1.25" fill="none"/>"#,
};
pub(super) static COLLAPSE: Icon = Icon {
    name: "img-collapse",
    view: 16.,
    body: r#"<path d="M3 2H13M3 14H13M5 6L8 3L11 6M5 10L8 13L11 10" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};

pub(super) static UNDO: Icon = Icon {
    name: "img-undo",
    view: 16.,
    body: r#"<path d="M5 3L2 6L5 9M2 6H9A4 4 0 0 1 9 14" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
pub(super) static REDO: Icon = Icon {
    name: "img-redo",
    view: 16.,
    body: r#"<path d="M11 3L14 6L11 9M14 6H7A4 4 0 0 0 7 14" stroke="currentColor" stroke-width="1.25" fill="none" stroke-linecap="round" stroke-linejoin="round"/>"#,
};
