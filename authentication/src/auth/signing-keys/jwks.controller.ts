import { Controller, Get, Header, Inject } from '@nestjs/common';
import { SigningKeyStore } from './signing-key.store';

/**
 * The public keys that verify this service's tokens (RFC 7517). Every other
 * service fetches them from here instead of holding a key of its own.
 * Public keys only, so no authentication.
 */
@Controller('auth')
export class JwksController {
  constructor(
    @Inject(SigningKeyStore) private readonly keys: SigningKeyStore,
  ) {}

  @Get('.well-known/jwks.json')
  @Header('Cache-Control', 'public, max-age=300')
  jwks() {
    return this.keys.jwks();
  }
}
