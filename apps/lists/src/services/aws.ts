import type { Config } from "../config";

/** Shared AWS client options. Local emulators need an explicit endpoint and path-style S3 URLs. */
export function awsClientConfig(config: Config) {
  return {
    region: config.awsRegion,
    ...(config.awsEndpointUrl ? { endpoint: config.awsEndpointUrl } : {}),
  };
}

export function s3ClientConfig(config: Config) {
  return {
    ...awsClientConfig(config),
    ...(config.awsEndpointUrl ? { forcePathStyle: true } : {}),
  };
}
