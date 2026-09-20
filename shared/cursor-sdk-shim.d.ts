/** Optional peer — present when @cursor/sdk is installed (Node >= 22.13). */
declare module "@cursor/sdk" {
  export const Cursor: {
    models: {
      list: (options?: { apiKey?: string }) => Promise<
        Array<{
          id: string;
          displayName?: string;
          parameters?: Array<{
            id: string;
            values: Array<{ value: string; displayName?: string }>;
          }>;
        }>
      >;
    };
  };
  export const Agent: {
    create: (options: Record<string, unknown>) => Promise<{
      agentId: string;
      send: (
        message: string,
        options?: Record<string, unknown>,
      ) => Promise<{
        wait: () => Promise<{
          status: string;
          result?: string;
          error?: { message: string };
          durationMs?: number;
          usage?: { inputTokens: number; outputTokens: number; totalTokens: number };
          requestId?: string;
          model?: unknown;
        }>;
      }>;
      getUsage?: () => Promise<{ cost?: { chargedCents: number } }>;
      close?: () => void;
      [Symbol.asyncDispose]?: () => Promise<void>;
    }>;
  };
}
