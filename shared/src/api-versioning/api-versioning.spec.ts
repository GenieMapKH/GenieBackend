import {
  Controller,
  Get,
  INestApplication,
  Version,
  VERSION_NEUTRAL,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { ApiVersions, apiVersionStatus } from './api-versions';
import { enableApiVersioning } from './enable-api-versioning';

describe('apiVersionStatus', () => {
  const versions: ApiVersions = {
    served: ['2', '3'],
    retired: ['1'],
    unversioned: '1',
  };

  it.each([
    ['3', 'current'],
    ['2', 'deprecated'],
    ['1', 'retired'],
    ['4', 'unknown'],
  ])('version %s is %s', (version, status) => {
    expect(apiVersionStatus(version, versions)).toBe(status);
  });
});

@Controller('listings')
class ListingsController {
  @Get()
  list() {
    return { version: 'every' };
  }

  @Version('1')
  @Get(':id')
  oldShape() {
    return { version: '1' };
  }

  @Version('2')
  @Get(':id')
  newShape() {
    return { version: '2' };
  }
}

@Controller({ path: 'internal/ping', version: VERSION_NEUTRAL })
class InternalController {
  @Get()
  ping() {
    return { ok: true };
  }
}

describe('enableApiVersioning', () => {
  let app: INestApplication;
  let base: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [ListingsController, InternalController],
    }).compile();
    app = moduleRef.createNestApplication({ logger: false });
    enableApiVersioning(app, {
      served: ['1', '2'],
      retired: [],
      unversioned: '1',
    });
    await app.listen(0, '127.0.0.1');
    base = await app.getUrl();
  });

  afterAll(() => app.close());

  const get = async (path: string) => {
    const response = await fetch(`${base}${path}`);
    return {
      status: response.status,
      body: response.ok ? ((await response.json()) as unknown) : null,
    };
  };

  it('serves a handler without @Version under every served version', async () => {
    expect(await get('/v1/listings')).toEqual({
      status: 200,
      body: { version: 'every' },
    });
    expect((await get('/v2/listings')).status).toBe(200);
  });

  it('serves each version of a changed endpoint from its own handler', async () => {
    expect((await get('/v1/listings/7')).body).toEqual({ version: '1' });
    expect((await get('/v2/listings/7')).body).toEqual({ version: '2' });
  });

  it('still answers unversioned paths, for a gateway from before versioning', async () => {
    expect((await get('/listings')).status).toBe(200);
  });

  it('answers 404 for a version nobody serves', async () => {
    expect((await get('/v3/listings')).status).toBe(404);
  });

  it('keeps version-neutral controllers unversioned only', async () => {
    expect((await get('/internal/ping')).status).toBe(200);
    expect((await get('/v1/internal/ping')).status).toBe(404);
  });
});
