import assert from "node:assert/strict";
import { request } from "node:https";

// Exercise the runtime's real TLS verifier, not a mocked fetch or curl.
const certificateErrors = new Set([
  "CERT_REVOKED",
  "CERT_SIGNATURE_FAILURE",
  "CERT_UNTRUSTED",
  "SELF_SIGNED_CERT_IN_CHAIN",
  "UNABLE_TO_GET_ISSUER_CERT",
  "UNABLE_TO_GET_ISSUER_CERT_LOCALLY",
  "UNABLE_TO_VERIFY_LEAF_SIGNATURE",
]);

function probe(url) {
  return new Promise((resolve, reject) => {
    const req = request(url, { method: "HEAD", timeout: 15000 }, (response) => {
      response.resume();
      resolve(response.statusCode);
    });
    req.on("timeout", () => req.destroy(new Error("TLS probe timed out")));
    req.on("error", reject);
    req.end();
  });
}

console.log(
  JSON.stringify({
    node: process.version,
    openssl: process.versions.openssl,
    flags: process.execArgv,
  }),
);
for (const url of [
  "https://dv-g3b-emudhra.we-have-a-problem.com/",
  "https://dv-g3b-aaa-emudhra.we-have-a-problem.com/",
]) {
  await assert.rejects(probe(url), (error) => {
    assert.ok(
      certificateErrors.has(error.code),
      `Expected certificate trust failure for ${url}, got ${error.code}: ${error.message}`,
    );
    console.log(JSON.stringify({ url, rejected: true, code: error.code, message: error.message }));
    return true;
  });
}
const url = "https://example.com/";
const status = await probe(url);
assert.ok(status >= 200 && status < 400, `Normal HTTPS failed: ${status}`);
console.log(JSON.stringify({ url, trusted: true, status }));
