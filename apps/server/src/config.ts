function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(
      `Missing required environment variable ${name}. Copy .env.example to .env and fill in your Azure AD app registration values.`
    );
  }
  return value;
}

export const config = {
  tenantId: required("TENANT_ID"),
  clientId: required("CLIENT_ID"),
  clientSecret: required("CLIENT_SECRET"),
  port: Number(process.env.PORT ?? 4000),
  cacheTtlSeconds: Number(process.env.CACHE_TTL_SECONDS ?? 300),
};
