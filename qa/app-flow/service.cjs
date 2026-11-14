// Real application modules; only external storage/Firebase boundaries are fixtures.
const path = require("node:path");
const { Test } = require("@nestjs/testing");
const { ValidationPipe, UnauthorizedException } = require("@nestjs/common");
const { SupabaseService, RejectNullBytesPipe } = require("@tilomnov/shared");
const { enableApiVersioning } = require("@tilomnov/shared/api-versions");
const root = path.resolve(__dirname, "../..");
const service = process.argv[2];
const storageBase = process.env.SUPABASE_URL;
const objectUrl = (bucket, file = "") => `${storageBase}/${bucket}/${file}`;
async function storageRequest(method, url, body) {
  const response = await fetch(url, { method, body });
  if (!response.ok) throw new Error(`Fixture storage: ${response.status}`);
  return response;
}
const storage = {
  ensureBucket: async () => {},
  createSignedUploadUrl: async (bucket, file) => objectUrl(bucket, file),
  createSignedDownloadUrl: async (bucket, file) => objectUrl(bucket, file),
  publicUrl: objectUrl,
  downloadFile: async (bucket, file) =>
    Buffer.from(
      await (
        await storageRequest("GET", objectUrl(bucket, file))
      ).arrayBuffer(),
    ),
  uploadFile: async (bucket, file, bytes) => {
    await storageRequest("PUT", objectUrl(bucket, file), bytes);
  },
  removeFiles: async (bucket, files) => {
    for (const file of files)
      await storageRequest("DELETE", objectUrl(bucket, file));
  },
  removeFolder: async (bucket, folder) => {
    await storageRequest("DELETE", `${objectUrl(bucket, folder)}?prefix=true`);
  },
};

(async () => {
  const { AppModule } = require(path.join(root, service, "dist/app.module"));
  let builder = Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SupabaseService)
    .useValue(storage);
  if (service === "authentication") {
    const { FirebaseService } = require(
      path.join(root, "authentication/dist/firebase/firebase.service"),
    );
    builder = builder.overrideProvider(FirebaseService).useValue({
      verifyIdToken: async () => {
        throw new UnauthorizedException(
          "Fixture rejects external Firebase tokens",
        );
      },
      deleteUser: async () => {},
    });
  }
  if (service === "property") {
    const { PlaceProvider } = require(
      path.join(root, "property/dist/search/places/place-provider"),
    );
    builder = builder.overrideProvider(PlaceProvider).useValue({
      isConfigured: true,
      suggest: async () => [
        {
          placeId: "local-place",
          primaryText: "Toul Kork fixture",
          secondaryText: "Local provider fixture",
        },
      ],
      area: async () => ({
        placeId: "local-place",
        name: "Toul Kork fixture",
        address: null,
        center: { lat: 11.58, lng: 104.9 },
        viewport: { minLat: 11.5, maxLat: 11.6, minLng: 104.8, maxLng: 105 },
      }),
    });
  }
  const module = await builder.compile();
  const app = module.createNestApplication({
    bodyParser: service !== "api-gateway",
    logger: ["error", "warn"],
  });
  if (service === "api-gateway") {
    app.set("trust proxy", false);
    await app.init();
    for (const proxy of app.get(AppModule).websocketProxies)
      app.getHttpServer().on("upgrade", proxy.upgrade);
  } else {
    enableApiVersioning(app);
    app.useGlobalPipes(
      new RejectNullBytesPipe(),
      new ValidationPipe({ whitelist: true, transform: true }),
    );
  }
  app.enableShutdownHooks();
  await app.listen(Number(process.env.PORT), "127.0.0.1");
  process.on("message", async (message) => {
    if (message === "stop") {
      await app.close();
      process.exit(0);
    }
  });
  if (process.send) process.send("ready");
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
