import { PhonePasswordResetService } from './password-reset/phone-password-reset.service';
import { KnownLoginDevices } from './login-protection/known-login-devices.store';
import { LoginThrottle } from './login-protection/login-throttle.service';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { RejectNullBytesPipe } from '@tilomnov/shared';
import request from 'supertest';
import { AuthAttemptLimits } from './attempt-limiter';
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
  const phoneReset = { reset: jest.fn() };
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [AuthController],
      providers: [
        { provide: CredentialsAuthService, useValue: credentials },
        { provide: FirebaseLoginService, useValue: {} },
        { provide: SessionService, useValue: {} },
        { provide: PasswordResetService, useValue: {} },
        { provide: PhonePasswordResetService, useValue: phoneReset },
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
    { email: 'a@b.com', password: 'password123' },
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

  describe('phone password reset', () => {
    const resetByPhone = (body: object) =>
      request(app.getHttpServer())
        .post('/auth/reset-password/phone')
        .send(body);

    it('passes the token and the new password on', async () => {
      phoneReset.reset.mockResolvedValue({ message: 'ok' });

      await resetByPhone({
        idToken: 'id-token',
        newPassword: 'new-password',
      }).expect(200);
      expect(phoneReset.reset).toHaveBeenCalledWith('id-token', 'new-password');
    });

    it.each([
      { newPassword: 'new-password' },
      { idToken: 'id-token', newPassword: 'short' },
      { idToken: 'x'.repeat(5000), newPassword: 'new-password' },
      { idToken: ['id-token'], newPassword: 'new-password' },
    ])('refuses %j before it reaches the service', async (body) => {
      await resetByPhone(body).expect(400);
      expect(phoneReset.reset).not.toHaveBeenCalled();
    });
  });
});
