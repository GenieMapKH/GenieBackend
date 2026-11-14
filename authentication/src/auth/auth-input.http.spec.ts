import { KnownLoginDevices } from './login-protection/known-login-devices.store';
import { LoginThrottle } from './login-protection/login-throttle.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RejectNullBytesPipe } from '@tilomnov/shared';
import request from 'supertest';
import { AuthAttemptLimits } from './attempt-limiter';
import { AdminLoginService } from './admin-login.service';
import { AuthController } from './auth.controller';
import { CredentialsAuthService } from './credentials/credentials-auth.service';
import { PasswordResetService } from './password-reset/password-reset.service';
import { SessionService } from './sessions/session.service';
import { FirebaseLoginService } from './social/firebase-login.service';

// The Firebase SDK is not needed here and cannot be loaded by Jest.
jest.mock('./social/firebase-login.service', () => ({
  FirebaseLoginService: class {},
}));
jest.mock('../firebase/firebase.service', () => ({
  FirebaseService: class {},
}));

/**
 * Sign-up and sign-in bodies through the same pipes as `main.ts`: what the
 * service layer receives, and what never reaches it.
 */
describe('sign-up and sign-in input (HTTP)', () => {
  const credentials = {
    register: jest.fn(),
    login: jest.fn(),
  };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: CredentialsAuthService, useValue: credentials },
        { provide: FirebaseLoginService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: AdminLoginService, useValue: { complete: jest.fn() } },
        { provide: PasswordResetService, useValue: {} },
        AuthAttemptLimits,
        LoginThrottle,
        {
          provide: KnownLoginDevices,
          useValue: {
            isKnown: () => Promise.resolve(false),
            remember: () => Promise.resolve(),
          },
        },
      ],
    }).compile();
    app = moduleRef.createNestApplication();
    app.useGlobalPipes(
      new RejectNullBytesPipe(),
      new ValidationPipe({ whitelist: true, transform: true }),
    );
    await app.init();
  });

  afterAll(() => app.close());
  beforeEach(() => jest.resetAllMocks());

  const register = (body: object) =>
    request(app.getHttpServer()).post('/auth/register').send(body);
  const login = (body: object) =>
    request(app.getHttpServer()).post('/auth/login').send(body);

  it('rejects malformed admin email tokens before exchange', async () => {
    await request(app.getHttpServer())
      .post('/auth/admin-login/complete')
      .send({ token: 'invalid' })
      .expect(400);
    await request(app.getHttpServer())
      .post('/auth/admin-login/complete')
      .send({})
      .expect(400);
  });

  it('registers with a phone only, normalized, and drops unknown fields', async () => {
    await register({
      phone: '012 345 678',
      password: 'password123',
      role: 'admin',
      email: '',
    }).expect(201);

    expect(credentials.register).toHaveBeenCalledWith({
      phone: '+85512345678',
      password: 'password123',
    });
  });

  it('passes the SMS ownership proof to the service', async () => {
    await register({
      phone: '012345678',
      password: 'password123',
      phoneProof: 'firebase-id-token',
    }).expect(201);
    expect(credentials.register).toHaveBeenCalledWith({
      phone: '+85512345678',
      password: 'password123',
      phoneProof: 'firebase-id-token',
    });
  });

  it.each([undefined, '', '  ', null])(
    'rejects a missing phone %j even with email proof',
    async (phone) => {
      await register({
        phone,
        email: 'dara@gmail.com',
        emailProof: 'email-proof',
        password: 'password123',
      }).expect(400);
      expect(credentials.register).not.toHaveBeenCalled();
    },
  );

  it('passes the optional email and name through, cleaned', async () => {
    await register({
      phone: '+855 97 123 4567',
      email: ' Dara@Gmail.com ',
      name: ' Dara ',
      password: 'password123',
    }).expect(201);

    expect(credentials.register).toHaveBeenCalledWith({
      phone: '+855971234567',
      email: 'dara@gmail.com',
      name: 'Dara',
      password: 'password123',
    });
  });

  it.each([
    { password: 'password123' },
    { phone: '123', email: 'a@b.com', password: 'password123' },
    { phone: '012345678', email: 'invalid', password: 'password123' },
    { phone: '012345678', phoneProof: {}, password: 'password123' },
    { phone: "012' OR 1=1 --", password: 'password123' },
    { phone: { $ne: null }, password: 'password123' },
    { phone: '012345678', name: '<script>x</script>', password: 'password123' },
    { phone: '012345678', password: 'short' },
    { phone: '012345678', password: 'password\u0000123' },
  ])('refuses %j before it reaches the service', async (body) => {
    await register(body).expect(400);
    expect(credentials.register).not.toHaveBeenCalled();
  });

  it('signs in with any spelling of the number', async () => {
    credentials.login.mockResolvedValue({
      accessToken: 'a',
      refreshToken: 'r',
    });

    await login({ phone: '(012) 345-678', password: 'pw' }).expect(200);

    expect(credentials.login).toHaveBeenCalledWith(
      { phone: '+85512345678', password: 'pw' },
      expect.anything(),
    );
  });

  it.each([
    { phone: "' OR '1'='1", password: 'pw' },
    { email: { $gt: '' }, password: 'pw' },
    { email: 'a@b.com', password: ['pw'] },
    { email: 'a@b.com\u0000', password: 'pw' },
    { password: 'pw' },
  ])('refuses sign-in body %j', async (body) => {
    await login(body).expect(400);
    expect(credentials.login).not.toHaveBeenCalled();
  });

  it('does not expose SMS password recovery', async () => {
    await request(app.getHttpServer())
      .post('/auth/reset-password/phone')
      .send({ idToken: 'old-sms-token', newPassword: 'new-password' })
      .expect(404);
  });
});
