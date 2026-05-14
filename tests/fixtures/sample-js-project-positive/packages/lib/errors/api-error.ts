interface ApiErrorData {
  code: string;
  message?: string;
  userMessage?: string;
  statusCode?: number;
}

interface ApiErrorJson {
  code: string;
  message?: string;
  userMessage?: string;
  statusCode?: number;
}

export function toApiErrorJson({ code, message, userMessage, statusCode }: ApiErrorData): ApiErrorJson {
  const data: ApiErrorJson = { code };

  // Explicitly only set values if they exist, to avoid cluttering API responses with undefined fields.
  if (message) {
    data.message = message;
  }

  if (userMessage) {
    data.userMessage = userMessage;
  }

  if (statusCode) {
    data.statusCode = statusCode;
  }

  return data;
}


type AccountStatus = 'PENDING' | 'ACTIVE';

interface ServiceErrorData {
  code: string;
  detail?: string;
  hint?: string;
  accountStatus?: AccountStatus;
  httpCode?: number;
}

interface ServiceErrorJson {
  code: string;
  detail?: string;
  hint?: string;
  accountStatus?: AccountStatus;
  httpCode?: number;
}

export function toServiceErrorJson({ code, detail, hint, accountStatus, httpCode }: ServiceErrorData): ServiceErrorJson {
  const data: ServiceErrorJson = { code };

  if (detail) {
    data.detail = detail;
  }

  if (hint) {
    data.hint = hint;
  }

  if (accountStatus) {
    data.accountStatus = accountStatus;
  }

  if (httpCode) {
    data.httpCode = httpCode;
  }

  return data;
}


// Enum members with string values equal to member name — type-system discriminants
export enum ApiErrorCode {
  UNAUTHORIZED = 'UNAUTHORIZED',
  FORBIDDEN = 'FORBIDDEN',
  NOT_FOUND = 'NOT_FOUND',
  VALIDATION_FAILED = 'VALIDATION_FAILED',
  RATE_LIMITED = 'RATE_LIMITED',
  INTERNAL_ERROR = 'INTERNAL_ERROR',
}

export class ApiError extends Error {
  constructor(
    public readonly code: ApiErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
