import { sqliteTable, text, integer, index } from "drizzle-orm/sqlite-core";

export const users = sqliteTable("users", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").unique().notNull(),
  name: text("name"),
  authSubject: text("auth_subject").unique(),
  passwordHash: text("password_hash").notNull(),
  role: text("role", { enum: ["owner", "admin", "member"] })
    .notNull()
    .default("member"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const sessions = sqliteTable(
  "sessions",
  {
    tokenHash: text("token_hash").primaryKey(),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    expiresAt: text("expires_at").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("sessions_user_idx").on(table.userId),
    index("sessions_expiry_idx").on(table.expiresAt),
  ],
);

export const subscribers = sqliteTable("subscribers", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  email: text("email").unique().notNull(),
  firstName: text("first_name"),
  lastName: text("last_name"),
  status: text("status", {
    enum: ["active", "blocklisted"],
  })
    .notNull()
    .default("active"),
  unsubscribeToken: text("unsubscribe_token").unique().notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const lists = sqliteTable("lists", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").unique().notNull(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  fromDomain: text("from_domain").notNull().default("jackharrhy.dev"),
  fromAddress: text("from_address").notNull().default(""),
});

export const userLists = sqliteTable("user_lists", {
  userId: integer("user_id")
    .notNull()
    .references(() => users.id),
  listId: integer("list_id")
    .notNull()
    .references(() => lists.id),
});

export const apiTokens = sqliteTable(
  "api_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    tokenHash: text("token_hash").notNull().unique(),
    tokenPrefix: text("token_prefix").notNull(),
    scopes: text("scopes").notNull(),
    audience: text("audience"),
    expiresAt: text("expires_at"),
    lastUsedAt: text("last_used_at"),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("api_tokens_user_idx").on(table.userId),
    index("api_tokens_hash_idx").on(table.tokenHash),
  ],
);

export const oauthClients = sqliteTable("oauth_clients", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  clientId: text("client_id").notNull().unique(),
  clientName: text("client_name").notNull(),
  redirectUris: text("redirect_uris").notNull(),
  scopes: text("scopes")
    .notNull()
    .default(
      '["lists:read","subscribers:read","subscribers:write","campaigns:read","campaigns:write","campaigns:send","templates:read","templates:write","deliverability:read","dmarc:read"]',
    ),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const oauthAuthorizationCodes = sqliteTable(
  "oauth_authorization_codes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    codeHash: text("code_hash").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    redirectUri: text("redirect_uri").notNull(),
    scopes: text("scopes").notNull(),
    audience: text("audience"),
    codeChallenge: text("code_challenge").notNull(),
    expiresAt: text("expires_at").notNull(),
    usedAt: text("used_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("oauth_codes_hash_idx").on(table.codeHash)],
);

export const oauthRefreshTokens = sqliteTable(
  "oauth_refresh_tokens",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    tokenHash: text("token_hash").notNull().unique(),
    clientId: text("client_id")
      .notNull()
      .references(() => oauthClients.clientId, { onDelete: "cascade" }),
    userId: integer("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    scopes: text("scopes").notNull(),
    audience: text("audience"),
    expiresAt: text("expires_at").notNull(),
    revokedAt: text("revoked_at"),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [index("oauth_refresh_hash_idx").on(table.tokenHash)],
);

export const subscriberLists = sqliteTable("subscriber_lists", {
  subscriberId: integer("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  listId: integer("list_id")
    .notNull()
    .references(() => lists.id),
  status: text("status", {
    enum: ["unconfirmed", "confirmed", "unsubscribed"],
  })
    .notNull()
    .default("unconfirmed"),
  subscribedAt: text("subscribed_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const tags = sqliteTable("tags", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  name: text("name").unique().notNull(),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const subscriberTags = sqliteTable("subscriber_tags", {
  subscriberId: integer("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  tagId: integer("tag_id")
    .notNull()
    .references(() => tags.id),
});

export const emailTemplates = sqliteTable("email_templates", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  slug: text("slug").notNull().unique(),
  name: text("name").notNull(),
  description: text("description"),
  status: text("status", { enum: ["draft", "active", "archived"] })
    .notNull()
    .default("draft"),
  builtIn: integer("built_in", { mode: "boolean" }).notNull().default(false),
  sourceFormat: text("source_format", {
    enum: ["html", "mjml", "text"],
  }).notNull(),
  subjectSource: text("subject_source"),
  htmlSource: text("html_source"),
  textSource: text("text_source").notNull(),
  compiledHtml: text("compiled_html"),
  sections: text("sections").notNull().default("[]"),
  partials: text("partials").notNull().default("{}"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const campaigns = sqliteTable("campaigns", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  subject: text("subject").notNull(),
  bodyMarkdown: text("body_markdown").notNull(),
  templateSlug: text("template_slug").notNull().default("newsletter"),
  templateSections: text("template_sections").notNull().default("{}"),
  fromAddress: text("from_address").notNull(),
  fromName: text("from_name"),
  audienceType: text("audience_type", {
    enum: ["list", "tag", "all", "subscribers"],
  }).notNull(),
  audienceId: integer("audience_id"),
  audienceData: text("audience_data"),
  status: text("status", {
    enum: ["draft", "scheduled", "sending", "sent", "failed"],
  })
    .notNull()
    .default("draft"),
  scheduledAt: text("scheduled_at"),
  batchSize: integer("batch_size"),
  batchInterval: integer("batch_interval"),
  lastError: text("last_error"),
  sentAt: text("sent_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const campaignSends = sqliteTable("campaign_sends", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  campaignId: integer("campaign_id")
    .notNull()
    .references(() => campaigns.id),
  subscriberId: integer("subscriber_id")
    .notNull()
    .references(() => subscribers.id),
  idempotencyKey: text("idempotency_key").unique(),
  sesMessageId: text("ses_message_id"),
  rfc822MessageId: text("rfc822_message_id"),
  status: text("status", {
    enum: [
      "pending",
      "attempting",
      "accepted",
      "delivered",
      "delivery_delayed",
      "deferred",
      "rejected",
      "failed",
      "bounced",
      "complained",
      "sent",
    ],
  })
    .notNull()
    .default("pending"),
  sentAt: text("sent_at"),
  attemptCount: integer("attempt_count").notNull().default(0),
  nextAttemptAt: text("next_attempt_at"),
  lastAttemptAt: text("last_attempt_at"),
  acceptedAt: text("accepted_at"),
  deliveredAt: text("delivered_at"),
  lastError: text("last_error"),
  diagnosticCode: text("diagnostic_code"),
  bounceType: text("bounce_type"),
  complaintType: text("complaint_type"),
  updatedAt: text("updated_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const deliveryEvents = sqliteTable("delivery_events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  providerEventId: text("provider_event_id").notNull().unique(),
  sesMessageId: text("ses_message_id"),
  eventType: text("event_type").notNull(),
  payload: text("payload").notNull(),
  receivedAt: text("received_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const dmarcReports = sqliteTable(
  "dmarc_reports",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reportKey: text("report_key").notNull().unique(),
    reporterOrg: text("reporter_org").notNull(),
    reporterEmail: text("reporter_email"),
    externalReportId: text("external_report_id").notNull(),
    domain: text("domain").notNull(),
    dateBegin: text("date_begin").notNull(),
    dateEnd: text("date_end").notNull(),
    policy: text("policy").notNull(),
    subdomainPolicy: text("subdomain_policy"),
    nonexistentSubdomainPolicy: text("nonexistent_subdomain_policy"),
    adkim: text("adkim").notNull().default("r"),
    aspf: text("aspf").notNull().default("r"),
    testing: text("testing"),
    discoveryMethod: text("discovery_method"),
    messageCount: integer("message_count").notNull(),
    createdAt: text("created_at")
      .notNull()
      .$defaultFn(() => new Date().toISOString()),
  },
  (table) => [
    index("dmarc_reports_domain_range_idx").on(
      table.domain,
      table.dateBegin,
      table.dateEnd,
    ),
  ],
);

export const dmarcReportRecords = sqliteTable(
  "dmarc_report_records",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    reportId: integer("report_id")
      .notNull()
      .references(() => dmarcReports.id, { onDelete: "cascade" }),
    sourceIp: text("source_ip").notNull(),
    count: integer("count").notNull(),
    disposition: text("disposition").notNull(),
    dkimResult: text("dkim_result").notNull(),
    spfResult: text("spf_result").notNull(),
    dmarcPass: integer("dmarc_pass", { mode: "boolean" }).notNull(),
    headerFrom: text("header_from").notNull(),
    envelopeFrom: text("envelope_from"),
    envelopeTo: text("envelope_to"),
    overrideReasons: text("override_reasons").notNull().default("[]"),
    authResults: text("auth_results").notNull().default("{}"),
  },
  (table) => [
    index("dmarc_records_report_idx").on(table.reportId),
    index("dmarc_records_source_idx").on(table.sourceIp),
  ],
);

export const dmarcIngestions = sqliteTable(
  "dmarc_ingestions",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sesMessageId: text("ses_message_id").notNull().unique(),
    rawS3Key: text("raw_s3_key").notNull(),
    status: text("status", { enum: ["processing", "parsed", "rejected"] })
      .notNull()
      .default("processing"),
    error: text("error"),
    reportId: integer("report_id").references(() => dmarcReports.id, {
      onDelete: "set null",
    }),
    receivedAt: text("received_at").notNull(),
    processedAt: text("processed_at"),
  },
  (table) => [index("dmarc_ingestions_status_idx").on(table.status)],
);

export const messages = sqliteTable("messages", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  threadId: integer("thread_id").notNull(),
  parentId: integer("parent_id"),
  direction: text("direction", { enum: ["inbound", "outbound"] }).notNull(),
  rfc822MessageId: text("rfc822_message_id"),
  inReplyTo: text("in_reply_to"),
  fromAddr: text("from_addr").notNull(),
  toAddr: text("to_addr").notNull(),
  subject: text("subject").notNull(),
  bodyText: text("body_text"),
  bodyHtml: text("body_html"),
  sesMessageId: text("ses_message_id").unique(),
  s3Key: text("s3_key"),
  spamVerdict: text("spam_verdict"),
  virusVerdict: text("virus_verdict"),
  spfVerdict: text("spf_verdict"),
  dkimVerdict: text("dkim_verdict"),
  dmarcVerdict: text("dmarc_verdict"),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  readAt: text("read_at"),
  sentAt: text("sent_at"),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});

export const events = sqliteTable("events", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  type: text("type").notNull(),
  detail: text("detail").notNull().default(""),
  meta: text("meta"),
  userId: integer("user_id").references(() => users.id),
  subscriberId: integer("subscriber_id").references(() => subscribers.id),
  campaignId: integer("campaign_id").references(() => campaigns.id),
  messageId: integer("message_id").references(() => messages.id),
  createdAt: text("created_at")
    .notNull()
    .$defaultFn(() => new Date().toISOString()),
});
