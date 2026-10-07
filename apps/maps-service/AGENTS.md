# Maps hosted-service workspace

Read this README and the Tea root guidance before editing. Remix owns route selection and all handlers use Web Requests and Responses; Node remains at the listener and local persistence boundary. Preserve API, auth, resource, and persistence behavior. Keep database and blob storage inside this app; packages may not import app code. Keep tests in `__tests__/` and run this workspace's check plus protocol and editor checks after contract changes. Do not use original Worldview data or secrets.
