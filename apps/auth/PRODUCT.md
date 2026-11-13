# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

People opening their applications and managing their own identity. Auth administrators manage people, groups and service eligibility in the same shell. Service administrators receive explicit service roles, never automatic authority from being an Auth administrator.

## Product Purpose

`auth` is the general signed-in application directory and access-management product. Rotund remains a media-specific directory. App-initiated authentication returns to that application; direct authentication opens Your apps.

## Operating Context

Currently a small self-hosted organization with dozens of people, multiple central OIDC consumers, native media accounts, machine integrations and held/retired services. Ordinary users should not need to understand OAuth or project identifiers. Administrators need to understand why access exists and which external cleanup remains.

## Capabilities and Constraints

- Keep people, immutable subjects, local IDs and content ownership. Internal roles/APIs may be reorganized with explicit migration and comparison.
- Editable flat additive access groups and direct service assignments, each with provenance. A service block overrides memberships. Account suspension is distinct from content deletion.
- Explicit Auth administrator membership, with last-administrator protection and operator recovery. Administrators may explicitly assign themselves service access, with a reason/activity record.
- Show usable apps first and joinable apps separately; hide unrelated private services. Launch directly; access detail is optional.
- Manual/unsupported native setup and delayed cleanup must be displayed honestly. Do not widen Navidrome's fixed native admin mapping or claim directory visibility provisions Jellyfin/Seerr.
- Retired services stay retired; CMS holds stay held. Maps is now Worldview; retain its existing Auth identity and new canonical origin contract.
- Downtime is acceptable for the redesign. Preserve consistent recovery and prove identity/access migration, rather than preserving obsolete internal APIs.
- Prefer supported issuer functionality. Preview ZITADEL is eligible if current protocol/migration requirements are proven; pre-release status alone is not a rejection.

## Brand Commitments

The product is called `auth`, not Jack Auth. Compact conventional sign-in form, with a playful CSS-generated background. One shared shell; administrators see richer navigation and controls.

## Evidence on Hand

Jack's exported questionnaire and Astra plan are retained in /home/jack/.local/state/auth-self-review. Sanitized runtime inventory and provider origin migration receipts are outside source. No private identities, credentials or production content belong in screenshots or committed fixtures.

## Product Principles

- Explain effective access and its source.
- Separate central eligibility, issued access, and native readiness.
- Name consequences before applying changes; retain incomplete cleanup visibly.
- Keep everyday app entry fast.
- Replace superseded paths rather than maintaining two access managers.
