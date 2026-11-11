import { get, post, route } from "remix/routes";

export const routes = route({
  assets: get("/assets/*path"),
  home: get("/"),
  write: get("/write"),
  issue: get("/letters/:issueId"),
  createLetter: post("/letters"),
  auth: route("auth", {
    login: get("/login"),
    callback: get("/callback"),
    logout: post("/logout"),
  }),
  uploads: route("uploads", {
    create: post("/"),
    show: get("/:attachmentId"),
  }),
  steve: route("steve", {
    index: get("/"),
    updateSite: post("/site"),
    createIssue: post("/issues"),
    updateIssue: post("/issues/:issueId"),
    updateLetter: post("/letters/:letterId"),
  }),
});
