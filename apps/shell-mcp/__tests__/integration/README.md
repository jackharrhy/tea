# OAuth integration fixture

`oauth-http.test.ts` starts the 4orm shell fixture in a separate process and tests the Remix MCP with the official MCP SDK. It covers discovery, registration, PKCE, tokens, refresh, revocation, and owner denial. The shell uses `MockRunner`; this does not exercise production execution or a hosted client.

Set `FOURORM_TEST_REPO` to an absolute path to a compatible 4orm checkout with `tests.shell_http_fixture`. Install that checkout's locked Python development dependencies, then run `npm run test:oauth --workspace @tea/shell-mcp` from Tea. The test routes the public fixture URLs to local HTTP sockets and rejects other destinations.
