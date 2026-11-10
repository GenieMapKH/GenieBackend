import { signServiceToken, ServiceName } from './service-token';

/** A call to another service that did not succeed. `status` is 0 when it could not be reached at all. */
export class ServiceCallError extends Error {
  constructor(
    readonly service: string,
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface ServiceCallOptions {
  body?: unknown;
  /** Give up after this long, so a stuck service cannot hold this one up with it. */
  timeoutMs: number;
}

/**
 * Calls an `/internal` route of another service, signed as `caller`. One
 * place for the token, the timeout and the error shape, so each feature only
 * decides what to ask and what a failure means for it.
 */
export class ServiceClient {
  private readonly baseUrl: string;

  constructor(
    private readonly name: string,
    baseUrl: string,
    private readonly caller: ServiceName,
  ) {
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async call<T = void>(
    method: string,
    path: string,
    options: ServiceCallOptions,
  ): Promise<T> {
    // Signed before the try: a missing secret is a configuration error, not an unreachable service.
    const token = signServiceToken(this.caller);

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}${path}`, {
        method,
        headers: {
          authorization: `Bearer ${token}`,
          ...(options.body === undefined
            ? {}
            : { 'content-type': 'application/json' }),
        },
        body:
          options.body === undefined ? undefined : JSON.stringify(options.body),
        signal: AbortSignal.timeout(options.timeoutMs),
      });
    } catch (error) {
      throw new ServiceCallError(
        this.name,
        0,
        `the ${this.name} service is unreachable: ${(error as Error).message}`,
      );
    }

    if (!response.ok) {
      throw new ServiceCallError(
        this.name,
        response.status,
        await messageOf(response),
      );
    }
    const text = await response.text();
    return (text ? JSON.parse(text) : undefined) as T;
  }
}

/** The `message` of a Nest error body, or the status text when there is none. */
async function messageOf(response: Response): Promise<string> {
  try {
    const body = (await response.json()) as { message?: string | string[] };
    const message = Array.isArray(body.message)
      ? body.message.join(', ')
      : body.message;
    if (message) return message;
  } catch {
    // Not JSON: the status line below is all there is to say.
  }
  return `answered ${response.status}`;
}
