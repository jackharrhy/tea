import { identityFetch } from "./identity-fixture.ts";
const realFetch = globalThis.fetch;
const fakeIdentity = identityFetch();
globalThis.fetch = (input, options) =>
  String(input).startsWith("https://auth.test/")
    ? fakeIdentity(input, options)
    : realFetch(input, options);
