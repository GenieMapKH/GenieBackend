import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import * as bcrypt from 'bcrypt';
import { AdminLoginService, AdminLoginPending } from '../admin-login.service';
import { LoginDto } from '../dto/login.dto';
import { RegisterDto } from '../dto/register.dto';
import { BCRYPT_ROUNDS, DEFAULT_USER_ROLE } from '../auth.constants';
import { ClientContext } from '../sessions/client-context';
import { SignInService } from '../sessions/sign-in.service';
import { TokenPair } from '../sessions/token-issuer.service';
import { UserRecord, UserRepository } from '../users/user.repository';
import { EmailVerificationService } from '../verification/email-verification.service';
import { PhoneProofService } from '../verification/phone-proof.service';

/** Email/phone + password registration and login. */
@Injectable()
export class CredentialsAuthService {
  constructor(
    @Inject(UserRepository) private readonly users: UserRepository,
    @Inject(SignInService) private readonly signIn: SignInService,
    private readonly emails: EmailVerificationService,
    private readonly phones: PhoneProofService,
    private readonly adminLogin: AdminLoginService,
  ) {}

  async register(dto: RegisterDto): Promise<void> {
    // shortcut: SMS proof is optional during the delivery outage, require it when signup SMS returns.
    if (
      dto.phoneToken &&
      (await this.phones.verify(dto.phoneToken)) !== dto.phone
    )
      throw new BadRequestException(
        'The SMS proof belongs to a different phone number',
      );
    if (dto.email) this.emails.requireProof(dto.email, dto.emailProof);
    // The database refuses an exact repeat; these also catch an older account
    // that holds capitals in its email or another spelling of the number.
    if (
      (await this.users.findByPhone(dto.phone)) ||
      (dto.email && (await this.users.findByEmail(dto.email)))
    ) {
      throw new ConflictException('Email or phone already exists');
    }

    const passwordHash = await bcrypt.hash(dto.password, BCRYPT_ROUNDS);

    // Self-registration never grants elevated roles.
    await this.users.create({
      phone: dto.phone,
      email: dto.email ?? null,
      name: dto.name ?? null,
      password_hash: passwordHash,
      has_password: true,
      role: DEFAULT_USER_ROLE,
      phone_verified: !!dto.phoneToken,
      email_verified: !!dto.email,
    });
  }

  async login(
    dto: LoginDto,
    client: ClientContext,
  ): Promise<TokenPair | AdminLoginPending> {
    const user = await this.findByIdentifier(dto);

    // Same error for "unknown user" and "wrong password" so accounts can't be probed.
    const passwordMatches =
      user && (await bcrypt.compare(dto.password, user.password_hash));
    if (!user || !passwordMatches) {
      throw new UnauthorizedException('Invalid credentials');
    }

    if (user.role === 'admin') return this.adminLogin.start(user);

    return this.signIn.complete(user, client);
  }

  private findByIdentifier(dto: LoginDto): Promise<UserRecord | null> {
    if (dto.email) return this.users.findByEmail(dto.email);
    if (dto.phone) return this.users.findByPhone(dto.phone);
    throw new BadRequestException('Email or phone is required');
  }
}
