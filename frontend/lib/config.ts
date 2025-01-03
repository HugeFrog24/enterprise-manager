export const config = {
  api: {
    baseUrl: process.env.NEXT_PUBLIC_API_BASE_URL ?? 'http://localhost:3000',
  },
} as const;

export type Config = typeof config;
