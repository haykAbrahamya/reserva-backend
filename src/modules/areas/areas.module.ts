import { Global, Module } from '@nestjs/common';
import { AreasController } from './areas.controller';
import { AreasService } from './areas.service';

/**
 * The platform area taxonomy — shared vocabulary rather than one product's
 * domain, which is why it is Global: locations validate writes against it,
 * vacancies enforce it at publish, and the public board will filter on it.
 */
@Global()
@Module({
  controllers: [AreasController],
  providers: [AreasService],
  exports: [AreasService],
})
export class AreasModule {}
