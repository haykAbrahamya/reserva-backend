import { Global, Module } from '@nestjs/common';
import { ImageStorageService } from './image-storage.service';

/**
 * Image storage, available everywhere.
 *
 * Global because four modules across three feature areas store images and none
 * of them has anything else in common — threading an import through each one
 * would be ceremony around a stateless service that reads two env vars.
 */
@Global()
@Module({
  providers: [ImageStorageService],
  exports: [ImageStorageService],
})
export class MediaModule {}
