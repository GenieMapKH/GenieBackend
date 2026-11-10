import { Injectable, Logger } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

/**
 * What a public bucket may hold. The app re-encodes every picture as a JPEG;
 * anything else (HTML, SVG, a program) would be served from our storage
 * domain to whoever opens the link.
 */
export const PUBLIC_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/** The most entries storage lists or deletes in one call. */
const LIST_PAGE_SIZE = 1000;
/** Far more than any account has; stops a loop if storage keeps listing a file it will not delete. */
const MAX_LIST_PAGES = 100;

/**
 * Supabase Storage, without knowing which bucket belongs to which feature:
 * each service names and prepares its own buckets.
 */
@Injectable()
export class SupabaseService {
  private supabase: SupabaseClient;
  private readonly logger = new Logger(SupabaseService.name);

  constructor() {
    const supabaseUrl = process.env.SUPABASE_URL;
    const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

    if (!supabaseUrl || !supabaseKey) {
      throw new Error(
        'SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be provided',
      );
    }

    this.supabase = createClient<any, 'public'>(supabaseUrl, supabaseKey);
  }

  /**
   * Creates the bucket if it does not exist yet. A bucket that does exist keeps
   * the limits it was made with, so they are applied to it again: a limit
   * added later must reach buckets that were created before it.
   */
  async ensureBucket(
    name: string,
    options: {
      public: boolean;
      fileSizeLimit?: number;
      allowedMimeTypes?: string[];
    },
  ) {
    const { data: buckets, error } = await this.supabase.storage.listBuckets();
    if (error) throw error;

    if (buckets.some((bucket) => bucket.name === name)) {
      const { error: updateError } = await this.supabase.storage.updateBucket(
        name,
        options,
      );
      if (updateError) throw updateError;
      this.logger.log(`Bucket ${name} already exists; limits applied.`);
      return;
    }
    this.logger.log(`Bucket ${name} not found, creating it...`);
    const { error: createError } = await this.supabase.storage.createBucket(
      name,
      options,
    );
    if (createError) throw createError;
    this.logger.log(`Bucket ${name} created successfully.`);
  }

  /** A URL the client can PUT one file to, without any other credentials. */
  async createSignedUploadUrl(bucket: string, path: string): Promise<string> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUploadUrl(path);
    if (error || !data?.signedUrl) {
      throw error ?? new Error(`No upload URL returned for ${bucket}/${path}`);
    }
    return data.signedUrl;
  }

  /** A short-lived URL to read one file of a private bucket. Null if the file does not exist. */
  async createSignedDownloadUrl(
    bucket: string,
    path: string,
    expiresInSeconds: number,
  ): Promise<string | null> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .createSignedUrl(path, expiresInSeconds);
    if (error) {
      if (/not.?found/i.test(error.message)) return null;
      throw error;
    }
    return data.signedUrl;
  }

  /** The bytes of one stored file. */
  async downloadFile(bucket: string, path: string): Promise<Buffer> {
    const { data, error } = await this.supabase.storage
      .from(bucket)
      .download(path);
    if (error || !data) {
      throw error ?? new Error(`Nothing downloaded for ${bucket}/${path}`);
    }
    return Buffer.from(await data.arrayBuffer());
  }

  /** Stores [data] at [path], replacing a file already there. */
  async uploadFile(
    bucket: string,
    path: string,
    data: Buffer,
    contentType: string,
  ): Promise<void> {
    const { error } = await this.supabase.storage
      .from(bucket)
      .upload(path, data, { contentType, upsert: true });
    if (error) throw error;
  }

  /** The address of a file in a public bucket. */
  publicUrl(bucket: string, path: string): string {
    return this.supabase.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /** Deletes files of a bucket. Ones that do not exist are ignored. */
  async removeFiles(bucket: string, paths: string[]): Promise<void> {
    for (let start = 0; start < paths.length; start += LIST_PAGE_SIZE) {
      const { error } = await this.supabase.storage
        .from(bucket)
        .remove(paths.slice(start, start + LIST_PAGE_SIZE));
      if (error) throw error;
    }
  }

  /** Deletes every file under `folder`, at any depth. */
  async removeFolder(bucket: string, folder: string): Promise<void> {
    // Storage lists one level at a time and at most a page of it, so keep
    // going until the level is empty. A folder disappears with its last file.
    for (let page = 0; page < MAX_LIST_PAGES; page++) {
      const { data, error } = await this.supabase.storage
        .from(bucket)
        .list(folder, { limit: LIST_PAGE_SIZE });
      if (error) throw error;
      if (!data || data.length === 0) return;

      // A folder is listed without an id.
      const files = data
        .filter((entry) => entry.id !== null)
        .map((entry) => `${folder}/${entry.name}`);
      for (const subfolder of data.filter((entry) => entry.id === null)) {
        await this.removeFolder(bucket, `${folder}/${subfolder.name}`);
      }
      await this.removeFiles(bucket, files);
    }
    throw new Error(
      `${bucket}/${folder} still has files after ${MAX_LIST_PAGES} passes`,
    );
  }
}
