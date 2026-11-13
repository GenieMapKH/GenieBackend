import { Module } from '@nestjs/common';
import { SupabaseService } from './supabase.service';
import { UploadBudgets } from './upload-budgets';

@Module({
  providers: [SupabaseService, UploadBudgets],
  exports: [SupabaseService, UploadBudgets],
})
export class SupabaseModule {}
