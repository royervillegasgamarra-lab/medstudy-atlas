import {
  APICallError,
  TypeValidationError,
  JSONParseError,
  NoObjectGeneratedError,
  AISDKError,
} from "ai";
import type { AIErrorCode } from "./types";

export interface ClassifiedAIError {
  code: AIErrorCode;
  retryable: boolean;
  message: string;
}

const NETWORK_ERROR_CODES = new Set([
  "ECONNRESET",
  "ECONNREFUSED",
  "ENOTFOUND",
  "EAI_AGAIN",
  "EPIPE",
  "ETIMEDOUT",
  "ESOCKETTIMEDOUT",
  "EHOSTUNREACH",
  "ENETUNREACH",
  "UND_ERR_CONNECT_TIMEOUT",
  "UND_ERR_SOCKET",
  "UND_ERR_HEADERS_TIMEOUT",
]);

const NETWORK_ERROR_PHRASES = [
  "fetch failed",
  "econnreset",
  "econnrefused",
  "enotfound",
  "eai_again",
  "dns",
  "getaddrinfo",
  "socket hang up",
  "socket closed",
  "closed socket",
  "network error",
  "connection reset",
  "connection refused",
  "network failure",
  "service unavailable",
  "bad gateway",
  "gateway timeout",
  "terminated",
  "premature close",
];

/**
 * Classifies an unknown error from AI SDK or HTTP/network transport into an AIErrorCode.
 * Classifies network, DNS, socket, and 5xx errors as AI_PROVIDER_UNAVAILABLE (retryable).
 */
export function classifyAIError(
  err: unknown,
  options?: { abortSignal?: AbortSignal }
): ClassifiedAIError {
  const errorObj = err as Record<string, unknown> | null | undefined;
  const message = (errorObj?.message as string) || String(err || "");
  const lowerMessage = message.toLowerCase();

  // Extract nested error codes and causes
  const codes: string[] = [];
  let curr: unknown = errorObj;
  for (let depth = 0; depth < 5 && curr; depth++) {
    const cObj = curr as Record<string, unknown>;
    if (typeof cObj.code === "string") codes.push(cObj.code.toUpperCase());
    if (
      cObj.cause &&
      typeof (cObj.cause as Record<string, unknown>).code === "string"
    ) {
      codes.push(
        ((cObj.cause as Record<string, unknown>).code as string).toUpperCase()
      );
    }
    curr = cObj.cause;
  }

  // 1. Timeout / Abort
  const isAborted =
    options?.abortSignal?.aborted ||
    errorObj?.name === "AbortError" ||
    errorObj?.name === "TimeoutError" ||
    codes.includes("ETIMEDOUT") ||
    codes.includes("ESOCKETTIMEDOUT") ||
    lowerMessage.includes("abort") ||
    lowerMessage.includes("timeout") ||
    lowerMessage.includes("timed out");

  if (isAborted) {
    return {
      code: "AI_TIMEOUT",
      retryable: true,
      message,
    };
  }

  // 2. HTTP Status Codes
  let status: number | undefined =
    typeof errorObj?.status === "number"
      ? errorObj.status
      : typeof errorObj?.statusCode === "number"
        ? errorObj.statusCode
        : undefined;

  if (!status && APICallError.isInstance(err)) {
    status = err.statusCode;
  }
  if (
    !status &&
    typeof (errorObj?.response as Record<string, unknown> | undefined)
      ?.status === "number"
  ) {
    status = (errorObj?.response as Record<string, unknown>).status as number;
  }

  // 401 / 403 Authentication Error
  if (
    status === 401 ||
    status === 403 ||
    errorObj?.name === "LoadAPIKeyError"
  ) {
    return {
      code: "AI_PROVIDER_AUTH_ERROR",
      retryable: false,
      message,
    };
  }

  // 429 Rate Limited
  if (
    status === 429 ||
    lowerMessage.includes("rate limit") ||
    lowerMessage.includes("too many requests") ||
    lowerMessage.includes("quota exceeded")
  ) {
    return {
      code: "AI_RATE_LIMITED",
      retryable: true,
      message,
    };
  }

  // 3. Schema / Parsing / Validation Errors
  const isSchemaError =
    TypeValidationError.isInstance(err) ||
    JSONParseError.isInstance(err) ||
    NoObjectGeneratedError.isInstance(err) ||
    lowerMessage.includes("schema") ||
    lowerMessage.includes("validation") ||
    lowerMessage.includes("json parse") ||
    lowerMessage.includes("failed to parse");

  if (isSchemaError) {
    return {
      code: "AI_SCHEMA_INVALID",
      retryable: true,
      message,
    };
  }

  // 4. HTTP 5xx Server Errors
  if (status && status >= 500) {
    return {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      message,
    };
  }

  // 5. APICallError isRetryable flag
  if (APICallError.isInstance(err) && err.isRetryable) {
    return {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      message,
    };
  }

  // 6. Network / Transport Error Codes and Phrases
  const hasNetworkCode = codes.some((c) => NETWORK_ERROR_CODES.has(c));
  const hasNetworkPhrase = NETWORK_ERROR_PHRASES.some((phrase) =>
    lowerMessage.includes(phrase)
  );

  if (hasNetworkCode || hasNetworkPhrase) {
    return {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      message,
    };
  }

  // 7. Non-HTTP AI SDK errors that represent transport/connection issues
  if (AISDKError.isInstance(err) && !status) {
    return {
      code: "AI_PROVIDER_UNAVAILABLE",
      retryable: true,
      message,
    };
  }

  return {
    code: "AI_UNKNOWN_ERROR",
    retryable: false,
    message,
  };
}
