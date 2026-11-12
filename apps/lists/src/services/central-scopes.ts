import { roleScope } from "@harrhy/identity";

import { API_SCOPES, type ApiScope } from "./access";

export const OPERATION_ROLES: Record<ApiScope, string> = {
  "lists:read": "lists-read",
  "subscribers:read": "subscribers-read",
  "subscribers:write": "subscribers-write",
  "campaigns:read": "campaigns-read",
  "campaigns:write": "campaigns-write",
  "campaigns:send": "campaigns-send",
  "templates:read": "templates-read",
  "templates:write": "templates-write",
  "deliverability:read": "deliverability-read",
  "dmarc:read": "dmarc-read",
};

export const OPERATION_SCOPES = API_SCOPES.map((scope) =>
  roleScope(OPERATION_ROLES[scope]),
);
