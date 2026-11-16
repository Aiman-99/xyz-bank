const isProduction = process.env.NODE_ENV === 'production';

function jwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret) return secret;
  if (isProduction) throw new Error('JWT_SECRET must be set in production');
  return 'dev-only-secret-do-not-use-in-production';
}

export const config = {
  isProduction,
  /** True when running as a Vercel Function (Vercel sets VERCEL=1). */
  isVercel: Boolean(process.env.VERCEL),
  port: Number(process.env.PORT ?? 3000),
  /**
   * Postgres connection string. When unset, an embedded Postgres (PGlite) is used for local dev.
   * POSTGRES_URL is accepted too, as some hosted-database integrations use that name.
   */
  databaseUrl: process.env.DATABASE_URL || process.env.POSTGRES_URL || undefined,
  /** Where the embedded dev database keeps its files. */
  pgliteDir: process.env.PGLITE_DIR ?? '.data/pglite',
  jwtSecret: jwtSecret(),
  tokenTtlSeconds: 8 * 60 * 60,
} as const;
